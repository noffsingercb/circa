import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import {
	addEvent,
	decodeShare,
	encodeShare,
	events,
	removeEvent,
	reset,
	snapshotLifeEvents,
	SHARE_VERSION,
	timelineEvents
} from '../src/lib/session';
import { deriveSegments } from '../src/lib/segments';
import { MAX_EVENTS } from '../src/lib/config';
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

describe('encodeShare / decodeShare', () => {
	const sender: LifeEvent[] = [
		event({
			id: 'a',
			kind: 'birth',
			place: PUEBLO,
			date: { year: 1902, month: 4, day: 9 }
		}),
		event({
			id: 'b',
			kind: 'residence',
			place: CHICAGO,
			label: 'Moved north',
			date: { year: 1921, month: null, day: null }
		})
	];

	it('round trips the fields that describe a life', () => {
		const decoded = decodeShare(encodeShare(sender, 'dump-v0.5'));

		expect(decoded).not.toBeNull();
		expect(decoded?.datasetVersion).toBe('dump-v0.5');
		expect(decoded?.events).toHaveLength(2);

		const [birth, move] = decoded!.events;
		expect(birth.kind).toBe('birth');
		expect(birth.date).toEqual({ year: 1902, month: 4, day: 9 });
		expect(birth.place?.name).toBe(PUEBLO.name);
		expect(birth.place?.lat).toBe(PUEBLO.lat);
		expect(birth.place?.lng).toBe(PUEBLO.lng);
		expect(move.label).toBe('Moved north');
		expect(move.date).toEqual({ year: 1921, month: null, day: null });

		// The place box shows the resolved name, so the recipient sees a filled
		// form rather than located rows above empty fields.
		expect(move.placeQuery).toBe(CHICAGO.name);
	});

	it('produces the same segments on the recipient side', () => {
		const decoded = decodeShare(encodeShare(sender, null));

		// The real promise of a share link is not that the fields survive -- it is
		// that the recipient runs the SAME QUERY, since that is the only reason
		// the same timeline comes back. This is also the only assertion here that
		// would notice the regenerated placeKey changing where mergeAdjacent
		// collapses two consecutive rows into one segment.
		expect(deriveSegments(decoded!.events)).toEqual(deriveSegments(sender));
	});

	it('gives the decoded rows fresh ids rather than the sender\u2019s', () => {
		const decoded = decodeShare(encodeShare(sender, null));
		const ids = decoded!.events.map((row) => row.id);

		// Ids are UI bookkeeping and are not encoded. They must still be unique,
		// because removeEvent identifies a row by id.
		expect(new Set(ids).size).toBe(2);
		expect(ids).not.toContain('a');
	});

	it('leaves out rows the engine was never told about', () => {
		const withGaps = [
			...sender,
			event({ id: 'c', kind: 'residence', place: null }),
			event({ id: 'd', kind: 'death', date: { year: null, month: null, day: null } })
		];

		expect(decodeShare(encodeShare(withGaps, null))?.events).toHaveLength(2);
	});

	it('keeps the good rows when one row is broken', () => {
		const payload = {
			v: SHARE_VERSION,
			dataset: null,
			events: [
				{ kind: 'birth', y: 1902, place: { name: 'Pueblo', lat: 38.2544, lng: -104.6091 } },
				{ kind: 'residence', y: 1921, place: { name: 'Chicago', lat: 'north' } }
			]
		};

		const decoded = decodeShare(encodeURIComponent(JSON.stringify(payload)));

		// A relative should not lose the whole timeline because a chat app mangled
		// one character in the middle of the link.
		expect(decoded?.events).toHaveLength(1);
		expect(decoded?.events[0].date.year).toBe(1902);
		// A place with no level still locates; only the disclosure is unknown.
		expect(decoded?.events[0].place?.level).toBe('locality');
	});

	it('keeps an unrecognised kind on the timeline as \u201Cother\u201D', () => {
		const payload = {
			v: SHARE_VERSION,
			dataset: null,
			events: [{ kind: 'coronation', y: 1902, place: { name: 'Pueblo', lat: 38.25, lng: -104.6 } }]
		};

		// The row still describes a place and a time, which is most of what a row
		// is for. Discarding it would lose more than relabelling it does.
		expect(decodeShare(encodeURIComponent(JSON.stringify(payload)))?.events[0].kind).toBe('other');
	});

	it('drops a day that arrives without a month', () => {
		const payload = {
			v: SHARE_VERSION,
			dataset: null,
			events: [
				{ kind: 'birth', y: 1902, d: 9, place: { name: 'Pueblo', lat: 38.25, lng: -104.6 } }
			]
		};

		// assertValid rejects a day with no month, and it would do so on the
		// recipient's screen as an error they did not cause and cannot fix.
		expect(decodeShare(encodeURIComponent(JSON.stringify(payload)))?.events[0].date).toEqual({
			year: 1902,
			month: null,
			day: null
		});
	});

	it('returns null for an empty, malformed, or non-JSON fragment', () => {
		expect(decodeShare('')).toBeNull();
		expect(decodeShare('#')).toBeNull();
		expect(decodeShare('%E0%A4%A')).toBeNull(); // decodeURIComponent throws
		expect(decodeShare('not json at all')).toBeNull();
		expect(decodeShare(encodeURIComponent('"a string"'))).toBeNull();
		expect(decodeShare(encodeURIComponent('{"v":1,"events":[]}'))).toBeNull();
	});

	it('refuses a payload from a future version rather than guessing', () => {
		const payload = {
			v: SHARE_VERSION + 1,
			dataset: null,
			events: [{ kind: 'birth', y: 1902, place: { name: 'Pueblo', lat: 38.25, lng: -104.6 } }]
		};

		// An empty form is a better outcome than a wrong timeline shown with
		// confidence.
		expect(decodeShare(encodeURIComponent(JSON.stringify(payload)))).toBeNull();
	});

	it('refuses more rows than the form itself allows', () => {
		const payload = {
			v: SHARE_VERSION,
			dataset: null,
			events: Array.from({ length: MAX_EVENTS + 1 }, () => ({
				kind: 'residence',
				y: 1902,
				place: { name: 'Pueblo', lat: 38.25, lng: -104.6 }
			}))
		};

		// Rejected outright rather than truncated: a truncated timeline is a wrong
		// timeline, and it would be shown without comment.
		expect(decodeShare(encodeURIComponent(JSON.stringify(payload)))).toBeNull();
	});
});
