#!/usr/bin/env node
/**
 * Emits build/_headers for Cloudflare Pages.
 *
 * WHY THIS IS GENERATED AND NOT A COMMITTED static/_headers FILE
 *
 * The Content-Security-Policy has to name the API origin in connect-src, and
 * that origin is not a constant -- it comes from VITE_CIRCA_API, which Vite
 * bakes into the bundle at build time and which differs between local dev,
 * the Pages deployment, and whatever custom domain the API ends up on. A
 * committed file would hold a second, hand-maintained copy of that value, and
 * the two would eventually disagree.
 *
 * The failure mode of that disagreement is the expensive part. A CSP that
 * omits the real API origin does not degrade: every timeline request is
 * blocked by the browser before it is sent, the network tab shows nothing, and
 * it presents exactly like an API outage. Deriving both from one variable makes
 * that class of bug impossible rather than merely unlikely.
 *
 * The same argument turned out to apply to script-src, the hard way. See the
 * script-src note in csp() below.
 *
 * Reading it here is safe: this script runs in the same `npm run build` as Vite
 * itself, so it sees the same environment -- and the same build output -- that
 * produced the bundle.
 *
 * Usage: `npm run build` (vite build && node scripts/gen-headers.mjs)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectInlineScripts, uniqueHashes } from './inline-script-hashes.mjs';

/** Must match `pages`/`assets` in svelte.config.js. */
const OUT_DIR = 'build';

/** Must match the fallback in src/lib/config.ts, so an unset var behaves identically in both. */
const API_FALLBACK = 'https://api.geohistory.example';

/** The geocoder. Hardcoded because src/lib/config.ts hardcodes the same host. */
const PHOTON_ORIGIN = 'https://photon.komoot.io';

/**
 * Reduce a base URL to a bare origin, which is the only granularity CSP
 * source expressions use. A path on a connect-src entry is ignored by some
 * browsers and honoured by others; either way it is not what we mean.
 */
function originOf(raw, label) {
	try {
		const url = new URL(raw);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') {
			throw new Error(`unsupported scheme ${url.protocol}`);
		}
		return url.origin;
	} catch (err) {
		console.error(`gen-headers: ${label} is not a usable URL (${raw}): ${err.message}`);
		process.exit(1);
	}
}

const rawApi = process.env.VITE_CIRCA_API?.trim();

if (!rawApi) {
	// Loud, and deliberately not fatal. A missing variable is a deployment
	// configuration problem, and failing the build here would take the whole site
	// down over a header file. The site is already broken in this state -- the
	// bundle points at the same placeholder -- so the useful thing is to say so
	// in the build log where somebody will read it.
	console.warn('');
	console.warn('gen-headers: WARNING -- VITE_CIRCA_API is not set.');
	console.warn(`gen-headers: connect-src will allow ${API_FALLBACK}, which is a placeholder.`);
	console.warn('gen-headers: the app cannot reach a real API in this state either.');
	console.warn('gen-headers: set it in Cloudflare Pages > Settings > Environment variables and rebuild.');
	console.warn('');
}

const apiOrigin = originOf(rawApi || API_FALLBACK, 'VITE_CIRCA_API');

// The output directory is needed BEFORE the policy is built, because the policy
// now depends on what is in it.
if (!existsSync(OUT_DIR)) {
	// Only happens if this is run without a preceding vite build. Creating the
	// directory means the file is still written and the CI assertion still has
	// something to check, rather than failing on a confusing ENOENT.
	console.warn(`gen-headers: ${OUT_DIR}/ did not exist -- run this after vite build.`);
	mkdirSync(OUT_DIR, { recursive: true });
}

/**
 * Hashes for the inline scripts the build actually emitted. See
 * scripts/inline-script-hashes.mjs for why these are scanned and not declared.
 */
const inlineScripts = collectInlineScripts(OUT_DIR);
const inlineHashes = uniqueHashes(inlineScripts);

if (inlineHashes.length === 0) {
	console.warn('gen-headers: no inline scripts found in the build.');
	console.warn('gen-headers: expected at least the SvelteKit bootstrap -- if the build is');
	console.warn('gen-headers: complete, script-src will be stricter than it needs to be.');
}

const scriptSrc = ["script-src 'self'", ...inlineHashes.map((hash) => `'${hash}'`)].join(' ');

/**
 * The policy, as one function of frame-ancestors.
 *
 * default-src 'none' rather than 'self': the allowances below are then a
 * complete, readable list of what this app actually does, and anything new has
 * to be added deliberately. Every directive that could otherwise silently
 * inherit from default-src is named.
 *
 * - script-src 'self' + sha256 hashes -- no 'unsafe-inline', which is the
 *                                keyword that actually matters, since it would
 *                                permit any injected inline script. The hashes
 *                                cover SvelteKit's bootstrap, which
 *                                adapter-static injects into the GENERATED html
 *                                at build time. An earlier version of this
 *                                comment claimed there was no inline script
 *                                anywhere and cited src/app.html as proof: the
 *                                template is indeed clean, but the policy
 *                                applies to the build output, which was not.
 *                                The result was a blank page in production --
 *                                the bootstrap was refused, so nothing
 *                                hydrated. Hashes are recomputed every build
 *                                because the bootstrap embeds chunk filenames.
 * - style-src adds 'unsafe-inline' -- REQUIRED, not an oversight. Svelte injects
 *                                component styles as inline <style> blocks, and
 *                                the timeline sets computed positions as inline
 *                                style attributes. Removing it renders the site
 *                                unstyled. Inline style is a defacement risk,
 *                                not a script-execution one.
 * - img-src adds data:        -- inline SVG icons and any data-URI favicon.
 * - font-src 'self'           -- the type stack is ui-serif/ui-sans-serif and
 *                                other system families (static/theme.css), so
 *                                no web font is ever fetched.
 * - connect-src               -- the API and the geocoder, nothing else.
 * - frame-ancestors           -- who may embed us. The parameter to this whole
 *                                function; see below.
 * - base-uri / form-action / object-src 'none' -- there is no <base>, no form
 *                                submission (the form is handled in JS), and no
 *                                plugin content. Denying them removes three
 *                                classic injection levers at no cost.
 */
function csp(frameAncestors) {
	return [
		"default-src 'none'",
		scriptSrc,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data:",
		"font-src 'self'",
		`connect-src 'self' ${apiOrigin} ${PHOTON_ORIGIN}`,
		"manifest-src 'self'",
		"base-uri 'none'",
		"form-action 'none'",
		"object-src 'none'",
		`frame-ancestors ${frameAncestors}`
	].join('; ');
}

/**
 * Shared headers. Emitted ONLY under /* -- see the note on rule composition
 * below. Repeating them in the /embed rules duplicated every one of them on
 * that route.
 *
 * Note what is NOT here: X-Frame-Options. It is superseded by CSP
 * frame-ancestors, and -- decisively, given how Pages composes rules -- it has
 * no per-path override. An X-Frame-Options: DENY under /* would be inherited by
 * /embed and would block the embed just as thoroughly as the CSP did.
 * frame-ancestors is the single source of truth for framing because it is the
 * only framing header that can be detached per path.
 *
 * Strict-Transport-Security is safe on pages.dev (HTTPS only, and the apex
 * already has HSTS) and will apply unchanged to a custom domain. includeSubDomains
 * is included deliberately; add preload only after a custom domain is settled,
 * since preload is effectively irreversible.
 */
const COMMON = [
	'X-Content-Type-Options: nosniff',
	'Referrer-Policy: no-referrer',
	'Strict-Transport-Security: max-age=31536000; includeSubDomains',
	// Denied rather than merely unused. The app geocodes place names over HTTP
	// through Photon and never calls navigator.geolocation, so the browser
	// permission prompt should be impossible to trigger -- a page that asks a
	// visitor for their exact location while claiming to look up place names by
	// name is the wrong impression to give even by accident.
	'Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=(), usb=()',
	'Cross-Origin-Opener-Policy: same-origin'
];

function rule(path, lines) {
	return [path, ...lines.map((line) => `  ${line}`)].join('\n');
}

/**
 * HOW CLOUDFLARE PAGES COMPOSES THESE RULES -- MEASURED, NOT ASSUMED
 *
 * Pages applies every rule whose path matches and CONCATENATES the results. It
 * does not treat a more specific rule as an override. Measured against preview
 * deployment af71183d:
 *
 *   GET /       -> 1 Content-Security-Policy header
 *   GET /embed  -> 2 Content-Security-Policy headers
 *
 * That distinction is the whole ballgame. Under CSP, when a response carries
 * several policies each one is enforced independently and content must satisfy
 * all of them -- policies intersect, they do not replace. So an /embed response
 * carrying both `frame-ancestors 'none'` and `frame-ancestors *` is NOT
 * framable: the strictest wins. The rule intended to make /embed embeddable was
 * doing nothing at all, and failing invisibly, since the header looks correct
 * if you only read the second copy.
 *
 * Hence `! Content-Security-Policy`, which detaches the header inherited from
 * /* so this rule's policy is the only one on the response.
 *
 * Because /embed's policy is standalone, it needs its own copy of the inline
 * script hashes -- csp() supplies them to both, so the embed cannot be left
 * behind by a policy that only /* received.
 *
 * /embed is INTENTIONALLY framable -- that is the entire feature, and the
 * README documents the host-side integration. The main app is what clickjacking
 * actually threatens (it has the form and the vote buttons) and keeps
 * frame-ancestors 'none'. /embed has no authentication, no session, and nothing
 * to steal a click for.
 *
 * Both /embed and /embed/ are listed because a rule is matched literally. The
 * trailing-slash form 308-redirects to /embed, but it is enumerated so the
 * redirect response is not the one place with an unintended policy.
 */
const EMBED_RULE_LINES = [
	'# Embeddable by design -- see README > Embedding.',
	'# Detach the inherited site-wide policy first: Pages appends rules rather',
	'# than overriding them, and two policies on one response intersect.',
	'! Content-Security-Policy',
	`Content-Security-Policy: ${csp('*')}`
];

const content = [
	'# GENERATED FILE -- do not edit.',
	'# Written by scripts/gen-headers.mjs during `npm run build`.',
	'# connect-src is derived from VITE_CIRCA_API and the script-src hashes are',
	'# derived from the built HTML, so neither can drift from what shipped.',
	'# Change the policy in that script.',
	'',
	rule('/*', [
		'# Site-wide: framing denied. These headers are inherited by every route,',
		'# including /embed, so they are set here once and not repeated below.',
		...COMMON,
		`Content-Security-Policy: ${csp("'none'")}`
	]),
	'',
	rule('/embed', EMBED_RULE_LINES),
	'',
	rule('/embed/', EMBED_RULE_LINES),
	''
].join('\n');

const outPath = join(OUT_DIR, '_headers');
writeFileSync(outPath, content, 'utf8');

console.log(`gen-headers: wrote ${outPath}`);
console.log(`gen-headers:   connect-src 'self' ${apiOrigin} ${PHOTON_ORIGIN}`);
console.log("gen-headers:   frame-ancestors 'none' site-wide; detached and set to * on /embed");
console.log(`gen-headers:   script-src 'self' + ${inlineHashes.length} inline hash(es) from ${inlineScripts.length} script tag(s)`);
for (const hash of inlineHashes) console.log(`gen-headers:     '${hash}'`);
