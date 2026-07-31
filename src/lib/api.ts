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

	constructor(message: string, status: number) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
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
			throw new ApiError('The timeline service could not be reached.', response.status);
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
 */
export function capEntries(entries: CircaEntry[]): CircaEntry[] {
	const kept =
		entries.length > GLOBAL_CAP
			? [...entries].sort((a, b) => b.score - a.score).slice(0, GLOBAL_CAP)
			: [...entries];

	return kept.sort(
		(a, b) => a.dateStartISO.localeCompare(b.dateStartISO) || a.id.localeCompare(b.id)
	);
}
