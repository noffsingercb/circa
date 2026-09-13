// Wires SuggestLink into src/routes/+page.svelte.
//
// Run once from the repo root:  node scripts/wire-suggest-link.mjs
//
// Delete this file after the change is committed. It exists because two
// anchored edits in one file are safer done by a script than by hand, not
// because the repo needs a codemod.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'src/routes/+page.svelte');

const src = readFileSync(FILE, 'utf8');

// Preserved explicitly. Writing back with the other convention would show up
// as every line changed in the diff and bury the two real edits.
const newline = src.includes('\r\n') ? '\r\n' : '\n';
console.log(`read ${src.length} chars, newline = ${newline === '\r\n' ? 'CRLF' : 'LF'}`);

if (src.includes('SuggestLink')) {
	console.log('SuggestLink is already wired in. Nothing to do.');
	process.exit(0);
}

// Tabs, because the file is tab-indented. A space-indented insertion would
// pass the build and fail prettier in CI.
const edits = [
	{
		name: 'import',
		find: "\timport SiteFooter from '$lib/components/SiteFooter.svelte';",
		replace: [
			"\timport SiteFooter from '$lib/components/SiteFooter.svelte';",
			"\timport SuggestLink from '$lib/components/SuggestLink.svelte';"
		].join(newline)
	},
	{
		name: 'tag',
		find: '\t\t\t<TimelineView data={$result} lifeEvents={$timelineEvents} filterable />',
		replace: [
			'\t\t\t<TimelineView data={$result} lifeEvents={$timelineEvents} filterable />',
			'',
			'\t\t\t<!-- Inside the results block on purpose: the ask only makes sense to',
			'\t\t\t     someone looking at a timeline, so it cannot appear on the landing',
			'\t\t\t     page, mid-request, or on the written pages. -->',
			'\t\t\t<SuggestLink />'
		].join(newline)
	}
];

let out = src;

for (const edit of edits) {
	const count = out.split(edit.find).length - 1;
	if (count !== 1) {
		// throw, not exit: an anchor that matched 0 or 2 times means the file is
		// not what this script was written against, and a partial write would be
		// worse than no write at all.
		throw new Error(`ABORT: anchor "${edit.name}" matched ${count} times, expected 1. Nothing written.`);
	}
	out = out.replace(edit.find, edit.replace);
	console.log(`anchor "${edit.name}" ok`);
}

writeFileSync(FILE, out, 'utf8');
console.log(`wrote ${out.length} chars to ${FILE}`);
