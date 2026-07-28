/**
 * Type contract shared with the GeoHistory engine.
 *
 * The engine half of this file mirrors geohistory-core@0.4.1. It is restated
 * here rather than imported so that Circa builds and tests today, before
 * packages/geohistory-core is extracted and published. Once the package is on
 * npm, delete the ENGINE CONTRACT block and re-export from the package instead;
 * the names are identical on purpose.
 */

/* -------------------------------------------------------------------------- */
/* ENGINE CONTRACT -- mirrors geohistory-core@0.4.1                           */
/* -------------------------------------------------------------------------- */

export type Precision = 'day' | 'month' | 'year' | 'decade' | 'century';

export type Scope = 'local' | 'regional' | 'national' | 'global';

export type PlaceLevel = 'locality' | 'county' | 'admin1' | 'country';

export interface PlaceInput {
	name: string;
	lat: number;
	lng: number;
	level?: PlaceLevel;
}

/**
 * Note the absence of a radius. Matching is event-side: each historic event
 * carries its own reach_km, derived from its scope and significance, and an
 * event matches a segment when the segment's point falls inside that reach.
 */
export interface SegmentInput {
	label?: string;
	place: PlaceInput;
	start: string;
	end?: string;
}

export interface EngineConfig {
	significanceFloor?: number;
	maxPerSegment?: number;
	maxSegments?: number;
	scopeQuota?: Record<Scope, number>;
	categoryWeights?: Record<string, number>;
}

export interface TimelineEntry {
	id: string;
	title: string;
	blurb: string;
	date: string;
	dateStartISO: string;
	dateEndISO: string;
	precision: Precision;
	lat: number;
	lng: number;
	distanceKm: number;
	reachKm: number;
	scope: Scope;
	significance: number;
	category: string;
	sourceUrl: string;
	segmentIndex: number;
	score: number;
}

export interface Timeline {
	datasetVersion: string;
	person?: string;
	generatedWith: string;
	entries: TimelineEntry[];
	meta: {
		segmentCount: number;
		totalMatched: number;
		returned: number;
	};
}

/* -------------------------------------------------------------------------- */
/* CIRCA TYPES                                                                */
/* -------------------------------------------------------------------------- */

export type LifeEventKind = 'birth' | 'death' | 'residence' | 'marriage' | 'other';

export const LIFE_EVENT_KINDS: { value: LifeEventKind; label: string }[] = [
	{ value: 'birth', label: 'Born' },
	{ value: 'residence', label: 'Lived in' },
	{ value: 'marriage', label: 'Married' },
	{ value: 'other', label: 'Other' },
	{ value: 'death', label: 'Died' }
];

/** A date the user may only partly know. Year is the minimum useful input. */
export interface PartialDate {
	year: number | null;
	month: number | null;
	day: number | null;
}

/**
 * A geocoded place. `level` records how precise the user's input actually was,
 * which the UI discloses -- it does NOT change how far events reach.
 */
export interface ResolvedPlace {
	name: string;
	lat: number;
	lng: number;
	level: PlaceLevel;
	placeKey: string;
	osmId?: string;
}

export interface LifeEvent {
	id: string;
	kind: LifeEventKind;
	label: string;
	date: PartialDate;
	place: ResolvedPlace | null;
	/** Raw text in the place box, kept so a half-typed entry survives a re-render. */
	placeQuery: string;
}

/** An engine entry plus whether it only surfaced under the relaxed floor. */
export interface CircaEntry extends TimelineEntry {
	relaxed: boolean;
}

export interface CircaResult {
	entries: CircaEntry[];
	datasetVersion: string;
	generatedWith: string;
	/** Indices of segments that needed the relaxed floor to return anything. */
	relaxedSegments: number[];
}

export type ValidationCode = 'NO_ANCHOR' | 'NO_EVENTS' | 'BAD_DATE';

export class ValidationError extends Error {
	readonly code: ValidationCode;

	constructor(code: ValidationCode, message: string) {
		super(message);
		this.name = 'ValidationError';
		this.code = code;
	}
}
