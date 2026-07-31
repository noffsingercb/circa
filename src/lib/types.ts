/**
 * Type contract shared with the GeoHistory engine.
 *
 * The engine half of this file mirrors geohistory-core@0.5.1. It is restated
 * here rather than imported so that Circa builds and tests today, before
 * packages/geohistory-core is extracted and published. Once the package is on
 * npm, delete the ENGINE CONTRACT block and re-export from the package instead;
 * the names are identical on purpose.
 *
 * This file sat at 0.4.1 while the engine moved to 0.5.1 -- three minor
 * versions of silent drift, which is the failure mode the comment above was
 * meant to prevent. Nothing broke, because TypeScript cannot check a JSON
 * response against a hand-written interface: the engine added displayTitle and
 * Circa simply never saw it. When editing this block, check it against
 * core.ts rather than against what Circa happens to use.
 */

/* -------------------------------------------------------------------------- */
/* ENGINE CONTRACT -- mirrors geohistory-core@0.5.1                           */
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
	/**
	 * A single floor applied across every scope.
	 *
	 * Sending this is almost always a mistake now that scopeFloor exists. The
	 * engine treats it as a blanket minimum: any scope not named explicitly in
	 * scopeFloor is raised to at least this value. So passing 0.15 -- the old
	 * default -- silently lifts the local floor from 0.05 back to 0.15 and
	 * cancels the local-tier tuning from GeoHistory PR #8.
	 *
	 * It does still have one legitimate use: it is the floor applied to the
	 * person tier (birth/death), which scopeFloor does not cover.
	 */
	significanceFloor?: number;

	/**
	 * Per-scope significance floors. Added in 0.5.0.
	 *
	 * Engine defaults: local 0.05, regional 0.15, national 0.15, global 0.20.
	 * The low local floor is deliberate -- the curated local rows average 0.133
	 * significance, below the old uniform 0.15, which is why local history was
	 * being filtered out before selection ever ran.
	 *
	 * An explicitly named scope is used as given and is NOT raised by
	 * significanceFloor.
	 */
	scopeFloor?: Partial<Record<Scope, number>>;

	/**
	 * How many birth/death rows may be drawn per segment. Added in 0.5.0.
	 *
	 * Persons draw from their own tier rather than competing for local slots.
	 * Before this, a well-known person could take local slots from curated local
	 * history purely by having a high significance percentile.
	 */
	personQuota?: number;

	maxPerSegment?: number;
	maxSegments?: number;
	scopeQuota?: Record<Scope, number>;
	categoryWeights?: Record<string, number>;

	/**
	 * Weights by founding kind, so a settlement founding does not carry the same
	 * weight as a country's. Engine defaults: settlement 0.35, institution 0.50,
	 * subnational 0.90, country 0.90.
	 */
	foundingKindWeights?: Record<string, number>;
}

export interface TimelineEntry {
	id: string;

	/** The raw stored title, which for dump rows is often just a place name. */
	title: string;

	/**
	 * The title meant for display. Added in 0.5.1.
	 *
	 * The dump titles rows after entities, so a founding arrives as "Oklahoma"
	 * and a discovery as "Insulin". display-titles.ts rewrites those into
	 * "Oklahoma Statehood", "Founding of Plymouth", "Discovery of Insulin".
	 *
	 * ALWAYS populated -- the engine falls back to `title` when no display title
	 * was generated, so UI code never needs a fallback of its own.
	 */
	displayTitle: string;

	/** Null for rows that never had a summary; the dump has many. */
	blurb: string | null;

	date: string;
	dateStartISO: string;
	dateEndISO: string;
	precision: Precision;
	lat: number;
	lng: number;
	distanceKm: number;
	reachKm: number;

	/**
	 * The event's stored scope -- NOT the tier it was drawn from.
	 *
	 * Births and deaths keep a stored scope of 'local' while being selected from
	 * the person tier, so a person row arrives here labelled 'local'. Rendering
	 * this verbatim as a badge misdescribes it. Nullable because the dump has
	 * rows no scope rule has classified.
	 */
	scope: Scope | null;

	significance: number;

	/** e.g. 'birth', 'death', 'founding', 'discovery', 'milestone'. */
	category: string | null;

	sourceUrl: string | null;
	segmentIndex: number;
	score: number;
}

export interface Timeline {
	/** Null when the database carries no dataset_version stamp. */
	datasetVersion: string | null;
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
	datasetVersion: string | null;
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
