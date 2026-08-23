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

/** Earliest usable year. Mirrors the engine's MIN_YEAR_ACCEPTED. */
const MIN_YEAR = 1;

/**
 * Validate a partial date, and refuse anything in the future.
 *
 * THE UPPER BOUND IS DERIVED FROM THE CLOCK, NOT WRITTEN DOWN.
 *
 * It used to be the literal 2200, and that literal cost a production
 * diagnosis. The engine's validateInput accepts MIN_YEAR_ACCEPTED..currentYear
 * + 1, so every year from 2028 to 2200 was a year this form invited and the
 * API was always going to refuse. Worse, the matching max="2200" on the year
 * input made the browser tell visitors to "enter a year earlier than 2200" --
 * a bound that had never once been true. Two validators disagreeing about what
 * a year is, with the stricter one downstream, is the same shape as the
 * living-person 400 that reached a real visitor on 2026-08-23.
 *
 * Deriving the bound from today closes the disagreement permanently and lands
 * strictly inside the engine's range, so this app can no longer be the source
 * of an out-of-range year. It is deliberately NOT a config knob: "not in the
 * future" is a fact about calendars rather than a tuning decision, and a
 * settable value would just be a second copy of the original mistake.
 *
 * The comparison is on the FULL date, not the year alone. In August 2026 a
 * visitor may enter 2026, and may enter August 2026, but not December 2026.
 * Month and day are already validated by the time it runs, so isoStart() is
 * safe to build. Year-only precision resolves to January 1, which is why the
 * current year is always enterable.
 *
 * This applies to EVERY event kind, not only births. A marriage or a move
 * dated next year is exactly as impossible, and left to reach the engine it
 * would come back as a complaint about a segment index instead of a date.
 */
export function assertValid(date: PartialDate, context: string): void {
	if (!hasYear(date)) {
		throw new ValidationError('BAD_DATE', `${context}: a year is required.`);
	}
	const year = date.year as number;
	if (!Number.isInteger(year) || year < MIN_YEAR) {
		throw new ValidationError('BAD_DATE', `${context}: ${year} is not a usable year.`);
	}
	// Before the month and day checks, so a wildly wrong year is reported as a
	// year rather than as a day-of-month complaint about some month in 3000.
	if (year > yearOf(todayISO())) {
		throw new ValidationError(
			'BAD_DATE',
			`${context}: ${year} is in the future. Enter a current or past date only.`
		);
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
	if (isoStart(date) > todayISO()) {
		throw new ValidationError(
			'BAD_DATE',
			`${context}: ${formatPartial(date)} is in the future. Enter a current or past date only.`
		);
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

/**
 * Today, as a date-only ISO string in UTC.
 *
 * UTC rather than local time deliberately. Every other string this module
 * produces is a bare calendar date with no zone, and both the engine and this
 * app compare them as text. Deriving one of them from the visitor's local
 * clock would make the same form produce two different requests either side of
 * midnight depending on where the visitor is sitting, and the difference would
 * only ever show up as a one-day edge in what history is in range.
 */
export function todayISO(): string {
	const now = new Date();
	return `${pad(now.getUTCFullYear(), 4)}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
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
