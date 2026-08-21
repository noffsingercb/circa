#!/usr/bin/env node
/**
 * Fails if any inline script in build/ is missing from a generated policy.
 *
 * WHY THIS IS A SEPARATE CHECK
 *
 * Every existing assertion in CI passed on the file that took production down.
 * They verify the SHAPE of build/_headers -- a policy is present, connect-src
 * names the API, /embed detaches the inherited policy, shared headers appear
 * once. All true, all useless against a policy that forbids the script which
 * starts the app. No amount of header shape detects a page that never executes.
 *
 * This check is different in kind: it reads the build output the policy will
 * govern and asserts the policy actually permits it. It fails on the exact
 * artifact that shipped, which is the only property that makes a check worth
 * having.
 *
 * Usage: `node scripts/check-inline-hashes.mjs` after `npm run build`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { collectInlineScripts, uniqueHashes } from './inline-script-hashes.mjs';

const OUT_DIR = 'build';
const HEADERS_PATH = 'build/_headers';

function fail(message) {
	console.error(`::error::${message}`);
	process.exit(1);
}

if (!existsSync(OUT_DIR)) fail(`${OUT_DIR}/ does not exist -- run npm run build first.`);
if (!existsSync(HEADERS_PATH)) fail(`${HEADERS_PATH} is missing -- did scripts/gen-headers.mjs run?`);

const headers = readFileSync(HEADERS_PATH, 'utf8');
const policies = headers
	.split('\n')
	.map((line) => line.trim())
	.filter((line) => line.startsWith('Content-Security-Policy:'));

if (policies.length === 0) fail('no Content-Security-Policy line in build/_headers.');

const found = collectInlineScripts(OUT_DIR);
const hashes = uniqueHashes(found);

console.log(`check-inline-hashes: ${found.length} inline script(s), ${hashes.length} unique hash(es)`);
console.log(`check-inline-hashes: ${policies.length} policy line(s) in ${HEADERS_PATH}`);

/**
 * Checked per policy, not against the file as a whole. /embed detaches the
 * site-wide policy and sets its own, so a hash present only under /* would let
 * the embed break on its own while the file still looked correct.
 */
const problems = [];
for (const hash of hashes) {
	const offenders = policies.filter((policy) => !policy.includes(hash));
	if (offenders.length > 0) {
		const files = [...new Set(found.filter((f) => f.hash === hash).map((f) => f.file))];
		problems.push(`'${hash}' (in ${files.join(', ')}) is absent from ${offenders.length} of ${policies.length} policies`);
	}
}

if (problems.length > 0) {
	for (const problem of problems) console.error(`::error::unhashed inline script: ${problem}`);
	fail('an inline script in the build is not permitted by every generated policy. The browser will refuse to execute it and the page will render blank.');
}

if (policies.some((policy) => /script-src[^;]*'unsafe-inline'/.test(policy))) {
	fail("script-src contains 'unsafe-inline'. Hash the inline scripts instead -- 'unsafe-inline' permits any injected script.");
}

if (hashes.length === 0) {
	// Not a failure. A build with no inline script is legitimate; it is just not
	// what SvelteKit currently produces, so say so rather than pass in silence.
	console.warn('check-inline-hashes: no inline scripts found. Expected at least the SvelteKit bootstrap -- verify the build is complete.');
}

console.log('check-inline-hashes: every inline script is permitted by every policy.');
