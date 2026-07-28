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

export const events = writable<LifeEvent[]>(initialRows());
export const status = writable<Status>('idle');
export const result = writable<CircaResult | null>(null);
export const errorMessage = writable<string>('');
export const segments = writable<SegmentInput[]>([]);

export function addEvent(): void {
	events.update((rows) => (rows.length >= MAX_EVENTS ? rows : [...rows, newEvent()]));
}

export function removeEvent(id: string): void {
	events.update((rows) => (rows.length <= 1 ? rows : rows.filter((row) => row.id !== id)));
}

export function reset(): void {
	events.set(initialRows());
	result.set(null);
	segments.set([]);
	errorMessage.set('');
	status.set('idle');
}

export async function submit(): Promise<void> {
	errorMessage.set('');

	let derived: SegmentInput[];
	try {
		derived = deriveSegments(get(events));
	} catch (error) {
		status.set('error');
		errorMessage.set(
			error instanceof ValidationError ? error.message : 'That timeline could not be read.'
		);
		return;
	}

	segments.set(derived);
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
