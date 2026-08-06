import { MAX_EVENTS } from './config';
import { daysInMonth } from './dates';
import { newEvent, snapshotLifeEvents } from './session';
import type { LifeEvent, LifeEventKind, PlaceLevel } from './types';

/**
 * The share-link wire format.
 *
 * A timeline is shared by encoding its INPUTS, not its output. /v1/timeline is
 * deterministic, so the recipient's browser re-runs the query and rebuilds the
 * identical page -- no write endpoint, no storage, no accounts, no expiry.
 *
 * Life events are encoded rather than derived segments: the tiles for the
 * sender's own birth, moves and death come from TimelineView's lifeEvents
 * prop, so a segments-only payload would hand the recipient the history with
 * the life removed from it. (The /embed route has exactly that bug today.)
 * deriveSegments then runs on the recipient's side from the same rows, so
 * their query is the sender's query by construction rather than by agreement.
 *
 * The payload belongs in the URL FRAGMENT. It contains a named person's birth
 * date and birthplace, and fragments are never sent to a server, so it stays
 * out of Cloudflare's and Render's request logs. A query string would write a
 * date of birth into two providers' logs on every open.
 *
 * FORMAT
 *   fragment = mode char + body
 *   mode 'A' = body verbatim, 'B' = base64url(deflate-raw(body))
 *   body     = header ~ event ~ event ...
 *   header   = version * dataset
 *   event    = kind * year * month * day * lat * lng * level * name * label
 *
 * '*' and '~' are sub-delims and are legal unescaped in a fragment, as are
 * commas -- which is most of the saving, since every place name carries two.
 * Spaces become '+'. Trailing empty fields are dropped.
 */

/**
 * Bumped only for a breaking payload change; older links then decode to null.
 *
 * Version 1 was percent-encoded JSON and is deliberately not readable here. It
 * lived for one afternoon on an unmerged branch and no link was ever sent, so
 * a reader for it would have been dead code from birth.
 */
export const SHARE_VERSION = 2;

const MODE_PLAIN = 'A';
const MODE_DEFLATE = 'B';
const FIELD = '*';
const RECORD = '~';

/** About 110m. Reach is tens of kilometres, so this cannot move a result. */
const COORD_DECIMALS = 3;

/**
 * Positional, so the index IS the wire value. Append only -- reordering these
 * two arrays silently rewrites the meaning of every link already sent.
 */
const SHARE_KIND_ORDER: LifeEventKind[] = ['birth', 'residence', 'marriage', 'other', 'death'];
const SHARE_LEVEL_ORDER: PlaceLevel[] = ['locality', 'county', 'admin1', 'country'];

/** A link is untrusted input; nothing unbounded comes off the wire. */
const MAX_LABEL_CHARS = 120;
const MAX_PLACE_CHARS = 200;

export interface DecodedShare {
	events: LifeEvent[];
	datasetVersion: string | null;
}

/**
 * Build the fragment payload, WITHOUT a leading '#', or '' if nothing is
 * worth sharing.
 *
 * Filtered through snapshotLifeEvents so the link describes exactly the rows
 * the engine was told about. `id` and `placeQuery` are dropped: both are UI
 * bookkeeping, ids are regenerated on load, and a half-typed place box is not
 * something to send to somebody else.
 */
export async function encodeShare(
	rows: LifeEvent[],
	datasetVersion: string | null = null
): Promise<string> {
	const usable = snapshotLifeEvents(rows).slice(0, MAX_EVENTS);
	if (usable.length === 0) return '';

	const records = [`${SHARE_VERSION}${FIELD}${escapeText(datasetVersion ?? '')}`];

	for (const row of usable) {
		const place = row.place!;
		const fields = [
			String(Math.max(0, SHARE_KIND_ORDER.indexOf(row.kind))),
			String(row.date.year),
			row.date.month === null ? '' : String(row.date.month),
			row.date.day === null ? '' : String(row.date.day),
			String(roundCoord(place.lat)),
			String(roundCoord(place.lng)),
			String(Math.max(0, SHARE_LEVEL_ORDER.indexOf(place.level))),
			escapeText(place.name.slice(0, MAX_PLACE_CHARS)),
			escapeText(row.label.slice(0, MAX_LABEL_CHARS))
		];
		while (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
		records.push(fields.join(FIELD));
	}

	const body = records.join(RECORD);
	const plain = MODE_PLAIN + body;

	// Compression loses on short payloads: deflate emits a header and base64
	// adds a third back on top, so two events come out longer compressed than
	// plain. Build both and keep the shorter rather than guessing a threshold.
	const packed = await deflateToBase64Url(body);
	if (packed === null) return plain;
	const compressed = MODE_DEFLATE + packed;
	return compressed.length < plain.length ? compressed : plain;
}

/**
 * Read a fragment back into rows the form can hold.
 *
 * Returns null for anything it cannot vouch for, and never throws. This is the
 * only input in the app that has been through a chat window, a mail client and
 * possibly somebody's text editor, so every field is checked rather than
 * asserted. The caller's fallback is the empty form the visitor would have got
 * anyway, which makes null a perfectly good answer.
 *
 * Partial rows are dropped individually; one bad row does not sink the link.
 */
export async function decodeShare(fragment: string): Promise<DecodedShare | null> {
	const raw = fragment.startsWith('#') ? fragment.slice(1) : fragment;
	if (raw.length < 2) return null;

	let body: string | null;
	if (raw[0] === MODE_PLAIN) body = raw.slice(1);
	else if (raw[0] === MODE_DEFLATE) body = await inflateFromBase64Url(raw.slice(1));
	else return null;
	if (body === null) return null;

	const records = body.split(RECORD);
	if (records.length < 2) return null;

	// An unrecognised version is a link from a future build. Refusing shows an
	// empty form; guessing would show a wrong timeline confidently.
	const header = records[0].split(FIELD);
	if (header[0] !== String(SHARE_VERSION)) return null;

	// MAX_EVENTS is the form's own ceiling. A hand-edited link claiming five
	// hundred rows is rejected outright rather than truncated, since a truncated
	// timeline is a wrong timeline shown without comment.
	if (records.length - 1 > MAX_EVENTS) return null;

	let datasetVersion: string | null;
	try {
		datasetVersion = header[1] ? unescapeText(header[1]) : null;
	} catch {
		return null;
	}

	const rows: LifeEvent[] = [];
	for (let i = 1; i < records.length; i += 1) {
		const row = readEvent(records[i].split(FIELD));
		if (row !== null) rows.push(row);
	}
	// Filling the form with nothing and running a query against it is worse
	// than not trying at all.
	if (rows.length === 0) return null;

	return { events: rows, datasetVersion };
}

function readEvent(fields: string[]): LifeEvent | null {
	// Same bounds assertValid enforces, so a nonsense year is kept out of the
	// form rather than failing later as an error the visitor cannot explain.
	const year = readInt(fields[1] ?? '', 1, 2200);
	if (year === null) return null;

	const lat = readCoord(fields[4] ?? '', 90);
	const lng = readCoord(fields[5] ?? '', 180);
	if (lat === null || lng === null) return null;

	let name: string;
	let label: string;
	try {
		name = unescapeText(fields[7] ?? '')
			.trim()
			.slice(0, MAX_PLACE_CHARS);
		label = unescapeText(fields[8] ?? '').slice(0, MAX_LABEL_CHARS);
	} catch {
		return null;
	}
	if (name === '') return null;

	const month = readInt(fields[2] ?? '', 1, 12);
	// A day without a month is invalid, so it goes with the month.
	const day = month === null ? null : readInt(fields[3] ?? '', 1, daysInMonth(year, month));

	// An unknown kind still describes a place and a time, which is most of what
	// a row is for. 'other' keeps it on the timeline instead of discarding it.
	const kindIndex = readInt(fields[0] ?? '', 0, SHARE_KIND_ORDER.length - 1);
	const levelIndex = readInt(fields[6] ?? '', 0, SHARE_LEVEL_ORDER.length - 1);

	const row = newEvent(kindIndex === null ? 'other' : SHARE_KIND_ORDER[kindIndex]);
	row.label = label;
	row.date = { year, month, day };
	row.place = {
		name,
		lat,
		lng,
		level: levelIndex === null ? 'locality' : SHARE_LEVEL_ORDER[levelIndex],
		// From the coordinates, NOT the name. mergeAdjacent compares placeKey to
		// decide whether two consecutive rows collapse into one segment, and two
		// places can share a name -- Portsmouth VA and Portsmouth NH are both in
		// our dataset, 800km apart. Rounded identically on both sides, so the
		// same place still merges exactly where the geocoder's own key would.
		placeKey: `${lat},${lng}`
	};
	// The box shows the resolved name, so the recipient sees a filled-in form
	// rather than a blank field sitting above a located row.
	row.placeQuery = name;
	return row;
}

/* -------------------------------------------------------------------------- */
/* ENCODING HELPERS                                                           */
/* -------------------------------------------------------------------------- */

function roundCoord(value: number): number {
	return Number(value.toFixed(COORD_DECIMALS));
}

/**
 * Percent-encode, then hand back the characters a fragment allows raw.
 *
 * encodeURIComponent is the only correct starting point -- it handles every
 * non-ASCII place name -- but it escapes commas, which are the single most
 * common character in a place name after letters and spaces.
 */
function escapeText(text: string): string {
	return encodeURIComponent(text)
		.replace(/\*/g, '%2A')
		.replace(/~/g, '%7E')
		.replace(/%20/g, '+')
		.replace(/%2C/g, ',');
}

/** Throws on a malformed percent-escape; every caller catches. */
function unescapeText(text: string): string {
	return decodeURIComponent(text.replace(/\+/g, '%20'));
}

function readInt(text: string, min: number, max: number): number | null {
	// Guarded because Number('') is 0, which would read as a valid field.
	if (text === '') return null;
	const value = Number(text);
	if (!Number.isInteger(value)) return null;
	return value >= min && value <= max ? value : null;
}

function readCoord(text: string, limit: number): number | null {
	if (text === '') return null;
	const value = Number(text);
	if (!Number.isFinite(value)) return null;
	return value >= -limit && value <= limit ? value : null;
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array | null {
	if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
	const padded = text.replace(/-/g, '+').replace(/_/g, '/');
	try {
		const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
		return bytes;
	} catch {
		return null;
	}
}

/**
 * Compression Streams, not a library. Baseline across every browser since May
 * 2023, so lz-string or pako would be a dependency and a bundle cost for an
 * algorithm the platform already ships -- and deflate beats lz-string anyway.
 *
 * Null on any failure, including the API being absent, which is the whole
 * fallback: encodeShare then emits the plain form and the link still works.
 */
async function deflateToBase64Url(text: string): Promise<string | null> {
	if (typeof CompressionStream === 'undefined') return null;
	try {
		const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
		return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
	} catch {
		return null;
	}
}

async function inflateFromBase64Url(text: string): Promise<string | null> {
	if (typeof DecompressionStream === 'undefined') return null;
	const bytes = fromBase64Url(text);
	if (bytes === null) return null;
	try {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
		return await new Response(stream).text();
	} catch {
		return null;
	}
}
