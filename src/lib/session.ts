import { get, writable } from 'svelte/store';
import { fetchTimeline } from './api';
import { MAX_EVENTS } from './config';
import { daysInMonth, emptyDate } from './dates';
import { deriveSegments } from './segments';
import type {
	CircaResult,
	LifeEvent,
	LifeEventKind,
	PlaceLevel,
	ResolvedPlace,
	SegmentInput
} from './types';
import { LIFE_EVENT_KINDS, ValidationError } from './types';

/**
 * All app state, held in memory only.
 *
 * Nothing here is persisted: no cookies, no localStorage, no accounts, no
 * identifiers of any kind. A refresh loses the form, which is the intended
 * trade for asking nothing of the visitor.
 */

export type Status = 'idle' | 'loading' | 'ready' | 'error';

let counter = 0;

export function newEvent(kind: LifeEventKind = 'residence'): LifeEvent {
	counter += 1;
	return {
		id: `row-${counter}`,
		kind,
		label: '',
		date: emptyDate(),
		place: null,
		placeQuery: ''
	};
}

function initialRows(): LifeEvent[] {
	// Seeded with birth and death because one of the two is required.
	return [newEvent('birth'), newEvent('death')];
}

/** The form's live rows. Mutated in place by EventRow; see snapshotLifeEvents. */
export const events = writable<LifeEvent[]>(initialRows());

/**
 * The life events the current result was built from.
 *
 * Deliberately separate from `events`. Two reasons, one a bug and one a
 * principle.
 *
 * The bug: EventRow edits its row object in place and never reassigns the
 * array, so the `events` store does not emit when a place or a year is typed.
 * It emits only when a row is added or removed. Anything deriving from
 * `$events` reactively therefore sees a snapshot frozen at the last add --
 * which is why the birth appeared on the timeline and the two rows filled in
 * after it did not.
 *
 * The principle: even with reactivity working, the timeline describes a
 * request that has already been answered. Editing the form afterwards should
 * not quietly move tiles around on a result those edits had no part in. This
 * store changes only when a new timeline is built.
 */
export const timelineEvents = writable<LifeEvent[]>([]);

export const status = writable<Status>('idle');
export const result = writable<CircaResult | null>(null);
export const errorMessage = writable<string>('');
export const segments = writable<SegmentInput[]>([]);

/**
 * Copy the rows that actually reached the engine.
 *
 * Filtered on place and year, the same test deriveSegments applies when
 * deciding what to send. A row the engine was never told about should not
 * appear on the rail as though the history around it had been searched.
 *
 * Copied rather than referenced because the originals remain bound to the
 * form. Holding references would reintroduce the same bug from the other
 * direction: the tiles would drift as the visitor kept typing. The date object
 * is copied too, since that is the part EventRow binds to most directly.
 */
export function snapshotLifeEvents(rows: LifeEvent[]): LifeEvent[] {
	return rows
		.filter((row) => row.place !== null && row.date.year !== null)
		.map((row) => ({ ...row, date: { ...row.date }, place: row.place ? { ...row.place } : null }));
}

/**
 * Where a newly added row belongs.
 *
 * The form opens with a birth and a death, so appending put every added row
 * after the death -- a life that ends and then carries on. The timeline sorts
 * by date regardless, so the form was the only place that read out of order,
 * and it was the place the visitor was actually looking.
 *
 * The test is deliberately shallow: only a death in the final position moves.
 * Anything else appends. If someone has already arranged their rows, or has
 * removed the death, this should not have an opinion about it.
 */
function insertionIndex(rows: LifeEvent[]): number {
	const last = rows.length - 1;
	if (last < 0) return 0;
	return rows[last].kind === 'death' ? last : rows.length;
}

export function addEvent(): void {
	events.update((rows) => {
		if (rows.length >= MAX_EVENTS) return rows;
		const next = rows.slice();
		next.splice(insertionIndex(rows), 0, newEvent());
		return next;
	});
}

export function removeEvent(id: string): void {
	events.update((rows) => (rows.length <= 1 ? rows : rows.filter((row) => row.id !== id)));
}

export function reset(): void {
	events.set(initialRows());
	timelineEvents.set([]);
	result.set(null);
	segments.set([]);
	errorMessage.set('');
	status.set('idle');
}

export async function submit(): Promise<void> {
	errorMessage.set('');

	// Read once. Everything below describes this set of rows, even if the form
	// changes while the request is in flight.
	const rows = get(events);

	let derived: SegmentInput[];
	try {
		derived = deriveSegments(rows);
	} catch (error) {
		status.set('error');
		errorMessage.set(
			error instanceof ValidationError ? error.message : 'That timeline could not be read.'
		);
		return;
	}

	segments.set(derived);
	timelineEvents.set(snapshotLifeEvents(rows));
	status.set('loading');

	try {
		result.set(await fetchTimeline(derived));
		status.set('ready');
	} catch (error) {
		status.set('error');
		errorMessage.set(
			error instanceof Error && error.name === 'ApiError'
				? 'The history service is not answering right now. Try again in a moment.'
				: 'Something went wrong building that timeline.'
		);
	}
}

/* -------------------------------------------------------------------------- */
/* SHARE LINKS                                                                */
/* -------------------------------------------------------------------------- */

/**
 * A timeline is shared by encoding its INPUTS, not its output.
 *
 * /v1/timeline is deterministic: the same segments against the same dataset
 * return the same entries. So a link needs no write endpoint, no storage, no
 * accounts and no expiry -- the recipient's browser re-runs the query and
 * rebuilds the identical page.
 *
 * What gets encoded is the life events, not the derived segments. The tiles
 * for the sender's own birth, moves and death come from TimelineView's
 * lifeEvents prop, so a segments-only payload would hand the recipient the
 * history with the life removed from it -- the one thing the sender meant to
 * show. (The /embed route has exactly that bug today.) deriveSegments then
 * runs on the recipient's side from the same rows, so their query is the
 * sender's query by construction rather than by agreement.
 *
 * The payload belongs in the URL FRAGMENT. It contains a named person's birth
 * date and birthplace, and fragments are never sent to the server, so the
 * payload stays out of Cloudflare's and Render's request logs. A query string
 * would put a date of birth into two providers' logs on every open.
 */

/** Bumped only for a breaking payload change. Older links then decode to null. */
export const SHARE_VERSION = 1;

/**
 * The wire shape. Short keys because every character is in a pasted link, and
 * absent rather than null for anything unknown -- JSON.stringify omits
 * undefined, so a year-only date costs no bytes for month and day.
 */
interface SharedPlace {
	name: string;
	lat: number;
	lng: number;
	level: PlaceLevel;
}

interface SharedEvent {
	kind: LifeEventKind;
	label?: string;
	y: number;
	m?: number;
	d?: number;
	place: SharedPlace;
}

interface SharePayload {
	v: number;
	/** The sender's dataset, so drift can be disclosed rather than hidden. */
	dataset: string | null;
	events: SharedEvent[];
}

export interface DecodedShare {
	events: LifeEvent[];
	datasetVersion: string | null;
}

const SHARE_KINDS = new Set<string>(LIFE_EVENT_KINDS.map((kind) => kind.value));
const SHARE_LEVELS = new Set<string>(['locality', 'county', 'admin1', 'country']);

/** Longest values worth carrying. A link is untrusted input; nothing unbounded. */
const MAX_LABEL_CHARS = 120;
const MAX_PLACE_CHARS = 200;

/**
 * Build the fragment payload for a set of life events.
 *
 * Returns the encoded string WITHOUT a leading '#', or '' when there is
 * nothing worth sharing. Filtered through snapshotLifeEvents so the link
 * describes exactly the rows the engine was told about -- a row with no place
 * or no year had no influence on the result and should not travel.
 *
 * Deliberately dropped: `id` and `placeQuery`. Both are UI bookkeeping. Ids
 * are regenerated on load, and a half-typed place box is not something to send
 * to somebody else.
 *
 * Plain JSON rather than base64. Base64 inflates by about a third, so it would
 * make the link longer AND unreadable -- and being able to read a broken link
 * by eye is worth real money the first time one misbehaves. If length ever
 * genuinely bites, the answer is compression, not encoding.
 */
export function encodeShare(rows: LifeEvent[], datasetVersion: string | null = null): string {
	const usable = snapshotLifeEvents(rows).slice(0, MAX_EVENTS);
	if (usable.length === 0) return '';

	const payload: SharePayload = {
		v: SHARE_VERSION,
		dataset: datasetVersion,
		events: usable.map((row) => {
			const place = row.place as ResolvedPlace;
			const shared: SharedEvent = {
				kind: row.kind,
				y: row.date.year as number,
				place: {
					name: place.name,
					lat: place.lat,
					lng: place.lng,
					level: place.level
				}
			};
			if (row.label) shared.label = row.label.slice(0, MAX_LABEL_CHARS);
			if (row.date.month !== null) shared.m = row.date.month;
			if (row.date.day !== null) shared.d = row.date.day;
			return shared;
		})
	};

	return encodeURIComponent(JSON.stringify(payload));
}

/**
 * Read a fragment payload back into rows the form can hold.
 *
 * Returns null for anything it cannot vouch for, and never throws. This is the
 * only function in the app fed by a string that has been through a chat
 * window, a mail client and possibly somebody's text editor, so every field is
 * checked rather than asserted. The caller's fallback is the empty form the
 * visitor would have got anyway, which makes null a perfectly good answer.
 *
 * Partial rows are dropped individually; a bad row does not sink the link. A
 * payload with no surviving rows does return null, because filling the form
 * with nothing and running a query against it is worse than not trying.
 */
export function decodeShare(fragment: string): DecodedShare | null {
	const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
	if (raw.trim() === '') return null;

	let parsed: unknown;
	try {
		parsed = JSON.parse(decodeURIComponent(raw));
	} catch {
		// Covers both a malformed percent-encoding and malformed JSON. Neither is
		// recoverable and neither is worth distinguishing to the visitor.
		return null;
	}

	if (typeof parsed !== 'object' || parsed === null) return null;
	const payload = parsed as Partial<SharePayload>;

	// An unrecognised version is a link from a future build. Refusing it shows
	// an empty form; guessing at it would show a wrong timeline confidently.
	if (payload.v !== SHARE_VERSION) return null;
	if (!Array.isArray(payload.events)) return null;

	// MAX_EVENTS is the form's own ceiling. A hand-edited link claiming five
	// hundred rows is rejected outright rather than truncated, since a
	// truncated timeline is a wrong timeline shown without comment.
	if (payload.events.length === 0 || payload.events.length > MAX_EVENTS) return null;

	const rows: LifeEvent[] = [];
	for (const candidate of payload.events) {
		const row = readSharedEvent(candidate);
		if (row !== null) rows.push(row);
	}
	if (rows.length === 0) return null;

	return {
		events: rows,
		datasetVersion: typeof payload.dataset === 'string' ? payload.dataset : null
	};
}

function readSharedEvent(candidate: unknown): LifeEvent | null {
	if (typeof candidate !== 'object' || candidate === null) return null;
	const source = candidate as Record<string, unknown>;

	const place = readSharedPlace(source.place);
	if (place === null) return null;

	// Same bounds assertValid enforces. Rejecting here keeps a nonsense year out
	// of the form rather than letting it fail later as a validation error the
	// visitor did not cause and cannot explain.
	const year = readInt(source.y, 1, 2200);
	if (year === null) return null;

	const month = readInt(source.m, 1, 12);
	// A day without a month is invalid, so it is dropped with the month.
	const day = month === null ? null : readInt(source.d, 1, daysInMonth(year, month));

	// An unknown kind still describes a place and a time, which is most of what
	// a row is for. 'other' keeps it on the timeline instead of discarding it.
	const kind =
		typeof source.kind === 'string' && SHARE_KINDS.has(source.kind)
			? (source.kind as LifeEventKind)
			: 'other';

	// Through newEvent so the id counter stays the single source of row ids.
	const row = newEvent(kind);
	row.label = typeof source.label === 'string' ? source.label.slice(0, MAX_LABEL_CHARS) : '';
	row.date = { year, month, day };
	row.place = place;
	// The place box shows the resolved name, so the recipient sees a filled-in
	// form rather than a blank field sitting above a located row.
	row.placeQuery = place.name;
	return row;
}

function readSharedPlace(value: unknown): ResolvedPlace | null {
	if (typeof value !== 'object' || value === null) return null;
	const source = value as Record<string, unknown>;

	const name = typeof source.name === 'string' ? source.name.trim().slice(0, MAX_PLACE_CHARS) : '';
	const lat = readNumber(source.lat);
	const lng = readNumber(source.lng);
	if (name === '' || lat === null || lng === null) return null;
	if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

	const level =
		typeof source.level === 'string' && SHARE_LEVELS.has(source.level)
			? (source.level as PlaceLevel)
			: 'locality';

	return {
		name,
		lat,
		lng,
		level,
		// Regenerated rather than carried, and NOT cosmetic: mergeAdjacent in
		// segments.ts compares placeKey to decide whether two consecutive rows
		// collapse into a single segment. The same place always arrives with the
		// same name string, so a lowercased name merges in exactly the cases the
		// geocoder's own key would.
		placeKey: name.toLowerCase()
	};
}

function readNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readInt(value: unknown, min: number, max: number): number | null {
	if (typeof value !== 'number' || !Number.isInteger(value)) return null;
	return value >= min && value <= max ? value : null;
}
