/**
 * Finds every inline <script> in the built HTML and returns its CSP hash.
 *
 * WHY THIS EXISTS
 *
 * The policy shipped as `script-src 'self'` with a comment asserting there was
 * no inline script anywhere, "verified" against src/app.html. That verification
 * examined the wrong artifact. SvelteKit's client bootstrap is not in the
 * template -- adapter-static injects it into the generated HTML at build time,
 * where it sets __sveltekit_* and dynamically imports the app chunks. So the
 * policy blocked the one script that starts the application, hydration never
 * ran, and production served a blank page:
 *
 *   Executing inline script violates the following Content Security Policy
 *   directive 'script-src 'self''.
 *
 * The lesson encoded here: a CSP applies to build output, so it must be derived
 * from build output. Hashes are scanned rather than declared for two reasons.
 * The bootstrap's text embeds the hashed chunk filenames, so its hash changes
 * on any build that changes a chunk -- a pinned literal would be correct
 * exactly once, then wrong silently. And scanning describes what the build
 * actually contains rather than what somebody believes it contains, which is
 * precisely the mistake above.
 *
 * Shared by scripts/gen-headers.mjs, which emits the hashes, and
 * scripts/check-inline-hashes.mjs, which fails CI if one was missed, so the two
 * cannot drift on what counts as an inline script.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

/**
 * JSON data blocks are parsed, never executed, so they need no hash. Anything
 * else inline does -- including type="importmap", which IS governed by
 * script-src and is deliberately not excluded here.
 */
const DATA_BLOCK_TYPE = /\btype\s*=\s*["']?application\/(ld\+)?json["']?/i;

/** Recursively collect .html files under dir. */
export function findHtmlFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...findHtmlFiles(full));
		else if (entry.endsWith('.html')) out.push(full);
	}
	return out;
}

/**
 * Hash the EXACT bytes between the tags -- no trimming, no normalisation.
 * A browser hashes what it parsed, so any tidying here yields a hash that looks
 * plausible in the header and never matches in the browser.
 */
export function hashScriptBody(body) {
	return `sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}`;
}

/**
 * Every inline script in the build, as { file, hash } pairs. Duplicates are
 * kept -- the same bootstrap appears in every prerendered page -- so a failure
 * report can name each file. Callers deduplicate for the policy itself.
 */
export function collectInlineScripts(outDir) {
	const found = [];
	for (const file of findHtmlFiles(outDir)) {
		const html = readFileSync(file, 'utf8');
		for (const match of html.matchAll(SCRIPT_TAG)) {
			const attrs = match[1] ?? '';
			const body = match[2] ?? '';
			if (/\bsrc\s*=/i.test(attrs)) continue; // external: covered by 'self'
			if (DATA_BLOCK_TYPE.test(attrs)) continue; // data, not code
			if (!body.trim()) continue; // an empty tag executes nothing
			found.push({ file, hash: hashScriptBody(body) });
		}
	}
	return found;
}

/** Sorted unique hashes, so the generated policy is byte-stable across builds. */
export function uniqueHashes(found) {
	return [...new Set(found.map((f) => f.hash))].sort();
}
