import { get, writable } from 'svelte/store';
import { fetchTimeline } from './api';
import { MAX_EVENTS } from './config';
import { emptyDate } from './dates';
import { deriveSegments } from './segments';
import type { CircaResult, LifeEvent, LifeEventKind, SegmentInput } from './types';
import { ValidationError } from './types';

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
