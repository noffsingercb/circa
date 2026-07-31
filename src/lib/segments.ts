import { DEATH_LOOKBACK_YEARS, LIFESPAN_CAP_YEARS, MAX_SEGMENTS } from './config';
import { addYears, assertValid, hasYear, isoEnd, isoStart } from './dates';
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

	const spanEnd = death
		? isoEnd(death.date)
		: addYears(spanStart, LIFESPAN_CAP_YEARS);

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
