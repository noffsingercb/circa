import {
	API_BASE,
	GLOBAL_CAP,
	HEALTH_PATH,
	MAX_PER_SEGMENT,
	MAX_SEGMENTS,
	MIN_MATCHES,
	RELAXED_LOCAL_FLOOR,
	REQUEST_TIMEOUT_MS,
	TIMELINE_PATH,
	WARMUP_TIMEOUT_MS
} from './config';
import type { CircaEntry, CircaResult, EngineConfig, SegmentInput, Timeline } from './types';

export class ApiError extends Error {
	readonly status: number;

	/**
	 * The server's own explanation, when it sent one.
	 *
	 * Kept separate from `message` so a caller can tell "the API stated exactly
	 * what was wrong with this request" from "we are guessing on its behalf". A
	 * 400 from the engine carries a sentence written to be read; a 502 from a
	 * proxy that never reached the engine carries nothing useful at all.
	 */
	readonly detail: string | null;

	constructor(message: string, status: number, detail: string | null = null) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.detail = detail;
	}
}

type FetchLike = typeof fetch;

/**
 * Tracks the in-flight (or completed) warm-up so it only ever happens once per
 * page load. Without this, a component that mounts twice -- or a future second
 * caller -- would send a second ping for no benefit.
 */
let warmUpPromise: Promise<void> | null = null;

/**
 * Wake the API without waiting for it.
 *
 * The service is hosted on a free Render instance, which sleeps after roughly
 * 15 minutes without traffic. The next request then pays a cold start of up to
 * a minute while the container boots -- and the person who pays it is always a
 * first-time visitor, because a returning one arrives at a service that is
 * already awake. The worst experience is reserved for exactly the audience we
 * most want to keep.
 *
 * So we spend the boot during the part of the visit that is already slow: the
 * seconds someone takes to read the page and type a name, a place and a date.
 * By the time they submit, the container is up and the request is fast.
 *
 * Three properties matter, and all three are deliberate:
 *
 *  - It CANNOT throw. Every failure path resolves. A page that broke because
 *    an optimisation failed would be a strictly worse page than one with no
 *    optimisation at all, and a rejected promise nobody awaits also produces
 *    an unhandled rejection in the console.
 *  - It CANNOT block. Callers are not expected to await it; the form works
 *    exactly as before whether this succeeds, fails, or is still in flight.
 *  - It is IDEMPOTENT. Repeat calls return the same promise.
 *
 * It is not a guarantee. A visitor who submits within a few seconds of landing
 * still races the boot, which is why REQUEST_TIMEOUT_MS was also raised past
 * the worst-case cold start. This makes the slow case rare; the timeout makes
 * it survivable.
 */
export function warmUp(fetchImpl: FetchLike = fetch): Promise<void> {
	if (warmUpPromise) return warmUpPromise;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);

	warmUpPromise = fetchImpl(API_BASE + HEALTH_PATH, {
		method: 'GET',
		signal: controller.signal
	})
		.then(() => undefined)
		// Swallowed on purpose. A failed warm-up is not a failed page: the real
		// request will report a real problem in its own words if there is one.
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));

	return warmUpPromise;
}

/** Longest server message we will carry into the UI. */
const MAX_DETAIL_CHARS = 300;

/**
 * Pull the server's own explanation out of a failed response.
 *
 * This used to be thrown away. The old code tested `response.ok` and never
 * touched the body, so a rejected input, a rate limit and a genuinely dead
 * service all arrived at the UI as one indistinguishable ApiError -- and the
 * UI, having nothing to go on, said the service was not answering.
 *
 * On 2026-08-23 a visitor looking up a living relative was told exactly that,
 * while the API was in fact answering in one millisecond with
 * `segments[0] must fall between year 1 and 2027.` The information needed to
 * explain the failure was in the response the whole time.
 *
 * Never throws: a body that is empty, not JSON, or not shaped as expected is
 * simply no detail, and the caller falls back to its own wording. Truncated
 * because this string is rendered into the page, and a length limit on
 * anything we did not author is cheaper than trusting one.
 */
async function readErrorDetail(response: Response): Promise<string | null> {
	try {
		const body = (await response.json()) as { error?: unknown };
		if (typeof body?.error !== 'string') return null;
		const detail = body.error.trim();
		return detail === '' ? null : detail.slice(0, MAX_DETAIL_CHARS);
	} catch {
		return null;
	}
}

/**
 * POST a set of segments to the engine.
 *
 * The second parameter used to be a single significanceFloor number. It is now
 * a config fragment, because the interesting knob is no longer a scalar: the
 * engine tunes thresholds per scope, and the two calls this module makes differ
 * in exactly one of them. Passing a fragment also means the shape of what we
 * send is visible at each call site rather than encoded in a bare float.
 *
 * Note what the base config does NOT contain: any floor at all. Circa used to
 * send significanceFloor: 0.15 on every request, which the engine applies as a
 * blanket minimum across every scope that scopeFloor does not name -- silently
 * lifting the local floor from 0.05 to 0.15 and filtering out the curated local
 * rows, whose significance averages 0.133. Sending nothing lets the engine's
 * own per-scope defaults stand.
 */
async function postTimeline(
	segments: SegmentInput[],
	configOverrides: Partial<EngineConfig>,
	fetchImpl: FetchLike
): Promise<Timeline> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetchImpl(API_BASE + TIMELINE_PATH, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify({
				segments,
				config: {
					maxPerSegment: MAX_PER_SEGMENT,
					maxSegments: MAX_SEGMENTS,
					...configOverrides
				}
			})
		});

		if (!response.ok) {
			const detail = await readErrorDetail(response);
			throw new ApiError(
				detail ?? 'The timeline service could not be reached.',
				response.status,
				detail
			);
		}

		return (await response.json()) as Timeline;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Query the engine, then backfill any segment that came back too thin.
 *
 * The retry sends only the sparse segments, so the segmentIndex values in that
 * second response are local to the sub-array and have to be mapped back to
 * their positions in the caller's list before the two sets are merged.
 */
export async function fetchTimeline(
	segments: SegmentInput[],
	fetchImpl: FetchLike = fetch
): Promise<CircaResult> {
	// No floor overrides: the engine's per-scope defaults are the tuned ones.
	const base = await postTimeline(segments, {}, fetchImpl);
	const entries: CircaEntry[] = base.entries.map((entry) => ({ ...entry, relaxed: false }));

	const counts = new Array<number>(segments.length).fill(0);
	for (const entry of entries) {
		if (counts[entry.segmentIndex] !== undefined) counts[entry.segmentIndex] += 1;
	}

	const thin: number[] = [];
	counts.forEach((count, index) => {
		if (count < MIN_MATCHES) thin.push(index);
	});

	let relaxedSegments: number[] = [];

	if (thin.length > 0) {
		// scopeFloor.local, deliberately not significanceFloor. A scalar would also
		// lower the floor on the person tier -- births and deaths are filtered by
		// significanceFloor, not by any scope entry -- so a sparse segment would
		// backfill with obscure local figures instead of local history. Naming the
		// scope explicitly also exempts it from the engine's blanket-minimum rule
		// and leaves regional, national and global untouched.
		const retry = await postTimeline(
			thin.map((index) => segments[index]),
			{ scopeFloor: { local: RELAXED_LOCAL_FLOOR } },
			fetchImpl
		);
		const seen = new Set(entries.map((entry) => entry.id));

		for (const entry of retry.entries) {
			if (seen.has(entry.id)) continue;
			seen.add(entry.id);
			entries.push({
				...entry,
				segmentIndex: thin[entry.segmentIndex] ?? entry.segmentIndex,
				relaxed: true
			});
		}

		relaxedSegments = thin;
	}

	return {
		entries: capEntries(entries),
		datasetVersion: base.datasetVersion,
		generatedWith: base.generatedWith,
		relaxedSegments
	};
}

/**
 * Trim to the global ceiling by score, then order by date for rendering.
 * Trimming by score rather than by date keeps the cut from lopping off the end
 * of a long life.
 *
 * Universal rows are EXEMPT from the ceiling entirely. The cap exists to bound
 * ambient history; a curated world-scale row is never the thing that should be
 * dropped to fit a budget. Before geohistory-core@0.7.0 the engine capped that
 * tier itself at universalQuota 2, and 90 was sized to leave room for it -- so
 * this used to be safe by accident. The engine now draws the whole curated
 * pool, which is bounded by the seed file (34 rows) rather than by the request,
 * so appending them unconditionally cannot run away.
 */
export function capEntries(entries: CircaEntry[]): CircaEntry[] {
	const universal = entries.filter((entry) => entry.tier === 'universal');
	const ambient = entries.filter((entry) => entry.tier !== 'universal');

	const kept =
		ambient.length > GLOBAL_CAP
			? [...ambient].sort((a, b) => b.score - a.score).slice(0, GLOBAL_CAP)
			: [...ambient];

	return [...kept, ...universal].sort(
		(a, b) => a.dateStartISO.localeCompare(b.dateStartISO) || a.id.localeCompare(b.id)
	);
}
