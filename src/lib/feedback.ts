import { API_BASE, BUILD_ID, FEEDBACK_PATH, FEEDBACK_TIMEOUT_MS } from './config';
import type { CircaEntry, Scope } from './types';

/**
 * Thumbs feedback on a rendered tile.
 *
 * The vote answers one question -- "was this event a good match at this
 * distance, at this reach, in this tier?" -- and deliberately cannot answer
 * "where does this person live?". That separation is the whole reason this
 * module exists as its own file: everything that leaves the browser passes
 * through buildVote, so there is exactly one place to audit against the
 * privacy claim in the footer.
 *
 * What is NEVER sent, and must never be added here: a place name, a latitude
 * or longitude, an exact distance, a person's name, an exact year, a session
 * id. The API rejects unknown keys outright, so an addition here fails loudly
 * at the edge rather than quietly landing in a durable Notion row -- but the
 * first line of defence is this comment and the reviewer reading it.
 */

/* -------------------------------------------------------------------------- */
/* The wire format                                                            */
/* -------------------------------------------------------------------------- */

export type Verdict = 'up' | 'down';

/**
 * Mirrors the SCOPES list in GeoHistory's feedback.ts, including the sixth:
 * Scope now carries five values of its own (local, regional, national,
 * global, universal as of 0.6) plus 'unclassified' here for dump rows no
 * scope rule has touched.
 */
export type VoteScope = Scope | 'unclassified';

/**
 * Nine buckets, matching DISTANCE_BUCKETS in GeoHistory's feedback.ts exactly.
 * A name not on that list is a 400, so this array and that one are a contract:
 * change one and you must change the other, plus the Notion select options.
 *
 * Kilometres always, regardless of the display-unit toggle. The toggle is a
 * presentation choice; bucketing in whatever unit the visitor happens to be
 * viewing would make two votes on the same event incomparable.
 */
export const DISTANCE_BUCKETS = [
	'0-25',
	'25-50',
	'50-100',
	'100-250',
	'250-500',
	'500-1000',
	'1000-1500',
	'1500-2500',
	'2500+'
] as const;

export type DistanceBucket = (typeof DISTANCE_BUCKETS)[number];

export interface Vote {
	voteId: string;
	eventId: string;
	eventTitle: string;
	verdict: Verdict;
	scope: VoteScope;
	significance: number;
	reachKm: number;
	headroom: number;
	relaxed: boolean;
	distanceBucket: DistanceBucket;
	segmentDecade: string;
	datasetVersion: string;
	buildId: string;
}

/* -------------------------------------------------------------------------- */
/* Coarsening                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Upper bound of each bucket, in km. The last bucket is open-ended.
 *
 * The boundaries straddle the engine's 1500 km national scopeBase on purpose,
 * so votes above and below that number are separable in the analysis. If they
 * all landed in one bucket there would be nothing to argue with.
 */
const BUCKET_CEILINGS: Array<[number, DistanceBucket]> = [
	[25, '0-25'],
	[50, '25-50'],
	[100, '50-100'],
	[250, '100-250'],
	[500, '250-500'],
	[1000, '500-1000'],
	[1500, '1000-1500'],
	[2500, '1500-2500']
];

/**
 * Bucket a distance in kilometres.
 *
 * Boundaries are inclusive of the lower bound and exclusive of the upper, so
 * exactly 25 km reads as '25-50' rather than '0-25'. Arbitrary but fixed: the
 * point of a bucket is that the same input always produces the same label.
 *
 * Negative and non-finite inputs collapse to the first bucket. Neither should
 * reach here, and neither is worth failing a vote over.
 */
export function bucketDistance(km: number): DistanceBucket {
	if (!Number.isFinite(km) || km < 0) return '0-25';
	for (const [ceiling, label] of BUCKET_CEILINGS) {
		if (km < ceiling) return label;
	}
	return '2500+';
}

/**
 * Bucket a year to its decade, in the "1920s" form the API's DECADE_PATTERN
 * requires. Years below 1000 render as "800s", which that pattern also accepts.
 *
 * Era is what tuning needs; a birth year is not. This is the only place a
 * person-side year is touched, and it is lossy on purpose.
 */
export function decadeOfYear(year: number): string | null {
	if (!Number.isFinite(year) || year < 0) return null;
	return `${Math.floor(year / 10) * 10}s`;
}

/** Decade from an ISO date string, for callers holding a segment start. */
export function decadeOfIso(iso: string | null | undefined): string | null {
	if (!iso || iso.length < 4) return null;
	const year = Number(iso.slice(0, 4));
	return Number.isFinite(year) ? decadeOfYear(year) : null;
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0;
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

/**
 * How much of the event's reach was left over at this distance.
 *
 * The design spec claims the engine returns this per entry. It does not --
 * TimelineEntry has reachKm and distanceKm and no headroom field -- so it is
 * derived here. 1.0 means the event reached far beyond this point; 0.0 means
 * the point sat on the edge of its reach.
 *
 * This is a ratio of two figures the API already receives, so deriving it
 * leaks nothing further: reachKm is public, and the distance arrives bucketed.
 */
export function headroomOf(entry: Pick<CircaEntry, 'reachKm' | 'distanceKm'>): number {
	if (!Number.isFinite(entry.reachKm) || entry.reachKm <= 0) return 0;
	return clamp01((entry.reachKm - entry.distanceKm) / entry.reachKm);
}

/**
 * A vote id. Idempotency only -- it is generated per click, never stored, and
 * cannot be correlated across votes or sessions. Not a session identifier.
 */
function newVoteId(): string {
	const c = typeof crypto !== 'undefined' ? crypto : undefined;
	if (c && typeof c.randomUUID === 'function') return c.randomUUID();
	// Older Safari. Uniqueness only has to hold against duplicate delivery of
	// the same click, so time plus randomness is sufficient.
	return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Build the payload for one click, or null if this entry cannot be voted on.
 *
 * Returns null rather than guessing when the segment decade is unknown. The
 * event's own dateStartISO is close to the segment's era and is NOT the same
 * fact, and quietly substituting it would corrupt the one field the analysis
 * uses to separate eras -- while looking perfectly plausible in the database.
 */
export function buildVote(args: {
	entry: CircaEntry;
	verdict: Verdict;
	segmentDecade: string | null;
	datasetVersion: string | null;
}): Vote | null {
	const { entry, verdict, segmentDecade, datasetVersion } = args;
	if (!segmentDecade) return null;
	if (!entry.id || !entry.displayTitle) return null;

	return {
		voteId: newVoteId(),
		eventId: entry.id,
		// displayTitle, not title: the dump titles rows after entities, so title
		// holds "Oklahoma" where the tile shows "Oklahoma Statehood". The row
		// should read as what the person was actually looking at.
		eventTitle: entry.displayTitle.slice(0, 500),
		verdict,
		// The engine's stored scope, sent verbatim. Births and deaths carry a
		// stored scope of 'local' while being drawn from the person tier, and the
		// tile badges them 'Person' -- but the stored value is what the scoring
		// rules act on, so it is the value worth tuning against.
		scope: entry.scope ?? 'unclassified',
		significance: clamp01(entry.significance),
		reachKm: Number.isFinite(entry.reachKm) ? entry.reachKm : 0,
		headroom: headroomOf(entry),
		relaxed: Boolean(entry.relaxed),
		distanceBucket: bucketDistance(entry.distanceKm),
		segmentDecade,
		datasetVersion: datasetVersion ?? 'unknown',
		buildId: BUILD_ID
	};
}

/* -------------------------------------------------------------------------- */
/* One vote per event per session                                             */
/* -------------------------------------------------------------------------- */

/**
 * sessionStorage, not localStorage. It dies with the tab, which keeps this
 * consistent with the app's no-persistence posture: the guard exists to stop
 * one visitor double-voting in one sitting, not to recognise them later.
 *
 * Every access is wrapped. Safari in private mode throws on access, and
 * storage can be full or disabled entirely -- none of which is a reason for a
 * tile to fail to render.
 */
const VOTES_KEY = 'circa:votes';

function readVotes(): Record<string, Verdict> {
	try {
		if (typeof sessionStorage === 'undefined') return {};
		const raw = sessionStorage.getItem(VOTES_KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
		return parsed as Record<string, Verdict>;
	} catch {
		return {};
	}
}

/** The verdict already cast for this event in this tab, if any. */
export function votedVerdict(eventId: string): Verdict | null {
	return readVotes()[eventId] ?? null;
}

/**
 * Record a verdict. Returns false when this event was already voted on, which
 * the caller uses to skip the send -- so the check and the write cannot drift
 * apart into a double-send.
 */
export function recordVote(eventId: string, verdict: Verdict): boolean {
	const votes = readVotes();
	if (votes[eventId]) return false;
	votes[eventId] = verdict;
	try {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem(VOTES_KEY, JSON.stringify(votes));
		}
	} catch {
		// Storage unavailable or full. The thumb still fills for this render, and
		// the worst case is a duplicate row -- which voteId already covers on the
		// server side. Losing the vote instead would be the worse trade.
	}
	return true;
}

/* -------------------------------------------------------------------------- */
/* Sending                                                                    */
/* -------------------------------------------------------------------------- */

type FetchLike = typeof fetch;

/**
 * POST a vote and forget it.
 *
 * The same three rules as warmUp, for the same reason: this is an optional
 * extra on a page whose actual job is to show a timeline.
 *
 *  - It CANNOT throw. Every failure path resolves.
 *  - It CANNOT block. Callers are not expected to await it.
 *  - It reports NOTHING to the visitor. There is no synchronous confirmation
 *    available anywhere in this chain -- the API answers 204 without waiting
 *    on the worker, and the worker writes to Notion later -- so a "sent!"
 *    message would be a guess, and an error message would be a guess too.
 *
 * keepalive lets the request outlive the page, so a vote cast just before
 * navigating away still leaves.
 */
export function sendVote(vote: Vote, fetchImpl: FetchLike = fetch): Promise<void> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FEEDBACK_TIMEOUT_MS);

	return fetchImpl(API_BASE + FEEDBACK_PATH, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(vote),
		signal: controller.signal,
		keepalive: true
	})
		.then(() => undefined)
		// Swallowed on purpose, including a 400. A validation failure is a bug in
		// this file, and the place to find it is the API's counters and the
		// worker's logs -- not a visitor's screen.
		.catch(() => undefined)
		.finally(() => clearTimeout(timer));
}

/**
 * The whole click, in one call: guard, build, send.
 *
 * Returns true when the thumb should fill. It fills on every first click for
 * an event, including when the send later fails, because the UI promises
 * "noted" and not "stored" -- and an un-filling thumb would be a lie in the
 * other direction, telling someone their opinion was lost when it usually was
 * not.
 */
export function castVote(args: {
	entry: CircaEntry;
	verdict: Verdict;
	segmentDecade: string | null;
	datasetVersion: string | null;
	fetchImpl?: FetchLike;
}): boolean {
	const vote = buildVote(args);
	if (!vote) return false;
	if (!recordVote(vote.eventId, vote.verdict)) return false;
	void sendVote(vote, args.fetchImpl);
	return true;
}
