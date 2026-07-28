import type { PartialDate, Precision } from './types';
import { ValidationError } from './types';

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

export function emptyDate(): PartialDate {
	return { year: null, month: null, day: null };
}

export function hasYear(date: PartialDate): boolean {
	return typeof date.year === 'number' && Number.isFinite(date.year);
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** How precise the user actually was. Feeds the disclosure in the UI. */
export function precisionOf(date: PartialDate): Precision {
	if (date.day) return 'day';
	if (date.month) return 'month';
	return 'year';
}

export function assertValid(date: PartialDate, context: string): void {
	if (!hasYear(date)) {
		throw new ValidationError('BAD_DATE', `${context}: a year is required.`);
	}
	const year = date.year as number;
	if (!Number.isInteger(year) || year < 1 || year > 2200) {
		throw new ValidationError('BAD_DATE', `${context}: ${year} is not a usable year.`);
	}
	if (date.month !== null) {
		if (!Number.isInteger(date.month) || date.month < 1 || date.month > 12) {
			throw new ValidationError('BAD_DATE', `${context}: month must be 1-12.`);
		}
	}
	if (date.day !== null) {
		if (date.month === null) {
			throw new ValidationError('BAD_DATE', `${context}: a day needs a month too.`);
		}
		const max = daysInMonth(year, date.month);
		if (!Number.isInteger(date.day) || date.day < 1 || date.day > max) {
			throw new ValidationError('BAD_DATE', `${context}: day must be 1-${max} for that month.`);
		}
	}
}

/** Earliest instant the partial date could refer to. */
export function isoStart(date: PartialDate): string {
	const year = date.year as number;
	return `${pad(year, 4)}-${pad(date.month ?? 1)}-${pad(date.day ?? 1)}`;
}

/** Latest instant the partial date could refer to. */
export function isoEnd(date: PartialDate): string {
	const year = date.year as number;
	if (date.month === null) return `${pad(year, 4)}-12-31`;
	if (date.day === null) return `${pad(year, 4)}-${pad(date.month)}-${pad(daysInMonth(year, date.month))}`;
	return `${pad(year, 4)}-${pad(date.month)}-${pad(date.day)}`;
}

export function addYears(iso: string, years: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const year = y + years;
	const day = Math.min(d, daysInMonth(year, m));
	return `${pad(year, 4)}-${pad(m)}-${pad(day)}`;
}

export function yearOf(iso: string): number {
	return Number(iso.slice(0, 4));
}

const MONTH_NAMES = [
	'January', 'February', 'March', 'April', 'May', 'June',
	'July', 'August', 'September', 'October', 'November', 'December'
];

/** Human rendering that respects how much the user actually told us. */
export function formatPartial(date: PartialDate): string {
	if (!hasYear(date)) return '';
	if (date.month === null) return String(date.year);
	const month = MONTH_NAMES[date.month - 1];
	if (date.day === null) return `${month} ${date.year}`;
	return `${month} ${date.day}, ${date.year}`;
}
