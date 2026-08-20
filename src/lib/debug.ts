/**
 * Diagnostic display, switched on by the query string.
 *
 * Circa shows a visitor what was happening around a life. The numbers behind
 * that choice -- how far an event's significance let it reach -- are ours
 * rather than theirs, so they are off by default and readable on demand. The
 * one reader today is the distance chip in EntryCard.svelte.
 */

/**
 * Read a boolean flag from the current URL's query string.
 *
 * A bare `?debug` parses as the empty string, which is the most natural way to
 * type this by hand, so anything present counts as on -- except an explicit
 * `0` or `false`, which lets a link carry the flag switched off.
 */
function readFlag(name: string): boolean {
	// Evaluated during prerendering as well, where there is no location to read:
	// adapter-static builds the page shell at build time, in Node.
	if (typeof location === 'undefined') return false;

	const value = new URLSearchParams(location.search).get(name);
	if (value === null) return false;

	return value !== '0' && value.toLowerCase() !== 'false';
}

/**
 * Whether to print the scoring internals behind each row.
 *
 * A query parameter rather than a build-time variable. The reason to look at
 * reach is that a deployed timeline picked something surprising, and an
 * environment variable would mean a rebuild and a redeploy before the surprise
 * could be examined. `?debug=1` works on production, on a preview and on a dev
 * server alike, and is off for everyone who has not typed it.
 *
 * A parameter rather than storage, too. session.ts holds the entire app in
 * memory with no cookies and no localStorage, and a sticky debug toggle would
 * be the first thing to break that promise -- to save typing eight characters.
 *
 * Read once at module load rather than held in a store: nothing in the app
 * rewrites the query string afterwards. Note that the share payload lives in
 * the URL fragment specifically to stay out of request logs (see share.ts);
 * this flag describes the page rather than the person, so it is safe in the
 * part of the URL that is logged.
 */
export const DEBUG = readFlag('debug');
