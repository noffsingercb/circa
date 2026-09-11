import { describe, expect, it } from 'vitest';
import { applyFilters, availableChips, isVisible } from '../src/lib/filters';
import type { CircaEntry } from '../src/lib/types';

/*
 * The base object is annotated as a full CircaEntry and spread UNDER the
 * overrides, so a field added to the engine contract breaks this file loudly
 * rather than letting fixtures drift out of the shape they claim to have.
 *
 * Note the shape: base first, overrides second, and no key written literally
 * before a spread that also carries it -- svelte-check reports that as an
 * error, which is how it caught the first version of this helper.
 */
function entry(overrides: Partial<CircaEntry> & { id: string }): CircaEntry {
	const base: CircaEntry = {
		id: overrides.id,
		title: overrides.id,
		displayTitle: overrides.id,
		blurb: null,
		date: '1950',
		dateStartISO: '1950-01-01',
		dateEndISO: null,
		displayDateISO: '1950-01-01',
		displayPrecision: 'year',
		precision: 'year',
		lat: 0,
		lng: 0,
		distanceKm: 10,
		reachKm: 100,
		scope: 'local',
		tier: 'local',
		phase: null,
		significance: 0.5,
		category: 'event',
		sourceUrl: null,
		segmentIndex: 0,
		score: 0.5,
		relaxed: false
	};

	return { ...base, ...overrides };
}

const none: ReadonlySet<string> = new Set<string>();

describe('availableChips', () => {
	it('offers only chips some returned row belongs to', () => {
		const chips = availableChips([
			entry({ id: 'a', tier: 'national', category: 'conflict' }),
			entry({ id: 'b', tier: 'universal', category: 'disaster' })
		]);

		expect(chips.scope.map((item) => item.chip.label)).toEqual(['National', 'World']);
		expect(chips.category.map((item) => item.chip.label)).toEqual(['Conflict', 'Disasters']);
	});

	/*
	 * The reason chips are derived rather than hardcoded. On the 11 Sep live run
	 * the local tier drew nothing, and a Local chip on that timeline could only
	 * empty it.
	 */
	it('offers no chip for a tier the engine did not draw', () => {
		const chips = availableChips([entry({ id: 'a', tier: 'global', category: 'event' })]);
		expect(chips.scope.map((item) => item.chip.label)).not.toContain('Local');
	});

	it('counts rows per chip, grouping the categories that share a label', () => {
		const chips = availableChips([
			entry({ id: 'a', category: 'birth' }),
			entry({ id: 'b', category: 'death' }),
			entry({ id: 'c', category: 'treaty' })
		]);

		const people = chips.category.find((item) => item.chip.label === 'People');
		expect(people?.count).toBe(2);
		expect(chips.category.find((item) => item.chip.label === 'Politics')?.count).toBe(1);
	});
});

describe('applyFilters', () => {
	it('keeps everything when nothing is switched off', () => {
		const entries = [entry({ id: 'a' }), entry({ id: 'b', tier: 'global' })];
		expect(applyFilters(entries, none).map((row) => row.id)).toEqual(['a', 'b']);
	});

	it('drops only the masked scope and preserves order', () => {
		const entries = [
			entry({ id: 'a', tier: 'local' }),
			entry({ id: 'b', tier: 'global' }),
			entry({ id: 'c', tier: 'local' })
		];

		const kept = applyFilters(entries, new Set(['scope:global']));
		expect(kept.map((row) => row.id)).toEqual(['a', 'c']);
	});

	it('masks births and deaths together under People', () => {
		const entries = [
			entry({ id: 'born', category: 'birth' }),
			entry({ id: 'died', category: 'death' }),
			entry({ id: 'flood', category: 'disaster' })
		];

		expect(applyFilters(entries, new Set(['cat:people'])).map((row) => row.id)).toEqual(['flood']);
	});

	/*
	 * Person-tier rows are claimed by no scope chip -- the person tier is
	 * deliberately absent from that group to avoid two adjacent "People"
	 * controls. So scope filtering must leave them alone, and the category chip
	 * is what reaches them.
	 */
	it('leaves person-tier rows to the category group', () => {
		const person = entry({ id: 'packard', tier: 'person', category: 'birth' });

		expect(isVisible(person, new Set(['scope:local', 'scope:global']))).toBe(true);
		expect(isVisible(person, new Set(['cat:people']))).toBe(false);
	});

	/*
	 * A category this module has not been taught about -- `epidemic` has been
	 * discussed but does not exist in dump-v0.6 -- must stay visible rather than
	 * vanish with no control on the page to bring it back.
	 */
	it('never hides a row no chip claims', () => {
		const future = entry({ id: 'outbreak', category: 'epidemic' });
		expect(isVisible(future, new Set(['cat:people', 'cat:notable']))).toBe(true);
	});

	it('returns empty rather than throwing when every chip is off', () => {
		const entries = [entry({ id: 'a', tier: 'local', category: 'event' })];
		expect(applyFilters(entries, new Set(['scope:local', 'cat:notable']))).toEqual([]);
	});

	it('does not mutate the list it was given', () => {
		const entries = [entry({ id: 'a', tier: 'local' }), entry({ id: 'b', tier: 'global' })];
		applyFilters(entries, new Set(['scope:global']));
		expect(entries).toHaveLength(2);
	});
});
