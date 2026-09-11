import { describe, expect, it } from 'vitest';
import { capEntries } from '../src/lib/api';
import { GLOBAL_CAP } from '../src/lib/config';
import type { CircaEntry } from '../src/lib/types';

/**
 * A complete CircaEntry with the fields this suite does not care about filled
 * in. Spelled out rather than cast from a partial so that a future engine
 * field arriving in types.ts breaks these tests loudly instead of leaving them
 * asserting against a shape the engine no longer sends.
 */
function entry(overrides: Partial<CircaEntry> & { id: string }): CircaEntry {
	return {
		id: overrides.id,
		title: overrides.id,
		displayTitle: overrides.id,
		blurb: null,
		date: '1900',
		dateStartISO: '1900-01-01',
		dateEndISO: '1900-01-01',
		displayDateISO: '1900-01-01',
		displayPrecision: 'year',
		precision: 'year',
		lat: 0,
		lng: 0,
		distanceKm: 0,
		reachKm: 100,
		scope: 'national',
		tier: 'national',
		phase: null,
		significance: 0.5,
		category: 'event',
		sourceUrl: null,
		segmentIndex: 0,
		score: 0.5,
		relaxed: false,
		...overrides
	};
}

/** `count` ambient rows, each scoring below any universal row in these tests. */
function ambientRows(count: number): CircaEntry[] {
	return Array.from({ length: count }, (_, index) =>
		entry({
			id: `ambient-${index}`,
			tier: 'local',
			scope: 'local',
			score: 0.1 + index / 1000,
			dateStartISO: `19${String(10 + (index % 80)).padStart(2, '0')}-01-01`
		})
	);
}

describe('capEntries', () => {
	it('keeps every universal row even when ambient history is over the cap', () => {
		// Universal rows are given the LOWEST scores in the set on purpose. Before
		// the exemption they survived the cut only because curated rows score high
		// (significance >= 0.85 x headroom 1), which made the old behaviour safe by
		// accident rather than by rule. Scoring them last proves the rule.
		const universal = [
			entry({ id: 'Q43653', tier: 'universal', scope: 'universal', score: 0.01 }),
			entry({ id: 'Q10806', tier: 'universal', scope: 'universal', score: 0.01 }),
			entry({ id: 'Q6534', tier: 'universal', scope: 'universal', score: 0.01 })
		];
		const result = capEntries([...ambientRows(GLOBAL_CAP + 25), ...universal]);

		const ids = result.map((row) => row.id);
		expect(ids).toContain('Q43653');
		expect(ids).toContain('Q10806');
		expect(ids).toContain('Q6534');
		expect(result.filter((row) => row.tier === 'universal')).toHaveLength(3);
	});

	it('still caps ambient history, and the cap counts only ambient rows', () => {
		const universal = Array.from({ length: 5 }, (_, index) =>
			entry({ id: `u-${index}`, tier: 'universal', scope: 'universal', score: 0.9 })
		);
		const result = capEntries([...ambientRows(GLOBAL_CAP + 25), ...universal]);

		// GLOBAL_CAP governs ambient only: universal rows sit on top of it, exactly
		// as the engine's universal pass sits on top of maxPerSegment.
		expect(result.filter((row) => row.tier !== 'universal')).toHaveLength(GLOBAL_CAP);
		expect(result).toHaveLength(GLOBAL_CAP + 5);
	});

	it('leaves a short response untouched apart from ordering', () => {
		const result = capEntries([
			entry({ id: 'b', dateStartISO: '1950-01-01' }),
			entry({ id: 'a', dateStartISO: '1930-01-01' }),
			entry({ id: 'u', tier: 'universal', scope: 'universal', dateStartISO: '1940-01-01' })
		]);

		expect(result.map((row) => row.id)).toEqual(['a', 'u', 'b']);
	});

	it('drops the lowest-scoring ambient rows, not the latest-dated ones', () => {
		// The cut is by score so that it cannot lop the end off a long life. A
		// late, high-scoring row must outlive an early, low-scoring one.
		const filler = ambientRows(GLOBAL_CAP);
		const late = entry({ id: 'late-important', dateStartISO: '1995-01-01', score: 0.99 });
		const early = entry({ id: 'early-trivial', dateStartISO: '1901-01-01', score: 0.001 });
		const result = capEntries([...filler, late, early]);

		const ids = result.map((row) => row.id);
		expect(ids).toContain('late-important');
		expect(ids).not.toContain('early-trivial');
	});

	it('keeps both bookends of a ranged universal row', () => {
		// A ranged row like the Cold War arrives twice, as 'begins' and 'ends'.
		// These are two cards, not a duplicate -- capEntries must not collapse
		// them, and the exemption must carry both.
		const result = capEntries([
			...ambientRows(GLOBAL_CAP + 10),
			entry({
				id: 'Q8683',
				tier: 'universal',
				scope: 'universal',
				phase: 'begins',
				score: 0.02,
				dateStartISO: '1947-01-01'
			}),
			entry({
				id: 'Q8683',
				tier: 'universal',
				scope: 'universal',
				phase: 'ends',
				score: 0.02,
				dateStartISO: '1947-01-01',
				dateEndISO: '1991-12-26'
			})
		]);

		const coldWar = result.filter((row) => row.id === 'Q8683');
		expect(coldWar).toHaveLength(2);
		expect(coldWar.map((row) => row.phase).sort()).toEqual(['begins', 'ends']);
	});
});
