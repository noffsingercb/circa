import { writable } from 'svelte/store';

/**
 * Which unit distances are shown in.
 *
 * A display preference only. The engine reports kilometres, `reach_km` is a
 * stored column, and every comparison in the scoring is done in km -- none of
 * that changes. Conversion happens at the last possible moment, in the
 * component that prints the number.
 */
export type DistanceUnit = 'km' | 'mi';

/** International mile. Exact by definition, not an approximation. */
const KM_PER_MILE = 1.609344;

/**
 * Kilometres by default: it is what the data is in, and what the majority of
 * the world reads. Held in memory like the rest of the session, so a reload
 * starts over.
 */
export const distanceUnit = writable<DistanceUnit>('km');

export function toMiles(km: number): number {
	return km / KM_PER_MILE;
}

/**
 * Format a distance for display, including its unit.
 *
 * Miles carry one decimal place. Kilometres are whole numbers -- a tenth of a
 * kilometre is far below the accuracy of a place centroid, and printing one
 * would claim precision the dataset does not have. The mismatch is
 * deliberate rather than an oversight.
 *
 * Thousands separators on both: global reach in miles reaches five digits,
 * and "12451.5 mi" is hard to read in a chip.
 */
export function formatDistance(km: number, unit: DistanceUnit): string {
	if (unit === 'mi') {
		const miles = toMiles(km);
		return `${miles.toLocaleString('en-US', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		})} mi`;
	}

	return `${Math.round(km).toLocaleString('en-US')} km`;
}
