import type { CircaEntry, DrawTier } from './types';

/*
 * FILTERING IS DISPLAY-SIDE ONLY
 *
 * Everything here operates on entries the engine has already returned. No
 * filter state is ever sent with a timeline request, for two reasons:
 *
 *   - categoryWeights is on Circa's deliberately-not-sent list (config.ts),
 *     and the API rejects unknown config keys with a 400.
 *   - the engine's scope knobs (scopeQuota, scopeFloor) ARE accepted, but
 *     sending them would pin this client to values it chose today and give up
 *     inheriting engine defaults. That property is why universalQuota moving
 *     from 2 to 40 reached production without a Circa release at all.
 *
 * The cost of staying client-side is real and worth stating plainly: a masked
 * row is simply gone, and the timeline gets shorter. It cannot be backfilled
 * with the next-ranked event, because Circa only ever receives the post-quota
 * selection -- the runner-up rows never left the server. Filtering here can
 * subtract, never substitute.
 */

export type ChipKind = 'scope' | 'category';

export type Chip = {
	readonly id: string;
	readonly kind: ChipKind;
	readonly label: string;
	/** Tiers this chip claims. Scope chips only. */
	readonly tiers?: readonly DrawTier[];
	/** Dataset categories this chip claims. Category chips only. */
	readonly categories?: readonly string[];
};

/**
 * Scope chips, keyed on entry.tier -- the tier the row was actually DRAWN
 * from, which the engine has reported since 0.6. Not entry.scope: a birth is
 * drawn on the person tier but carries a stored scope of 'local', so scoping
 * off 'Local' would take celebrity births with it.
 *
 * Labels match EntryCard's SCOPE_LABEL exactly, including 'universal' reading
 * as "World". A chip that says one thing and a card chip that says another
 * about the same row is the kind of mismatch nobody reports and everybody
 * notices.
 *
 * THE PERSON TIER IS DELIBERATELY ABSENT. It would collide with the People
 * category chip below -- two adjacent controls, same label, nearly but not
 * exactly the same set of rows (a birth can be drawn on a non-person tier).
 * Person rows are therefore filtered by category, and this group answers only
 * "how far did this reach". A consequence worth knowing: a person-tier row is
 * claimed by no scope chip, so scope filtering never hides it. See isVisible.
 */
export const SCOPE_CHIPS: readonly Chip[] = [
	{ id: 'scope:local', kind: 'scope', label: 'Local', tiers: ['local'] },
	{ id: 'scope:regional', kind: 'scope', label: 'Regional', tiers: ['regional'] },
	{ id: 'scope:national', kind: 'scope', label: 'National', tiers: ['national'] },
	{ id: 'scope:global', kind: 'scope', label: 'Global', tiers: ['global'] },
	{ id: 'scope:universal', kind: 'scope', label: 'World', tiers: ['universal'] }
];

/**
 * Category chips: seven user-facing labels over the ten categories present in
 * dump-v0.6 (founding 47,116 / birth 32,788 / death 15,514 / conflict 7,830 /
 * event 5,702 / disaster 4,358 / treaty 1,322 / discovery 705 / election 550 /
 * milestone 410).
 *
 * Ten chips would be too many for the header, and three of the categories are
 * rare enough that toggling them usually changes nothing on screen -- which
 * reads as a broken control rather than as an empty set.
 *
 * People (birth + death) is the one that motivated the ticket: the celebrity
 * birth and death rows that drew the complaints.
 */
export const CATEGORY_CHIPS: readonly Chip[] = [
	{ id: 'cat:people', kind: 'category', label: 'People', categories: ['birth', 'death'] },
	{ id: 'cat:founded', kind: 'category', label: 'Founded', categories: ['founding'] },
	{ id: 'cat:conflict', kind: 'category', label: 'Conflict', categories: ['conflict'] },
	{ id: 'cat:disasters', kind: 'category', label: 'Disasters', categories: ['disaster'] },
	{ id: 'cat:politics', kind: 'category', label: 'Politics', categories: ['treaty', 'election'] },
	{ id: 'cat:discoveries', kind: 'category', label: 'Discoveries', categories: ['discovery'] },
	{ id: 'cat:notable', kind: 'category', label: 'Notable', categories: ['event', 'milestone'] }
];

/* Built once. Both lookups are per-entry, per-render. */
const CHIP_BY_TIER = new Map<string, Chip>();
for (const chip of SCOPE_CHIPS) {
	for (const tier of chip.tiers ?? []) CHIP_BY_TIER.set(tier, chip);
}

const CHIP_BY_CATEGORY = new Map<string, Chip>();
for (const chip of CATEGORY_CHIPS) {
	for (const category of chip.categories ?? []) CHIP_BY_CATEGORY.set(category, chip);
}

/**
 * The scope chip claiming this entry, or null if none does.
 *
 * Null for person-tier rows (see SCOPE_CHIPS) and for any future tier this
 * module has not been taught about.
 */
export function scopeChipFor(entry: CircaEntry): Chip | null {
	return CHIP_BY_TIER.get(entry.tier ?? '') ?? null;
}

/**
 * The category chip claiming this entry, or null if none does.
 *
 * Null for entries with no category and for categories added to the dataset
 * after this list was written. An `epidemic` category has been discussed but
 * does not exist today; if it lands, it arrives here as null.
 */
export function categoryChipFor(entry: CircaEntry): Chip | null {
	return CHIP_BY_CATEGORY.get(entry.category ?? '') ?? null;
}

/**
 * Whether an entry survives the current filter state.
 *
 * `hidden` holds the ids of chips switched OFF, so the default empty set means
 * everything shows -- the state this ticket specifies. Storing the negative
 * also means a category added to the dataset tomorrow defaults to visible
 * rather than defaulting to hidden because no chip vouched for it.
 *
 * An entry claimed by no chip in a group always passes that group. This is the
 * safe direction: an unmapped row is unfilterable but never silently dropped.
 * The alternative -- treating unclaimed rows as hidden whenever anything in the
 * group is off -- would make a new category vanish from timelines with no
 * control anywhere on the page to bring it back.
 */
export function isVisible(entry: CircaEntry, hidden: ReadonlySet<string>): boolean {
	if (hidden.size === 0) return true;

	const scope = scopeChipFor(entry);
	if (scope && hidden.has(scope.id)) return false;

	const category = categoryChipFor(entry);
	if (category && hidden.has(category.id)) return false;

	return true;
}

/** The entries still on screen, in their original order. */
export function applyFilters(
	entries: readonly CircaEntry[],
	hidden: ReadonlySet<string>
): CircaEntry[] {
	if (hidden.size === 0) return [...entries];
	return entries.filter((entry) => isVisible(entry, hidden));
}

export type ChipCount = {
	readonly chip: Chip;
	readonly count: number;
};

export type AvailableChips = {
	readonly scope: readonly ChipCount[];
	readonly category: readonly ChipCount[];
};

/**
 * The chips worth showing for a given timeline, with how many rows each one
 * claims, in taxonomy order.
 *
 * DERIVED FROM THE RESPONSE, NOT HARDCODED, and that is the load-bearing
 * decision in this module. A chip appears only if at least one returned row
 * belongs to it, which makes the dead-end unreachable: on the 11 Sep live run
 * the local tier drew zero rows, so a hardcoded "Local" chip would have
 * emptied the timeline and looked broken. Derived, it simply is not offered.
 *
 * Pass the UNFILTERED entries. Deriving from the filtered list would make a
 * chip disappear the moment it was switched off, leaving no way to switch it
 * back on.
 */
export function availableChips(entries: readonly CircaEntry[]): AvailableChips {
	const counts = new Map<string, number>();

	for (const entry of entries) {
		for (const chip of [scopeChipFor(entry), categoryChipFor(entry)]) {
			if (chip) counts.set(chip.id, (counts.get(chip.id) ?? 0) + 1);
		}
	}

	const present = (list: readonly Chip[]): ChipCount[] =>
		list
			.filter((chip) => (counts.get(chip.id) ?? 0) > 0)
			.map((chip) => ({ chip, count: counts.get(chip.id) ?? 0 }));

	return { scope: present(SCOPE_CHIPS), category: present(CATEGORY_CHIPS) };
}
