/**
 * Circa tuning policy -- every knob in one place.
 *
 * Rules of the road:
 *  1. No magic numbers anywhere else in the codebase. If you find yourself
 *     typing a literal into a component or a lib module, it belongs here.
 *     Pure presentation values -- padding, gaps, colours -- are the exception
 *     and live in the component's own stylesheet; see the note where
 *     PX_PER_YEAR used to be.
 *  2. Every value is overridable by a VITE_ env var, so tuning during
 *     development (or per-deployment) never requires a code change or a
 *     rebuild of anything but the static bundle.
 *  3. Values are grouped by who owns them. That distinction matters:
 *
 *     - ENGINE MIRRORS are numbers whose real home is geohistory-core's
 *       DEFAULT_CONFIG. We restate them here only because we send them on the
 *       wire. If the engine changes a default, these silently keep overriding
 *       it -- there is no test that will catch the drift. See README
 *       "Tuning policy" for the two ways out of that coupling.
 *     - CIRCA POLICY are numbers the engine knows nothing about. They are
 *       ours to choose and are safe to change freely.
 *
 * The warning in rule 3 was not hypothetical. BASE_FLOOR mirrored the engine's
 * significanceFloor at 0.15, the engine replaced that with per-scope floors in
 * 0.5.0, and Circa kept sending 0.15 -- which the engine applies as a blanket
 * minimum, lifting the local floor from 0.05 back to 0.15. The entire point of
 * that engine release was undone by a constant in this file that nothing
 * flagged as stale. Both floors have been removed rather than corrected; see
 * the ENGINE MIRRORS block.
 */

type EnvBag = Record<string, string | boolean | undefined>;

const env: EnvBag = ((import.meta as unknown as { env?: EnvBag }).env ?? {}) as EnvBag;

function num(key: string, fallback: number): number {
	const raw = env[key];
	if (raw === undefined || raw === '') return fallback;
	const parsed = Number(raw);
	return Number.isFinite(parsed) ? parsed : fallback;
}

function str(key: string, fallback: string): string {
	const raw = env[key];
	return typeof raw === 'string' && raw !== '' ? raw : fallback;
}

/* -------------------------------------------------------------------------- */
/* API                                                                        */
/* -------------------------------------------------------------------------- */

/** Base URL of the GeoHistory API service. No trailing slash. */
export const API_BASE = str('VITE_CIRCA_API', 'https://api.geohistory.example');

/** Versioned endpoint. A breaking engine release ships as /v2 alongside /v1. */
export const TIMELINE_PATH = str('VITE_CIRCA_TIMELINE_PATH', '/v1/timeline');

export const REQUEST_TIMEOUT_MS = num('VITE_REQUEST_TIMEOUT_MS', 15_000);

/* -------------------------------------------------------------------------- */
/* CIRCA POLICY -- ours alone                                                 */
/* -------------------------------------------------------------------------- */

/**
 * When a person has a birth but no death (or a death but no birth), we assume
 * a 100-year window rather than inventing a death date.
 */
export const LIFESPAN_CAP_YEARS = num('VITE_LIFESPAN_CAP_YEARS', 100);

/**
 * How far back a death-anchored final segment reaches.
 *
 * A death is an end date, not a start. Building a segment that begins at the
 * death gives it zero duration, so the last leg of a life returns nothing --
 * the Denver 1954 segment in the Pueblo run came back empty for exactly this
 * reason, and it looked like a truncation bug rather than a modelling gap.
 *
 * Since we cannot know when someone arrived at the place they died, we assume
 * they were there for a while. Eight years is a guess, chosen to be long
 * enough to catch a settled final chapter without swallowing the preceding
 * segment whole. It is clamped so it can never start before the prior event.
 *
 * Confirmed against the Pueblo run: with the lookback in place the Denver
 * segment returned rows for the first time, including four within 13 km.
 */
export const DEATH_LOOKBACK_YEARS = num('VITE_DEATH_LOOKBACK_YEARS', 8);

/** Most life events one person can enter in the form. */
export const MAX_EVENTS = num('VITE_MAX_EVENTS', 20);

/** Hard ceiling on rendered entries, applied after the engine responds. */
export const GLOBAL_CAP = num('VITE_GLOBAL_CAP', 80);

/*
 * PX_PER_YEAR and MIN_GAP_PX were removed here.
 *
 * They encoded a timeline whose vertical axis was a true year scale, with a
 * minimum gap applied on top wherever two cards would have collided. Those two
 * rules contradict each other by construction: the moment the gap fires, the
 * position is no longer proportional to the year, and everything below it is
 * displaced. The year labels were drawn from the unadjusted scale, so a single
 * dense decade pushed every card out of step with its own label for the rest
 * of the page.
 *
 * Cards are now spaced evenly and each carries its own year, so there is no
 * conversion between years and pixels anywhere in the app. Row spacing lives
 * in TimelineView's stylesheet: CSS cannot read import.meta.env, and unlike
 * the values above it changes nothing about which events are chosen or shown.
 */

/* -------------------------------------------------------------------------- */
/* ENGINE MIRRORS -- keep in step with geohistory-core DEFAULT_CONFIG         */
/* -------------------------------------------------------------------------- */

/**
 * Below this many entries, a segment is considered too sparse and is re-queried
 * once with a relaxed local floor.
 */
export const MIN_MATCHES = num('VITE_MIN_MATCHES', 3);

/**
 * The local floor used on the sparsity retry only.
 *
 * Sent as scopeFloor.local, NOT as significanceFloor. The distinction is load
 * bearing: significanceFloor is what the engine applies to the person tier, so
 * sending a scalar 0.05 would drop the birth/death floor to 0.05 as well and
 * flood a sparse segment with minor local figures -- the precise outcome the
 * person tier was introduced to prevent. Naming the scope explicitly also stops
 * the engine's blanket-minimum rule from touching the other three floors.
 *
 * 0.05 matches the engine's own local default, so this retry is really "stop
 * asking for anything stricter" rather than a genuine relaxation. There is
 * room below it if a segment still comes back empty.
 */
export const RELAXED_LOCAL_FLOOR = num('VITE_RELAXED_LOCAL_FLOOR', 0.05);

/**
 * MIRRORS DEFAULT_CONFIG.maxPerSegment (12 in the engine).
 *
 * Raised from 10 to 17, which is a bigger change than it looks. The engine
 * fills a segment by round-robin across five tiers in a fixed order --
 * local, regional, national, global, person -- taking one row per tier per
 * pass until the quotas are exhausted or maxPerSegment is hit. The quotas are
 * local 4, regional 3, national 4, global 5, person 2, totalling 18.
 *
 * So maxPerSegment does not trim the tail evenly; it truncates mid-pass and
 * starves whichever tiers sit late in the order or have deep quotas:
 *
 *     10 (old)  ->  local 2, regional 2, national 2, global 2, person 2
 *     12        ->  local 3, regional 3, national 2, global 2, person 2
 *     17 (new)  ->  local 4, regional 3, national 4, global 4, person 2
 *
 * At 10 we were taking half the local quota and two fifths of the global one.
 * The complaint that good local events were missing and the complaint that
 * major world milestones were missing had the same cause, and the same fix.
 *
 * 18 would fill every quota exactly. 17 leaves global one short deliberately:
 * global is the tier that most readily supplies filler, and the density of the
 * dump's global rows is the open question tracked for the next dataset pass.
 */
export const MAX_PER_SEGMENT = num('VITE_MAX_PER_SEGMENT', 17);

/** MIRRORS DEFAULT_CONFIG.maxSegments. */
export const MAX_SEGMENTS = num('VITE_MAX_SEGMENTS', 20);

/*
 * Deliberately NOT sent: significanceFloor, scopeFloor (on the base request),
 * scopeQuota, categoryWeights and foundingKindWeights. Per-tier flood control
 * and per-scope thresholds are the engine's job, and letting its defaults
 * apply means a retune in GeoHistory reaches Circa with no release here.
 *
 * significanceFloor is the newest and most important addition to that list.
 * Sending it at all is close to always wrong: the engine raises every scope not
 * named in scopeFloor up to whatever value it receives, so any scalar we send
 * quietly overwrites four separately-tuned thresholds at once.
 */

/* -------------------------------------------------------------------------- */
/* Geocoder                                                                   */
/* -------------------------------------------------------------------------- */

export const PHOTON_HOST = str('VITE_PHOTON_HOST', 'photon.komoot.io');
export const GEOCODE_DEBOUNCE_MS = num('VITE_GEOCODE_DEBOUNCE_MS', 300);
export const GEOCODE_MIN_QUERY = num('VITE_GEOCODE_MIN_QUERY', 3);
export const GEOCODE_LIMIT = num('VITE_GEOCODE_LIMIT', 5);
