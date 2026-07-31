import { describe, expect, it } from 'vitest';
import { deriveSegments } from '../src/lib/segments';
import type { LifeEvent, ResolvedPlace } from '../src/lib/types';
import { ValidationError } from '../src/lib/types';

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

const DENVER: ResolvedPlace = {
	name: 'Denver, Colorado, United States',
	lat: 39.7392,
	lng: -104.9903,
	level: 'locality',
	placeKey: 'united states|colorado|denver county|denver'
};

const COLORADO: ResolvedPlace = {
	name: 'Colorado, United States',
	lat: 38.7251,
	lng: -105.6077,
	level: 'admin1',
	placeKey: 'united states|colorado||'
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

describe('deriveSegments', () => {
	it('spans birth to end of the death year, splitting at each event', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'marriage', place: CHICAGO, date: { year: 1921, month: 6, day: null } }),
			event({ id: '3', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } })
		]);

		expect(segments).toHaveLength(3);
		expect(segments[0].start).toBe('1902-01-01');
		expect(segments[0].end).toBe('1921-06-01');
		expect(segments[1].start).toBe('1921-06-01');
		expect(segments[1].end).toBe('1954-01-01');

		// The death segment no longer starts on the death date. It used to, and
		// that is what made the final leg of every timeline return nothing --
		// see the death-lookback cases below.
		expect(segments[2].start).toBe('1946-12-31');
		expect(segments[2].end).toBe('1954-12-31');
	});

	it('runs 100 years forward when there is a birth but no death', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', date: { year: 1902, month: 3, day: 14 } })
		]);

		expect(segments[0].start).toBe('1902-03-14');
		expect(segments[0].end).toBe('2002-03-14');
	});

	it('runs 100 years backward when there is a death but no birth', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } })
		]);

		// Guards the lookback against shrinking a lone death from a century to
		// eight years. With one event there is no preceding segment to sit after,
		// and the death-with-no-birth rule already supplies a usable window.
		expect(segments[0].start).toBe('1854-01-01');
		expect(segments[0].end).toBe('1954-12-31');
	});

	it('gives a death-anchored final segment a lookback window', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'residence', place: CHICAGO, date: { year: 1921, month: null, day: null } }),
			event({ id: '3', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } })
		]);

		const denver = segments[2];

		// SegmentInput.end is optional -- a segment with no end is a point in time
		// as far as the engine is concerned -- so it has to be narrowed before it
		// can be compared. deriveSegments always sets it; the type is wider than
		// what this function produces.
		const denverEnd = denver.end as string;

		// Eight years back from the end of the death year, so the window has real
		// width and events near Denver can fall inside it.
		expect(denver.start).toBe('1946-12-31');
		expect(denverEnd).toBe('1954-12-31');
		expect(denver.start < denverEnd).toBe(true);

		// The preceding segment is deliberately NOT truncated: we have no evidence
		// for when the person left Chicago, and shortening it could only remove
		// events already being shown. The overlap is intended, and the engine
		// deduplicates by event id across segments.
		expect(segments[1].end).toBe('1954-01-01');
	});

	it('clamps the lookback to the previous event rather than inverting', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'residence', place: CHICAGO, date: { year: 1950, month: null, day: null } }),
			event({ id: '3', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } })
		]);

		// A full eight-year lookback would start in 1946, before the 1950 move.
		// The window starts at the move instead.
		expect(segments[2].start).toBe('1950-01-01');
		expect(segments[2].end).toBe('1954-12-31');
	});

	it('leaves the final segment alone when the last event is not a death', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'residence', place: CHICAGO, date: { year: 1930, month: null, day: null } })
		]);

		// A residence is a start date and already opens a segment correctly.
		expect(segments[1].start).toBe('1930-01-01');
		expect(segments[1].end).toBe('2002-01-01');
	});

	it('orders events by date regardless of entry order', () => {
		const segments = deriveSegments([
			event({ id: '3', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } }),
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } })
		]);

		expect(segments[0].place.name).toContain('Pueblo');
		expect(segments[1].place.name).toContain('Denver');
	});

	it('merges consecutive events resolving to the same city', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: PUEBLO, date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'marriage', place: PUEBLO, date: { year: 1925, month: null, day: null } }),
			event({ id: '3', kind: 'death', place: DENVER, date: { year: 1954, month: null, day: null } })
		]);

		expect(segments).toHaveLength(2);
		expect(segments[0].start).toBe('1902-01-01');
		expect(segments[0].end).toBe('1954-01-01');
	});

	it('rejects a timeline with no birth and no death', () => {
		expect(() =>
			deriveSegments([
				event({ id: '1', kind: 'residence', date: { year: 1930, month: null, day: null } })
			])
		).toThrowError(ValidationError);
	});

	it('rejects an empty form', () => {
		expect(() => deriveSegments([])).toThrowError(ValidationError);
	});

	it('ignores rows that are missing a place or a year', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', date: { year: 1902, month: null, day: null } }),
			event({ id: '2', kind: 'residence', place: null, date: { year: 1930, month: null, day: null } }),
			event({ id: '3', kind: 'residence', date: { year: null, month: null, day: null } })
		]);

		expect(segments).toHaveLength(1);
	});

	it('passes a coarse place through as a country or state centroid', () => {
		const segments = deriveSegments([
			event({ id: '1', kind: 'birth', place: COLORADO, date: { year: 1902, month: null, day: null } })
		]);

		// The level rides along for disclosure only. It does not shrink or widen
		// anything: reach is a property of each historic event, not of this point.
		expect(segments[0].place.level).toBe('admin1');
		expect(segments[0].place.lat).toBeCloseTo(38.7251, 3);
	});
});
