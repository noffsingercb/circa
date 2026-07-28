/**
 * Circa tuning policy -- every knob in one place.
 *
 * Rules of the road:
 *  1. No magic numbers anywhere else in the codebase. If you find yourself
 *     typing a literal into a component or a lib module, it belongs here.
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

/** Most life events one person can enter in the form. */
export const MAX_EVENTS = num('VITE_MAX_EVENTS', 20);

/** Hard ceiling on rendered entries, applied after the engine responds. */
export const GLOBAL_CAP = num('VITE_GLOBAL_CAP', 80);

/** Pixels of vertical timeline per calendar year. Drives the year scale. */
export const PX_PER_YEAR = num('VITE_PX_PER_YEAR', 14);

/** Minimum vertical gap between two entry cards before they get nudged apart. */
export const MIN_GAP_PX = num('VITE_MIN_GAP_PX', 96);

/* -------------------------------------------------------------------------- */
/* ENGINE MIRRORS -- keep in step with geohistory-core DEFAULT_CONFIG         */
/* -------------------------------------------------------------------------- */

/**
 * Sent as EngineConfig.significanceFloor on the first request.
 * MIRRORS geohistory-core DEFAULT_CONFIG.significanceFloor (0.15 as of 0.4.1).
 */
export const BASE_FLOOR = num('VITE_BASE_FLOOR', 0.15);

/**
 * Sparsity backstop. If a segment comes back with fewer than MIN_MATCHES
 * entries, that segment is re-queried at this floor and the extra entries are
 * flagged in the UI as lower-confidence.
 */
export const RELAXED_FLOOR = num('VITE_RELAXED_FLOOR', 0.05);

/** Below this many entries, a segment is considered too sparse. */
export const MIN_MATCHES = num('VITE_MIN_MATCHES', 3);

/** MIRRORS DEFAULT_CONFIG.maxPerSegment (12 in the engine; we ask for fewer). */
export const MAX_PER_SEGMENT = num('VITE_MAX_PER_SEGMENT', 10);

/** MIRRORS DEFAULT_CONFIG.maxSegments. */
export const MAX_SEGMENTS = num('VITE_MAX_SEGMENTS', 20);

/*
 * Deliberately NOT sent: scopeQuota and categoryWeights. Per-tier flood
 * control is the engine's job, and letting its defaults apply means a retune
 * in GeoHistory reaches Circa with no release here.
 */

/* -------------------------------------------------------------------------- */
/* Geocoder                                                                   */
/* -------------------------------------------------------------------------- */

export const PHOTON_HOST = str('VITE_PHOTON_HOST', 'photon.komoot.io');
export const GEOCODE_DEBOUNCE_MS = num('VITE_GEOCODE_DEBOUNCE_MS', 300);
export const GEOCODE_MIN_QUERY = num('VITE_GEOCODE_MIN_QUERY', 3);
export const GEOCODE_LIMIT = num('VITE_GEOCODE_LIMIT', 5);
