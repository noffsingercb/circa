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
 * Reading it here is safe: this script runs in the same `npm run build` as Vite
 * itself, so it sees the same environment that produced the bundle.
 *
 * Usage: `npm run build` (vite build && node scripts/gen-headers.mjs)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * The policy, as one function of frame-ancestors.
 *
 * default-src 'none' rather than 'self': the allowances below are then a
 * complete, readable list of what this app actually does, and anything new has
 * to be added deliberately. Every directive that could otherwise silently
 * inherit from default-src is named.
 *
 * - script-src 'self'         -- no inline script anywhere. Verified: app.html
 *                                carries no bootstrap script, only a referrer
 *                                meta and a stylesheet link. No 'unsafe-inline'
 *                                here, which is the directive that matters.
 * - style-src adds 'unsafe-inline' -- REQUIRED, not an oversight. Svelte injects
 *                                component styles as inline <style> blocks, and
 *                                the timeline sets computed positions as inline
 *                                style attributes. Removing it renders the site
 *                                unstyled. Inline style is a defacement risk,
 *                                not a script-execution one.
 * - img-src adds data:        -- inline SVG icons and any data-URI favicon.
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
		"script-src 'self'",
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
 * Shared headers.
 *
 * Note what is NOT here: X-Frame-Options. It is superseded by CSP
 * frame-ancestors, it has no per-path override that matches what /embed needs,
 * and shipping both invites the two to disagree -- at which point browsers
 * differ on which one they honour. frame-ancestors is the single source of
 * truth for framing.
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

function block(path, frameAncestors, note) {
	const lines = [path];
	if (note) lines.push(`  # ${note}`);
	for (const h of COMMON) lines.push(`  ${h}`);
	lines.push(`  Content-Security-Policy: ${csp(frameAncestors)}`);
	return lines.join('\n');
}

/**
 * /embed is INTENTIONALLY framable -- that is the entire feature, and the
 * README documents the host-side integration. So it gets its own rule with
 * `frame-ancestors *` rather than inheriting the site-wide denial.
 *
 * Order matters: Cloudflare applies the later, more specific rule for a header
 * set by both. Both /embed and /embed/ are listed because the static adapter
 * serves the route at either path and a rule is matched literally.
 *
 * The main app is what clickjacking actually threatens (it has the form and the
 * vote buttons), and that keeps frame-ancestors 'none'. /embed has no
 * authentication, no session and nothing to steal a click for.
 */
const content = [
	'# GENERATED FILE -- do not edit.',
	'# Written by scripts/gen-headers.mjs during `npm run build`.',
	'# connect-src is derived from VITE_CIRCA_API so it cannot drift from the',
	'# API origin compiled into the bundle. Change the policy in that script.',
	'',
	block('/*', "'none'", 'Site-wide: framing denied.'),
	'',
	block('/embed', '*', 'Embeddable by design -- see README > Embedding.'),
	'',
	block('/embed/', '*', 'Same route, trailing slash.'),
	''
].join('\n');

if (!existsSync(OUT_DIR)) {
	// Only happens if this is run without a preceding vite build. Creating the
	// directory means the file is still written and the CI assertion still has
	// something to check, rather than failing on a confusing ENOENT.
	console.warn(`gen-headers: ${OUT_DIR}/ did not exist -- run this after vite build.`);
	mkdirSync(OUT_DIR, { recursive: true });
}

const outPath = join(OUT_DIR, '_headers');
writeFileSync(outPath, content, 'utf8');

console.log(`gen-headers: wrote ${outPath}`);
console.log(`gen-headers:   connect-src 'self' ${apiOrigin} ${PHOTON_ORIGIN}`);
console.log("gen-headers:   frame-ancestors 'none' site-wide, * on /embed");
