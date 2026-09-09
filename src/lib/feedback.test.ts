import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	bucketDistance,
	buildVote,
	castVote,
	decadeOfIso,
	decadeOfYear,
	DISTANCE_BUCKETS,
	headroomOf,
	recordVote,
	sendVote,
	votedVerdict,
	type Vote
} from './feedback';
import type { CircaEntry } from './types';

/**
 * An in-memory sessionStorage.
 *
 * Installed rather than relying on a DOM environment so these tests describe
 * the module's own contract, including the paths that fire when storage is
 * missing or throwing -- which is a real browser state (Safari private mode),
 * not a hypothetical.
 */
function fakeStorage(): Storage {
	const map = new Map<string, string>();
	return {
		get length() {
			return map.size;
		},
		clear: () => map.clear(),
		getItem: (key: string) => map.get(key) ?? null,
		key: (index: number) => Array.from(map.keys())[index] ?? null,
		removeItem: (key: string) => void map.delete(key),
		setItem: (key: string, value: string) => void map.set(key, value)
	} as Storage;
}

function entry(over: Partial<CircaEntry> = {}): CircaEntry {
	return {
		id: 'e1',
		title: 'Oklahoma',
		displayTitle: 'Oklahoma Statehood',
		blurb: null,
		date: '1907',
		dateStartISO: '1907-11-16',
		dateEndISO: '1907-11-16',
		// Required as of engine 0.6.1. This row is a point event, so its
		// display date is simply its start date and its precision is 'day'.
		displayDateISO: '1907-11-16',
		displayPrecision: 'day',
		precision: 'day',
		lat: 35.5,
		lng: -97.5,
		distanceKm: 120,
		reachKm: 1500,
		scope: 'national',
		// Required since 0.6. The tier a row was DRAWN from, which for this
		// non-person row is the same as its stored scope.
		tier: 'national',
		// Required since 0.6. null = a point event, or a ranged row wholly
		// inside one segment. This fixture is a single-day milestone.
		phase: null,
		significance: 0.62,
		category: 'milestone',
		sourceUrl: null,
		segmentIndex: 0,
		score: 0.5,
		relaxed: false,
		...over
	};
}

beforeEach(() => {
	vi.stubGlobal('sessionStorage', fakeStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('bucketDistance', () => {
	it('places a distance inside the bucket that names it', () => {
		expect(bucketDistance(0)).toBe('0-25');
		expect(bucketDistance(13)).toBe('0-25');
		expect(bucketDistance(37)).toBe('25-50');
		expect(bucketDistance(120)).toBe('100-250');
		expect(bucketDistance(1200)).toBe('1000-1500');
		expect(bucketDistance(9000)).toBe('2500+');
	});

	/*
	 * Every boundary, both sides. This is the only test in the file that would
	 * have caught an off-by-one, and an off-by-one here is invisible downstream:
	 * the vote is accepted, the row is written, and the distance analysis is
	 * simply wrong about which side of 1500 km the complaint came from.
	 */
	it('treats each boundary as the floor of the higher bucket', () => {
		expect(bucketDistance(25)).toBe('25-50');
		expect(bucketDistance(24.99)).toBe('0-25');
		expect(bucketDistance(50)).toBe('50-100');
		expect(bucketDistance(100)).toBe('100-250');
		expect(bucketDistance(250)).toBe('250-500');
		expect(bucketDistance(500)).toBe('500-1000');
		expect(bucketDistance(1000)).toBe('1000-1500');
		expect(bucketDistance(1500)).toBe('1500-2500');
		expect(bucketDistance(2500)).toBe('2500+');
		expect(bucketDistance(2499.99)).toBe('1500-2500');
	});

	it('never returns a name the API would reject', () => {
		const probes = [0, 1, 25, 26, 75, 250, 499, 1499, 1501, 2500, 50_000];
		for (const km of probes) {
			expect(DISTANCE_BUCKETS).toContain(bucketDistance(km));
		}
	});

	it('collapses nonsense to the first bucket rather than failing a vote', () => {
		expect(bucketDistance(-5)).toBe('0-25');
		expect(bucketDistance(Number.NaN)).toBe('0-25');
		expect(bucketDistance(Number.POSITIVE_INFINITY)).toBe('2500+');
	});
});

describe('decade', () => {
	it('floors a year to its decade in the form the API demands', () => {
		expect(decadeOfYear(1923)).toBe('1920s');
		expect(decadeOfYear(1920)).toBe('1920s');
		expect(decadeOfYear(1929)).toBe('1920s');
		expect(decadeOfYear(1930)).toBe('1930s');
	});

	// DECADE_PATTERN is /^\d{3,4}0s$/, and the dataset window opens in 1275 --
	// but a three-digit year is inside the pattern, so it is inside the contract.
	it('handles the three-digit years the pattern allows', () => {
		expect(decadeOfYear(800)).toBe('800s');
		expect(decadeOfYear(1275)).toBe('1270s');
	});

	it('reads the year off an ISO segment start', () => {
		expect(decadeOfIso('1954-06-01')).toBe('1950s');
		expect(decadeOfIso('1900-01-01')).toBe('1900s');
	});

	it('returns null rather than guessing at junk input', () => {
		expect(decadeOfIso(null)).toBeNull();
		expect(decadeOfIso('')).toBeNull();
		expect(decadeOfIso('19')).toBeNull();
		expect(decadeOfYear(Number.NaN)).toBeNull();
	});
});

describe('headroomOf', () => {
	it('reports what fraction of the reach was left over', () => {
		expect(headroomOf({ reachKm: 1000, distanceKm: 0 })).toBe(1);
		expect(headroomOf({ reachKm: 1000, distanceKm: 500 })).toBe(0.5);
		expect(headroomOf({ reachKm: 1000, distanceKm: 1000 })).toBe(0);
	});

	// A relaxed-floor row can sit outside the reach that admitted it, and the API
	// bounds headroom to 0..1 -- so an unclamped negative would be a 400.
	it('clamps a point beyond the reach to zero', () => {
		expect(headroomOf({ reachKm: 1000, distanceKm: 1400 })).toBe(0);
	});

	it('survives a zero or missing reach', () => {
		expect(headroomOf({ reachKm: 0, distanceKm: 10 })).toBe(0);
		expect(headroomOf({ reachKm: Number.NaN, distanceKm: 10 })).toBe(0);
	});
});

describe('buildVote', () => {
	const base = { verdict: 'down' as const, segmentDecade: '1900s', datasetVersion: 'dump-v0.5' };

	it('sends the thirteen fields the API allows and nothing else', () => {
		const vote = buildVote({ entry: entry(), ...base }) as Vote;
		expect(Object.keys(vote).sort()).toEqual(
			[
				'buildId',
				'datasetVersion',
				'distanceBucket',
				'eventId',
				'eventTitle',
				'headroom',
				'reachKm',
				'relaxed',
				'scope',
				'segmentDecade',
				'significance',
				'verdict',
				'voteId'
			].sort()
		);
	});

	/*
	 * The privacy claim in the footer, as an assertion. The API rejects unknown
	 * keys, so an addition would be caught at the edge -- but by then it has
	 * already left the browser, which is the part that matters.
	 */
	it('carries no place, no coordinate and no exact distance', () => {
		const vote = buildVote({ entry: entry(), ...base }) as Vote;
		const wire = JSON.stringify(vote);
		expect(wire).not.toContain('35.5');
		expect(wire).not.toContain('-97.5');
		expect(wire).not.toContain('120');
		expect(vote.distanceBucket).toBe('100-250');
	});

	it('sends the displayed title, not the stored one', () => {
		const vote = buildVote({ entry: entry(), ...base }) as Vote;
		expect(vote.eventTitle).toBe('Oklahoma Statehood');
	});

	it('truncates a title to the length the API accepts', () => {
		const vote = buildVote({
			entry: entry({ displayTitle: 'x'.repeat(900) }),
			...base
		}) as Vote;
		expect(vote.eventTitle).toHaveLength(500);
	});

	// The gap that started this: the engine's scope is nullable, the validators
	// only accepted four values, and an unclassified row would have 400'd and
	// vanished without a trace.
	it('sends unclassified for a row no scope rule has classified', () => {
		const vote = buildVote({ entry: entry({ scope: null }), ...base }) as Vote;
		expect(vote.scope).toBe('unclassified');
	});

	// A person row is badged "Person" on the tile but stores 'local', and the
	// stored value is the one the scoring rules act on.
	it('sends the stored scope for a person row, not the badge', () => {
		const vote = buildVote({ entry: entry({ scope: 'local', category: 'birth' }), ...base }) as Vote;
		expect(vote.scope).toBe('local');
	});

	it('refuses the vote when the segment decade is unknown', () => {
		expect(buildVote({ entry: entry(), ...base, segmentDecade: null })).toBeNull();
	});

	it('stamps unknown rather than null when the dataset is unstamped', () => {
		const vote = buildVote({ entry: entry(), ...base, datasetVersion: null }) as Vote;
		expect(vote.datasetVersion).toBe('unknown');
	});

	it('gives every click its own id', () => {
		const a = buildVote({ entry: entry(), ...base }) as Vote;
		const b = buildVote({ entry: entry(), ...base }) as Vote;
		expect(a.voteId).not.toBe(b.voteId);
	});
});

describe('the one-vote guard', () => {
	it('accepts the first verdict for an event and refuses the second', () => {
		expect(recordVote('e1', 'up')).toBe(true);
		expect(recordVote('e1', 'down')).toBe(false);
		expect(votedVerdict('e1')).toBe('up');
		expect(votedVerdict('e2')).toBeNull();
	});

	it('is not fooled by junk in storage', () => {
		sessionStorage.setItem('circa:votes', 'not json');
		expect(votedVerdict('e1')).toBeNull();
		expect(recordVote('e1', 'up')).toBe(true);
	});

	// Private-mode Safari throws on access. A tile must still render and a click
	// must still send; the duplicate that results is what voteId is for.
	it('still votes when storage is unavailable', () => {
		vi.stubGlobal('sessionStorage', undefined);
		expect(votedVerdict('e1')).toBeNull();
		expect(recordVote('e1', 'up')).toBe(true);
	});
});

describe('sendVote', () => {
	it('posts the vote as JSON to the feedback path', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const vote = buildVote({
			entry: entry(),
			verdict: 'up',
			segmentDecade: '1900s',
			datasetVersion: 'dump-v0.5'
		}) as Vote;

		await sendVote(vote, fetchImpl as unknown as typeof fetch);

		const [url, init] = fetchImpl.mock.calls[0];
		expect(String(url)).toContain('/v1/feedback');
		expect(init.method).toBe('POST');
		expect(init.keepalive).toBe(true);
		expect(JSON.parse(init.body)).toEqual(vote);
	});

	/*
	 * The rule that matters most. A rejected fetch -- offline, CORS, cold
	 * instance, 500 -- must resolve quietly, because the caller does not await
	 * this and an unhandled rejection would surface in the console of a page
	 * whose actual job succeeded.
	 */
	it('resolves when the request fails', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
		const vote = buildVote({
			entry: entry(),
			verdict: 'down',
			segmentDecade: '1900s',
			datasetVersion: 'dump-v0.5'
		}) as Vote;

		await expect(sendVote(vote, fetchImpl as unknown as typeof fetch)).resolves.toBeUndefined();
	});
});

describe('castVote', () => {
	it('sends once and fills the thumb', () => {
		const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
		const args = {
			entry: entry(),
			verdict: 'down' as const,
			segmentDecade: '1900s',
			datasetVersion: 'dump-v0.5',
			fetchImpl: fetchImpl as unknown as typeof fetch
		};

		expect(castVote(args)).toBe(true);
		expect(castVote({ ...args, verdict: 'up' })).toBe(false);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(votedVerdict('e1')).toBe('down');
	});

	it('sends nothing at all when the entry is not votable', () => {
		const fetchImpl = vi.fn();
		expect(
			castVote({
				entry: entry(),
				verdict: 'up',
				segmentDecade: null,
				datasetVersion: 'dump-v0.5',
				fetchImpl: fetchImpl as unknown as typeof fetch
			})
		).toBe(false);
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(votedVerdict('e1')).toBeNull();
	});
});
