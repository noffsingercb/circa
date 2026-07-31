import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	addEvent,
	events,
	removeEvent,
	reset,
	snapshotLifeEvents,
	timelineEvents
} from '../src/lib/session';
import type { LifeEvent, ResolvedPlace } from '../src/lib/types';

const PUEBLO: ResolvedPlace = {
	name: 'Pueblo, Colorado, United States',
	lat: 38.2544,
	lng: -104.6091,
	level: 'locality',
	placeKey: 'united states|colorado|pueblo county|pueblo'
};

const CHICAGO: ResolvedPlace = {
	name: 'Chicago, Illinois, United States',
	lat: 41.8781,
	lng: -87.6298,
	level: 'locality',
	placeKey: 'united states|illinois|cook county|chicago'
};

function event(partial: Partial<LifeEvent> & Pick<LifeEvent, 'id' | 'kind'>): LifeEvent {
	return {
		label: '',
		placeQuery: '',
		place: PUEBLO,
		date: { year: 1900, month: null, day: null },
		...partial
	};
}

// The stores are module-level singletons, so each test starts from a known
// form rather than inheriting the last one.
beforeEach(() => {
	reset();
});

describe('snapshotLifeEvents', () => {
	it('keeps only rows the engine was told about', () => {
		const snapshot = snapshotLifeEvents([
			event({ id: '1', kind: 'birth', date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'residence', place: null, date: { year: 1930, month: null, day: null } }),
			event({ id: '3', kind: 'residence', date: { year: null, month: null, day: null } })
		]);

		// Same rule deriveSegments applies. A row with no place or no year had no
		// influence on the result, so drawing it would imply the history around it
		// had been searched.
		expect(snapshot).toHaveLength(1);
		expect(snapshot[0].id).toBe('1');
	});

	it('does not follow the originals when the form keeps changing', () => {
		const live = event({
			id: '1',
			kind: 'birth',
			place: PUEBLO,
			date: { year: 1902, month: null, day: null }
		});

		const snapshot = snapshotLifeEvents([live]);

		// Exactly how EventRow edits a row: in place, on the same object, with no
		// reassignment anywhere. This is the shape of the bug that put only the
		// birth on the timeline, and a shallow copy would fail here on the date
		// while passing every other assertion in this file.
		live.date.year = 1999;
		live.place = CHICAGO;
		live.label = 'edited after the fact';

		expect(snapshot[0].date.year).toBe(1902);
		expect(snapshot[0].place?.name).toContain('Pueblo');
		expect(snapshot[0].label).toBe('');
	});

	it('starts empty and is cleared by reset', () => {
		expect(get(timelineEvents)).toHaveLength(0);
	});
});

describe('addEvent', () => {
	it('inserts a new row above a trailing death', () => {
		// The form opens as birth, death.
		expect(get(events).map((row) => row.kind)).toEqual(['birth', 'death']);

		addEvent();

		// A life that ends and then carries on reads wrong, so the new row goes
		// in ahead of the death rather than after it.
		expect(get(events).map((row) => row.kind)).toEqual(['birth', 'residence', 'death']);
	});

	it('appends when the last row is not a death', () => {
		const death = get(events)[1];
		removeEvent(death.id);
		expect(get(events).map((row) => row.kind)).toEqual(['birth']);

		addEvent();
		addEvent();

		// The rule is deliberately shallow. Once the death is gone, or once
		// someone has arranged their own rows, insertion stops having an opinion.
		expect(get(events).map((row) => row.kind)).toEqual(['birth', 'residence', 'residence']);
	});

	it('gives every row a distinct id', () => {
		addEvent();
		addEvent();

		const ids = get(events).map((row) => row.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
