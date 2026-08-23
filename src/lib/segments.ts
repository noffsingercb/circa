import { DEATH_LOOKBACK_YEARS, LIFESPAN_CAP_YEARS, MAX_SEGMENTS } from './config';
import { addYears, assertValid, hasYear, isoEnd, isoStart, todayISO } from './dates';
import type { LifeEvent, SegmentInput } from './types';
import { ValidationError } from './types';

/**
 * Turn a handful of life events into the contiguous place-and-time segments
 * the engine queries against.
 *
 * This is the only genuinely Circa-owned piece of logic in the app. It depends
 * on our input model, not on how the engine scores anything, which is why
 * engine retunes never require a change here.
 *
 * Rules (locked 2026-07-28):
 *  - At least one birth or death is required. Without an anchor we have no
 *    defensible way to bound the lifespan.
 *  - Birth with no death: the window runs LIFESPAN_CAP_YEARS forward.
 *  - Death with no birth: the window runs LIFESPAN_CAP_YEARS backward, and the
 *    earliest known place stands in for the place of birth.
 *  - Each event opens a segment that runs until the next event begins.
 *  - Consecutive segments resolving to the same city are merged.
 *
 * Amended 2026-07-30:
 *  - A final segment anchored on a death reaches DEATH_LOOKBACK_YEARS backward
 *    from that death, because a death is an end date and the rule above would
 *    otherwise give it no duration at all.
 *
 * Amended 2026-08-22:
 *  - The forward projection stops at today. See openEndedEnd.
 *  - No event may be dated in the future at all; assertValid enforces it, so
 *    the guard inside openEndedEnd is now unreachable from the form and
 *    survives only for timelines rebuilt from a shared URL.
 */
export function deriveSegments(events: LifeEvent[]): SegmentInput[] {
	const usable = events.filter((event) => event.place !== null && hasYear(event.date));

	if (usable.length === 0) {
		throw new ValidationError(
			'NO_EVENTS',
			'Add at least one life event with both a place and a year.'
		);
	}

	for (const event of usable) {
		assertValid(event.date, event.label || event.kind);
	}

	const hasAnchor = usable.some((event) => event.kind === 'birth' || event.kind === 'death');
	if (!hasAnchor) {
		throw new ValidationError(
			'NO_ANCHOR',
			'Add either a birth or a death so the timeline has somewhere to start.'
		);
	}

	const sorted = [...usable].sort((a, b) => {
		const byDate = isoStart(a.date).localeCompare(isoStart(b.date));
		return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
	});

	const birth = sorted.find((event) => event.kind === 'birth');
	const death = [...sorted].reverse().find((event) => event.kind === 'death');

	const spanStart = birth
		? isoStart(birth.date)
		: addYears(isoStart(sorted[0].date), -LIFESPAN_CAP_YEARS);

	const spanEnd = death ? isoEnd(death.date) : openEndedEnd(spanStart);

	const segments: SegmentInput[] = sorted.map((event, index) => {
		const place = event.place as NonNullable<LifeEvent['place']>;
		const start = index === 0 ? spanStart : isoStart(event.date);
		const end = index === sorted.length - 1 ? spanEnd : isoStart(sorted[index + 1].date);
		return {
			label: event.label || defaultLabel(event),
			place: { name: place.name, lat: place.lat, lng: place.lng, level: place.level },
			start,
			end
		};
	});

	applyDeathLookback(segments, sorted);

	return mergeAdjacent(segments, sorted).slice(0, MAX_SEGMENTS);
}

/**
 * Where a life with no recorded death stops.
 *
 * LIFESPAN_CAP_YEARS exists to bound an unknown: someone born in 1830 with no
 * death on record did not live forever, and a century is a defensible outer
 * edge. Applied unconditionally, though, it also projects INTO THE FUTURE for
 * anybody still alive -- a birth in 1950 asked for a window ending in 2050.
 *
 * That was a live bug, not a theoretical one. The API refuses any year past
 * next year (validateInput: MIN_YEAR_ACCEPTED..currentYear+1), so every
 * death-less timeline anchored on a birth in 1928 or later came back 400,
 * which Circa then reported as the history service being unavailable. On
 * 2026-08-23 a visitor hit it within a minute of arriving:
 *
 *   POST /v1/timeline 400 1ms ip=136.32.129.0
 *
 * Clamping to today is both the fix and the more honest window, because the
 * projected years were never worth anything: there is no history to find in
 * 2050, so the request was strictly larger than the answer it could return.
 * LIFESPAN_CAP_YEARS keeps its full meaning for the case it was written for --
 * a birth long enough ago that a century still lands in the past.
 *
 * THE BOUNDARY IS STRICTLY LESS THAN, and that matters. It was `today <=
 * spanStart`, which meant a birth dated exactly today skipped the clamp and
 * projected a century forward -- reproducing the very 400 this function was
 * written to eliminate, for the one input a brand-new parent is most likely to
 * type. A birth today now yields a window of today..today: empty, because a
 * life a few hours old has no history around it yet, but valid.
 *
 * The remaining guard covers a spanStart genuinely AFTER today. assertValid
 * now rejects future dates outright, so nothing typed into the form can reach
 * it; a timeline rebuilt from a hand-edited share URL still can. It is left
 * unclamped on purpose, so the API reports the impossible year rather than an
 * inverted segment.
 */
function openEndedEnd(spanStart: string): string {
	const projected = addYears(spanStart, LIFESPAN_CAP_YEARS);
	const today = todayISO();

	if (today < spanStart) return projected;
	return projected < today ? projected : today;
}

/**
 * Give the final segment a duration when it is anchored on a death.
 *
 * Every other life event is a START: a birth, a marriage or a move begins a
 * stretch of living somewhere, and the general rule -- each event opens a
 * segment running to the next -- describes it correctly. A death is the one
 * event that is an END. Applying the same rule produces a segment that begins
 * and ends on the same day, and no historic event can fall inside a window of
 * zero width, so the last leg of every timeline comes back empty.
 *
 * This is the Denver 1954 segment in the Pueblo run: not a truncation, not a
 * cap, not a scoring problem. There was simply no interval to search.
 *
 * We do not know when the person arrived at the place they died, so the window
 * is an assumption: they had been there DEATH_LOOKBACK_YEARS. The clamp keeps
 * that assumption from reaching back past the event before it, which would
 * invert the segment.
 *
 * Note what this deliberately does NOT do: it does not shorten the preceding
 * segment. Truncating it would assert the person left that city on a date we
 * have no evidence for, and it could only ever remove events already being
 * shown. Letting the two windows overlap asserts uncertainty instead, and
 * costs nothing, because the engine deduplicates by event id across segments
 * -- an event inside both windows is returned once, not twice.
 *
 * Runs before mergeAdjacent so that a death in the same city as the previous
 * event still collapses into one segment.
 */
function applyDeathLookback(segments: SegmentInput[], sorted: LifeEvent[]): void {
	const last = sorted.length - 1;

	// A lone death already gets the LIFESPAN_CAP_YEARS backward window from the
	// death-with-no-birth rule. Shrinking that to eight years would be a
	// regression, so single-event timelines are left alone.
	if (last < 1) return;
	if (sorted[last].kind !== 'death') return;
	if (DEATH_LOOKBACK_YEARS <= 0) return;

	const deathSegment = segments[last];
	const previousStart = segments[last - 1].start;
	const wanted = addYears(deathSegment.end as string, -DEATH_LOOKBACK_YEARS);

	// ISO-8601 dates compare correctly as strings, which is why the whole module
	// works in them. If the person died within the lookback of the previous
	// event, the window simply starts at that event instead.
	deathSegment.start = wanted < previousStart ? previousStart : wanted;
}

function defaultLabel(event: LifeEvent): string {
	switch (event.kind) {
		case 'birth':
			return 'Born';
		case 'death':
			return 'Died';
		case 'marriage':
			return 'Married';
		case 'residence':
			return 'Lived in';
		default:
			return 'Life event';
	}
}

/**
 * Two events in the same city produce one continuous segment. Resolution stops
 * at the city -- two addresses across town are not far enough apart to change
 * which events reach them.
 */
function mergeAdjacent(segments: SegmentInput[], sorted: LifeEvent[]): SegmentInput[] {
	const merged: SegmentInput[] = [];
	const keys: string[] = [];

	segments.forEach((segment, index) => {
		const key = (sorted[index].place as NonNullable<LifeEvent['place']>).placeKey;
		const previous = merged[merged.length - 1];
		if (previous && keys[keys.length - 1] === key) {
			previous.end = segment.end;
			return;
		}
		merged.push({ ...segment });
		keys.push(key);
	});

	return merged;
}
