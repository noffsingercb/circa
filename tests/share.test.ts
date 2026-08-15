import { beforeEach, describe, expect, it } from 'vitest';
import { decodeShare, encodeShare } from '../src/lib/share';
import { reset } from '../src/lib/session';
import { deriveSegments } from '../src/lib/segments';
import { MAX_EVENTS } from '../src/lib/config';
import { LIFE_EVENT_KINDS } from '../src/lib/types';
import type { LifeEvent, ResolvedPlace, SegmentInput } from '../src/lib/types';

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

/**
 * Coordinates are deliberately lossy on the wire, so segments are compared
 * through the same rounding rather than with toEqual. Everything else must
 * match exactly.
 */
function shape(segments: SegmentInput[]) {
	return segments.map((segment) => ({
		label: segment.label,
		start: segment.start,
		end: segment.end,
		name: segment.place.name,
		level: segment.place.level,
		lat: Number(segment.place.lat.toFixed(3)),
		lng: Number(segment.place.lng.toFixed(3))
	}));
}

const sender: LifeEvent[] = [
	event({ id: 'a', kind: 'birth', place: PUEBLO, date: { year: 1902, month: 4, day: 9 } }),
	event({
		id: 'b',
		kind: 'residence',
		place: CHICAGO,
		label: 'Moved north',
		date: { year: 1921, month: null, day: null }
	})
];

beforeEach(() => {
	reset();
});

describe('encodeShare / decodeShare', () => {
	it('round trips the fields that describe a life', async () => {
		const decoded = await decodeShare(await encodeShare(sender, 'dump-v0.5'));

		expect(decoded).not.toBeNull();
		expect(decoded?.datasetVersion).toBe('dump-v0.5');
		expect(decoded?.events).toHaveLength(2);

		const [birth, move] = decoded!.events;
		expect(birth.kind).toBe('birth');
		expect(birth.date).toEqual({ year: 1902, month: 4, day: 9 });
		expect(birth.place?.name).toBe(PUEBLO.name);
		expect(birth.place?.level).toBe('locality');
		// Rounded to three decimals, about 110m.
		expect(birth.place?.lat).toBeCloseTo(PUEBLO.lat, 3);
		expect(birth.place?.lng).toBeCloseTo(PUEBLO.lng, 3);

		expect(move.kind).toBe('residence');
		expect(move.label).toBe('Moved north');
		expect(move.date).toEqual({ year: 1921, month: null, day: null });
		// The place box shows the resolved name, so the recipient sees a filled
		// form rather than located rows above empty fields.
		expect(move.placeQuery).toBe(CHICAGO.name);
	});

	it('produces the same segments on the recipient side', async () => {
		const decoded = await decodeShare(await encodeShare(sender, null));

		// The real promise of a share link is not that the fields survive -- it is
		// that the recipient runs the SAME QUERY, since that is the only reason
		// the same timeline comes back.
		expect(shape(deriveSegments(decoded!.events))).toEqual(shape(deriveSegments(sender)));
	});

	it('keeps two same-named places in separate segments', async () => {
		const portsmouths: LifeEvent[] = [
			event({
				id: 'a',
				kind: 'birth',
				date: { year: 1902, month: null, day: null },
				place: {
					name: 'Portsmouth',
					lat: 36.8354,
					lng: -76.2983,
					level: 'locality',
					placeKey: 'united states|virginia|portsmouth'
				}
			}),
			event({
				id: 'b',
				kind: 'residence',
				date: { year: 1930, month: null, day: null },
				place: {
					name: 'Portsmouth',
					lat: 43.0757,
					lng: -70.7608,
					level: 'locality',
					placeKey: 'united states|new hampshire|portsmouth'
				}
			})
		];

		const decoded = await decodeShare(await encodeShare(portsmouths, null));

		// Both are real rows in our own dataset, 800km apart. A placeKey built
		// from the name would collapse these into one segment and quietly delete
		// half the life.
		expect(deriveSegments(decoded!.events)).toHaveLength(2);
	});

	it('gives the decoded rows fresh ids rather than the sender\u2019s', async () => {
		const decoded = await decodeShare(await encodeShare(sender, null));
		const ids = decoded!.events.map((row) => row.id);

		expect(new Set(ids).size).toBe(2);
		expect(ids).not.toContain('a');
	});

	it('leaves out rows the engine was never told about', async () => {
		const withGaps = [
			...sender,
			event({ id: 'c', kind: 'residence', place: null }),
			event({ id: 'd', kind: 'death', date: { year: null, month: null, day: null } })
		];

		expect((await decodeShare(await encodeShare(withGaps, null)))?.events).toHaveLength(2);
	});

	it('carries a place name through the escape rules intact', async () => {
		const awkward = [
			event({
				id: 'a',
				kind: 'birth',
				date: { year: 1902, month: null, day: null },
				label: 'A label with * and ~ and +',
				place: {
					// A comma and a space are the common case; the accent and the two
					// delimiters are the ones that would corrupt the payload rather
					// than one field.
					name: 'Ca\u00f1\u00f3n City, Colorado * ~ +, United States',
					lat: 38.4416,
					lng: -105.2422,
					level: 'locality',
					placeKey: 'united states|colorado|canon city'
				}
			})
		];

		const decoded = await decodeShare(await encodeShare(awkward, 'dump-v0.5'));

		expect(decoded?.events).toHaveLength(1);
		expect(decoded?.events[0].place?.name).toBe('Ca\u00f1\u00f3n City, Colorado * ~ +, United States');
		expect(decoded?.events[0].label).toBe('A label with * and ~ and +');
	});

	it('encodes every kind the form can produce', async () => {
		// The wire value is an index into SHARE_KIND_ORDER, so a kind added to
		// types.ts and not to share.ts would encode as a different event
		// entirely. This fails the moment that happens.
		for (const { value } of LIFE_EVENT_KINDS) {
			const rows = [
				event({ id: 'a', kind: value, date: { year: 1902, month: null, day: null } })
			];
			const decoded = await decodeShare(await encodeShare(rows, null));
			expect(decoded?.events[0].kind).toBe(value);
		}
	});

	it('stays far shorter than the JSON it replaced', async () => {
		const two = await encodeShare(sender, 'dump-v0.5');

		// v1 spent about 600 characters on exactly this pair, most of it on
		// percent-escaped JSON punctuation.
		expect(two.length).toBeLessThan(250);
	});

	it('compresses a long timeline rather than growing with it', async () => {
		const many = Array.from({ length: 12 }, (_, index) =>
			event({
				id: `row-${index}`,
				kind: 'residence',
				place: index % 2 === 0 ? PUEBLO : CHICAGO,
				date: { year: 1900 + index, month: null, day: null }
			})
		);

		const encoded = await encodeShare(many, 'dump-v0.5');

		// Twelve events of repeated place names is exactly what deflate is good
		// at, so the compressed form should win and be chosen.
		expect(encoded.startsWith('B')).toBe(true);
		expect(encoded.length).toBeLessThan(400);
		expect((await decodeShare(encoded))?.events).toHaveLength(12);
	});

	it('keeps the good rows when one row is broken', async () => {
		const decoded = await decodeShare(
			'A2*~0*1902***38.254*-104.609*0*Pueblo~1*1921***north*-87.63*0*Chicago'
		);

		// A relative should not lose the whole timeline because a chat app mangled
		// one character in the middle of the link.
		expect(decoded?.events).toHaveLength(1);
		expect(decoded?.events[0].date.year).toBe(1902);
	});

	it('keeps an unrecognised kind on the timeline as \u201Cother\u201D', async () => {
		// The row still describes a place and a time, which is most of what a row
		// is for. Discarding it would lose more than relabelling it does.
		const decoded = await decodeShare('A2*~9*1902***38.25*-104.6*0*Pueblo');
		expect(decoded?.events[0].kind).toBe('other');
	});

	it('drops a day that arrives without a month', async () => {
		// assertValid rejects a day with no month, and it would do so on the
		// recipient's screen as an error they did not cause and cannot fix.
		const decoded = await decodeShare('A2*~0*1902**9*38.25*-104.6*0*Pueblo');
		expect(decoded?.events[0].date).toEqual({ year: 1902, month: null, day: null });
	});

	it('returns null for an empty or unreadable fragment', async () => {
		expect(await decodeShare('')).toBeNull();
		expect(await decodeShare('#')).toBeNull();
		expect(await decodeShare('A')).toBeNull();
		expect(await decodeShare('A2*')).toBeNull(); // header, no rows
		expect(await decodeShare('A2*~garbage')).toBeNull(); // no row survives
		expect(await decodeShare('Z2*~0*1902***38.25*-104.6*0*Pueblo')).toBeNull(); // unknown mode
		expect(await decodeShare('B!!!not!base64')).toBeNull();
		expect(await decodeShare('A2*~0*1902***38.25*-104.6*0*%E0%A4%A')).toBeNull(); // bad escape
	});

	it('refuses a payload from a future version rather than guessing', async () => {
		// An empty form is a better outcome than a wrong timeline shown with
		// confidence.
		expect(await decodeShare('A3*~0*1902***38.25*-104.6*0*Pueblo')).toBeNull();
	});

	it('refuses more rows than the form itself allows', async () => {
		const rows = Array.from(
			{ length: MAX_EVENTS + 1 },
			() => '1*1902***38.25*-104.6*0*Pueblo'
		).join('~');

		// Rejected outright rather than truncated: a truncated timeline is a wrong
		// timeline, and it would be shown without comment.
		expect(await decodeShare(`A2*~${rows}`)).toBeNull();
	});
});
