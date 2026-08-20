/**
 * Diagnostic display, armed by hand and switched live.
 *
 * Circa shows a visitor what was happening around a life. The numbers behind
 * that choice -- how far an event's significance let it reach -- are ours
 * rather than theirs, so they are off by default and readable on demand. The
 * one reader today is the distance chip in EntryCard.svelte.
 */

import { writable } from 'svelte/store';

/**
 * Read a boolean flag from the current URL's query string.
 *
 * A bare `?debug` parses as the empty string, which is the most natural way to
 * type this by hand, so anything present counts as on -- except an explicit
 * `0` or `false`, which lets a link carry the flag switched off.
 *
 * Note that the share payload lives in the URL fragment specifically to stay
 * out of request logs (see share.ts). This flag describes the page rather than
 * the person, so it is safe in the half of the URL that is logged.
 */
function readFlag(name: string): boolean {
	// Evaluated during prerendering as well, where there is no location to read:
	// adapter-static builds the page shell at build time, in Node.
	if (typeof location === 'undefined') return false;

	const value = new URLSearchParams(location.search).get(name);
	if (value === null) return false;

	return value !== '0' && value.toLowerCase() !== 'false';
}

const initial = readFlag('debug');

/**
 * Whether the scoring internals behind each row are on screen right now.
 *
 * A store rather than a constant, because reload was the cost of the constant.
 * The reason to look at reach is that a timeline already on screen picked
 * something surprising, and session.ts keeps the entire session in memory --
 * so appending `?debug=1` to examine a row threw away the row, along with the
 * form that produced it.
 *
 * Not persisted, for the same reason it is not a cookie: a sticky debug flag
 * would be the first thing to break the promise session.ts makes. It lasts as
 * long as the tab, which is as long as the timeline does.
 */
export const showReach = writable(initial);

/**
 * Whether the on-page toggle is present at all.
 *
 * Separate from `showReach` so the control can be switched off without
 * vanishing: once it has been asked for it stays available for the rest of the
 * session and states its own position, like the km/mi pair it sits beside.
 * Comparing what a visitor sees against what the scoring saw is then one click
 * rather than another keystroke.
 *
 * A visitor never arms it, which is the point. Reach beside the distance is
 * not a secret -- it is a second unexplained number in front of somebody who
 * only asked what happened near a place -- so the cost of keeping it back is
 * nil and the cost of showing it is a confused reader.
 */
export const reachArmed = writable(initial);

/** Stated in the toggle's tooltip, so the combination is discoverable once. */
export const REACH_KEY_HINT = 'Ctrl+Alt+R';

/** Whether the keystroke landed in something the visitor is typing into. */
function isTyping(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;

	return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * Watch for the arming combination. Returns its own teardown, for onMount.
 *
 * event.code rather than event.key: Ctrl+Alt is AltGr on several keyboard
 * layouts, where `key` reports whichever character AltGr+R produces rather
 * than 'r'. `code` names the physical key, so the combination is the same one
 * on every layout.
 *
 * The form on this page is mostly text inputs, so a keystroke aimed at a field
 * is ignored outright rather than read as a command.
 */
export function listenForReachKey(): () => void {
	function onKeyDown(event: KeyboardEvent): void {
		if (!event.ctrlKey || !event.altKey || event.metaKey) return;
		if (event.code !== 'KeyR' || event.repeat) return;
		if (isTyping(event.target)) return;

		event.preventDefault();
		reachArmed.set(true);
		showReach.update((on) => !on);
	}

	window.addEventListener('keydown', onKeyDown);
	return () => window.removeEventListener('keydown', onKeyDown);
}
