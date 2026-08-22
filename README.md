# Circa

Enter what you know of a life — where it began, where it went, where it ended — and Circa returns
the history that reached those places while it was being lived: a scrollable vertical timeline,
scaled to years, each entry linking out to its Wikipedia article.

No accounts. No sign-in. No cookies, no storage, no analytics, no personal details of any kind.
The form lives in memory and is gone on refresh.

> **Copyright © 2026 Ben Noffsinger. All rights reserved.**
>
> This repository is public, but it is **not** open source. No license is granted. You may view and
> fork it within GitHub's Terms of Service; you may not otherwise use, copy, modify, or redistribute
> it. See [Copyright](#copyright) below.

---

## How it works

Circa is a static front end. All of the historical reasoning happens in the
[GeoHistory](https://github.com/noffsingercb/GeoHistory) engine, which Circa reaches over HTTP.

1. **You enter life events.** Any mix of precision: a full address or just a country, an exact date
   or just a year. One birth or death is required so the lifespan has an anchor.
2. **Circa derives segments.** Each event opens a place-and-time segment that runs until the next
   event begins. Consecutive events in the same city merge into one. A birth with no death runs 100
   years forward; a death with no birth runs 100 years backward from the earliest known place.
3. **The engine matches events to segments.** Matching is **event-side**: every historic event
   carries its own `reach_km`, derived from its scope and significance, and it matches a segment
   when the segment's point falls inside that reach. A parish fire reaches 30 km; a world war
   reaches everywhere.
4. **Circa renders the result.** Dots are weighted by scope, each entry shows how far it travelled
   relative to its reach, and anything that only surfaced under a lowered bar is flagged.

The direction matters. Casting a fixed radius out from the *person* buries a city dweller in
parish-level noise while missing the distant war that shaped their life. Casting each *event's own*
reach means an event earns its place on the timeline by how far it actually carried.

### Place precision is a disclosure, not a dial

If you enter only "Peru," Circa uses the country centroid and says so. It does not widen any search
radius, because there is no search radius on this side. Reach belongs to the event.

---

## Tuning policy

**Every tunable number lives in [`src/lib/config.ts`](src/lib/config.ts), and every one of them can
be overridden by a `VITE_` environment variable.** Copy `.env.example` to `.env` and change values
there — no code edit, no recompile of anything but the static bundle. There are no magic numbers
anywhere else in the codebase; if you find one, it belongs in `config.ts`.

The file separates two kinds of value, and the distinction is the whole point:

### Circa policy — ours to change freely

| Value | Default | What it does |
| --- | --- | --- |
| `LIFESPAN_CAP_YEARS` | `100` | Window assumed when only a birth or only a death is given |
| `MAX_EVENTS` | `20` | Most life-event rows the form accepts |
| `GLOBAL_CAP` | `80` | Ceiling on rendered entries, trimmed by score then re-sorted by date |
| `DEATH_LOOKBACK_YEARS` | `8` | How far back a death-anchored final segment reaches |
| `REQUEST_TIMEOUT_MS` | `45_000` | Timeline request timeout; generous because a free-tier API cold start can take most of a minute |
| `WARMUP_TIMEOUT_MS` | `60_000` | Budget for the fire-and-forget health ping on page load |
| `GEOCODE_DEBOUNCE_MS` | `300` | Keystroke settle time before a place lookup fires |
| `GEOCODE_MIN_QUERY` | `3` | Shortest query that triggers a lookup |

### Engine mirrors — handle with care

These restate values whose real home is `DEFAULT_CONFIG` in geohistory-core. Circa sends them on the
wire, which means **it overrides the engine's own defaults for these keys**.

| Value | Default | Mirrors |
| --- | --- | --- |
| `MAX_PER_SEGMENT` | `17` | `DEFAULT_CONFIG.maxPerSegment` (engine default is 12) |
| `MAX_SEGMENTS` | `20` | `DEFAULT_CONFIG.maxSegments` |

`RELAXED_LOCAL_FLOOR` (`0.05`) and `MIN_MATCHES` (`3`) are the sparsity backstop: if a segment
returns fewer than `MIN_MATCHES` entries, that segment alone is re-queried with
`scopeFloor.local` set to the relaxed value, and the extra entries are marked "Wider net" in the UI.
It is sent as `scopeFloor.local` rather than as a scalar `significanceFloor` on purpose — a scalar
would also lower the birth/death floor and flood a thin segment with minor local figures.

**No floor is sent on the normal request.** The engine keeps a separate floor per scope (local 0.05,
regional 0.15, national 0.15, global 0.20) and a scalar `significanceFloor` is applied as a blanket
minimum to every scope not named explicitly — so the old `BASE_FLOOR=0.15` was quietly lifting the
local floor from 0.05 to 0.15 and filtering out curated local rows, which average 0.133. The
engine's tuned defaults now stand, which also closes the drift this section used to warn about: a
retune of the floor in GeoHistory reaches Circa with no release here.

`scopeQuota` and `categoryWeights` are **deliberately not sent** either. Per-tier flood control is
the engine's job.

> **The API clamps what it accepts.** `maxPerSegment` is bounded to 1–50 and `maxSegments` to 1–40,
> any floor to 0.01–1, and unknown config keys are rejected outright with a `400`. Both values above
> sit well inside those bounds. `GET /v1/meta` publishes the full bounds table alongside the engine
> defaults, so this table can be checked against the live service rather than trusted.

### What does and does not require a Circa release

| Change in GeoHistory | Circa work |
| --- | --- |
| New events seeded, or a full re-ingest | **None.** Rebuild, redeploy the API, done |
| Scoring or reach retuned (`npm run score reach`) | **None.** No version bump, no redeploy here |
| Category weights, scope quotas, or floors retuned | **None.** Circa never sends them |
| A renamed or removed field on `SegmentInput` / `TimelineEntry` | **Required.** Ships as a new major and a new `/v2` path |

Circa pins the endpoint at `/v1/timeline` and treats the response as opaque beyond the fields it
renders. Breaking engine changes ship alongside `/v1`, not on top of it.

---

## Running it

```bash
npm install
cp .env.example .env      # point VITE_CIRCA_API at your GeoHistory service
npm run dev
```

| Script | Does |
| --- | --- |
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Static bundle into `build/`, **then** generates `build/_headers` |
| `npm run headers` | Regenerates `build/_headers` alone (debugging the policy) |
| `npm run preview` | Serve the built bundle |
| `npm test` | Unit tests (vitest) |
| `npm run check` | Svelte + TypeScript typecheck |

### Requires a running GeoHistory API

Circa talks to `POST {VITE_CIRCA_API}/v1/timeline`. The engine's `server.ts` is containerized and
deployed on **Render**; for local work, point `VITE_CIRCA_API` at a local `npm run serve` on port
8787.

Two things about the hosted API are worth knowing:

- **It must allow this origin.** The API refuses browser requests from any origin not in its
  `ALLOWED_ORIGIN` allowlist, and once that allowlist is set it also refuses `POST`s that arrive
  with no `Origin` header. The allowlist is comma-separated and matched **exactly** against the
  browser's `Origin` header, so a trailing slash or a missing scheme fails closed. In production it
  holds `https://circatimeline.org`, `https://www.circatimeline.org` and the older
  `https://circa-2cg.pages.dev`. Preview deployments have their own hostnames and are therefore
  *not* allowlisted by default — a preview that renders but cannot build a timeline is usually this,
  not a bug, and the fix is not a wildcard. A healthy API plus a missing allowlist entry looks
  exactly like an outage, so that is the first thing to check when every request fails.
- **A free instance sleeps** after roughly 15 minutes of no traffic. `src/lib/api.ts` fires a
  single, non-blocking `GET /v1/health` on page load so the container wakes while the visitor is
  still filling in the form.

### A note on `src/lib/types.ts`

The engine half of that file restates the geohistory-core@0.5.1 contract rather than importing it,
so that Circa builds today, before `packages/geohistory-core` is extracted and published. Once the
package exists, delete that block and re-export from the package — the names are identical on
purpose. Only shapes are duplicated, never logic.

---

## Security

Circa has no accounts, no cookies and no server of its own, which removes most of the usual attack
surface and leaves two things that matter: what the browser is allowed to do on this origin, and
what the app does with data it did not author.

### Response headers are generated, not committed

`npm run build` runs [`scripts/gen-headers.mjs`](scripts/gen-headers.mjs), which writes
`build/_headers` for Cloudflare Pages. **`build/_headers` is a build artifact — edit the script, not
the output.**

It is generated because the policy has to describe things that are not constants. `connect-src` has
to name the API origin, which comes from `VITE_CIRCA_API`; `script-src` has to name the hash of
SvelteKit's inline bootstrap, which changes whenever a chunk filename changes. A committed policy
would hold hand-maintained copies of both, and when either disagreed with reality the browser would
block the app — silently, and in a way that looks like something else entirely. One build feeds all
of it.

The policy is `default-src 'none'` with a short allowlist: scripts from this origin plus the hashed
inline bootstrap, styles from this origin, the API and Photon on `connect-src`, `data:` images for
the inline SVG icons, and `base-uri`, `form-action` and `object-src` denied outright.

Three deliberate details:

- **`script-src` carries `sha256-` hashes and never `'unsafe-inline'`.** `adapter-static` injects a
  small inline bootstrap into the *generated* HTML — it sets `__sveltekit_*` and dynamically imports
  the app chunks — so a policy of bare `script-src 'self'` refuses the one script that starts the
  application. [`scripts/inline-script-hashes.mjs`](scripts/inline-script-hashes.mjs) scans
  `build/**/*.html` and hashes every inline script it finds; `gen-headers.mjs` emits those hashes in
  **every** policy it writes, including the detached `/embed` one. `'unsafe-inline'` would also have
  worked and is the wrong trade: it permits *any* injected inline script, which is the exact thing
  this policy exists to stop. CI fails the build if it ever appears in `script-src`.
- **`style-src` includes `'unsafe-inline'` and has to.** Svelte injects component styles as inline
  blocks and the timeline sets computed positions as inline style attributes; without it the site
  renders unstyled. Inline *style* is a defacement risk, not a script-execution one.
- **`X-Frame-Options` is not sent.** The decisive reason is per-path control: it cannot be detached
  for a single route the way a CSP header can (see below), so an `X-Frame-Options: DENY` applied
  site-wide would be inherited by `/embed` and would break the embed no matter what the CSP said.
  `frame-ancestors` supersedes it in any case, and sending both invites the two to disagree — at
  which point browsers differ on which they honour.

### The policy applies to build output, so it is derived from build output

This is the lesson from an outage, recorded because the mistake is easy to repeat and cheap to avoid.

The first version of the generator shipped `script-src 'self'` with a comment stating there was no
inline script anywhere, "verified" against `src/app.html`. The template genuinely is clean. But the
policy governs the built HTML, and SvelteKit puts its bootstrap there at build time. Production
served a blank page:

```
Executing inline script violates the following Content Security Policy directive
'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-...'),
or a nonce is required to enable inline execution.
```

Two things about how that got through are worth keeping in mind:

- **The hand-written pages under `static/` kept working.** They carry no inline script, so `/faq/`,
  `/why/` and the rest rendered normally while the app itself did not. The site looked partly alive,
  which is a slower thing to diagnose than an outright failure.
- **Every header check passed.** The CI assertions and the `curl` recipe below both verify the
  *shape* of the headers — a policy exists, `connect-src` names the API, `/embed` detaches the
  inherited policy, shared headers appear once. All were true of the build that shipped blank. No
  amount of header shape detects a page that never executes.

So [`scripts/check-inline-hashes.mjs`](scripts/check-inline-hashes.mjs) now reads the built HTML the
policy will govern and fails CI if any inline script in it is missing from any generated policy. It
fails on the artifact, not on a description of the artifact.

### Cloudflare Pages appends rules, it does not override them

Read this before editing the header script. Pages applies **every** rule whose path matches a
request and concatenates the results; a more specific rule does not replace a broader one. Measured
against a preview deployment:

```
GET /       -> 1 Content-Security-Policy header
GET /embed  -> 2 Content-Security-Policy headers   (before the fix)
```

That is not a cosmetic duplicate. Under CSP, a response carrying several policies has each one
enforced independently, and content must satisfy **all** of them — policies intersect, they do not
replace. So an `/embed` response carrying both `frame-ancestors 'none'` from `/*` and
`frame-ancestors *` from its own rule is **not framable**: the strictest wins. The rule meant to make
the embed work did nothing, and it failed invisibly, because the header looks correct if you read
only the second copy.

Three consequences, all now enforced in CI:

- The `/embed` rules emit `! Content-Security-Policy` to **detach** the inherited policy before
  setting their own, so exactly one policy reaches the browser.
- Because that policy is standalone, it needs its own copy of everything the site-wide policy has —
  the inline script hashes included. A hash present only under `/*` would leave the embed blank
  while the file still looked correct.
- The shared headers (HSTS, COOP, `Referrer-Policy`, `X-Content-Type-Options`,
  `Permissions-Policy`) are declared under `/*` **once** and inherited everywhere. Repeating them
  per-rule duplicated all of them on `/embed` and collapsed HSTS into the malformed value
  `max-age=31536000; includeSubDomains, max-age=31536000; includeSubDomains`.

The same appending behaviour is why Cloudflare's **Bot Fight Mode** and **Page Shield** stay off on
this zone. The first injects its own inline script into HTML responses, which `script-src 'self'`
plus fixed hashes refuses — the identical mechanism that served the blank page above. The second
adds its own `Content-Security-Policy-Report-Only` header, which would be concatenated rather than
substituted, exactly as the duplicated `/embed` policies were.

### Framing

`frame-ancestors 'none'` site-wide; `frame-ancestors *` on `/embed` only. The embed route is
publicly embeddable by design (see [Embedding](#embedding)), so it cannot be pinned to one host, and
it is also the route with nothing to steal a click for — no form submission of consequence, no
session, no authenticated action. The main app, which has the vote buttons and the form, is the one
that clickjacking would actually threaten, and that is the one denied.

Because the host origin is unknown at build time, `/embed` derives it from `document.referrer` and
posts the height message to that origin specifically, falling back to `'*'` only when the referrer
is unavailable (a host sending `Referrer-Policy: no-referrer`, or a sandboxed frame). The payload is
a pixel height either way.

### Dataset-supplied links

`entry.sourceUrl` arrives from the API, which serves it from ~107k rows harvested out of Wikidata,
and it is rendered as an `href`. [`src/lib/url.ts`](src/lib/url.ts) allowlists `http:` and `https:`
using the browser's own URL parser; anything else renders as plain text instead of a link. The CSP
also blocks `javascript:` navigation, but that is the backstop — a header can be dropped by a proxy
or absent on a dev server, and the fix is not emitting the attribute in the first place.

### Checking it

**Load the site in a browser with the console open. Do this first.** Header checks cannot tell you
whether the page runs, and the one time that distinction mattered it cost a production outage. A
clean console and a rendered timeline are the actual pass condition; everything below is
supplementary.

Then count the policies — do not just look for the directive. A single grep for `frame-ancestors *`
passed on the broken file described above, because the string was present, in the second of two
policies that the browser was intersecting away.

```bash
for p in / /embed; do
  echo "== $p"
  curl -sSI "https://circatimeline.org$p" | grep -ci '^content-security-policy'
  curl -sSI "https://circatimeline.org$p" | grep -i -e frame-ancestors -e strict-transport -e sha256
done
```

PowerShell:

```powershell
foreach ($p in @('/', '/embed')) {
    "== $p"
    $raw = curl.exe -sSI "https://circatimeline.org$p"
    ($raw | Select-String '^content-security-policy' -CaseSensitive:$false).Count
    $raw | Select-String 'frame-ancestors|strict-transport|sha256' -CaseSensitive:$false
}
```

Both paths must report **exactly one** policy: `/` with `frame-ancestors 'none'`, `/embed` with
`frame-ancestors *`, and both carrying at least one `sha256-` source in `script-src`. Anything other
than `1` means the rules are composing differently than this section assumes, and the embed is the
first thing that will break. A policy with no hash means the inline bootstrap is unpermitted and the
app will render blank. CI asserts the same invariants against the generated file on every pull
request — the detach line, a one-occurrence check on each shared header, and a hash for every inline
script in the build — so a build that silently regresses fails there rather than in production.

---

## Diagnostics

Every row on a timeline is there because the event's own `reach_km` covered the segment's point. The
chip on each card shows only the distance, because reach is an argument with the scoring model rather
than an answer to anything a visitor asked — printed beside the distance it reads as a second,
unexplained distance.

Reach is one keystroke away when you want it:

| How | Where |
| --- | --- |
| **Ctrl+Alt+R** | Any timeline on screen. Toggles live, no reload |
| **`?debug=1`** | On load. Goes before the `#`, since the share payload owns the fragment |

Once either has fired, a **`Reach`** toggle appears beside the km/mi pair and stays for the rest of
the session, stating its own position — so a visitor's view of a row and the scored view are one
click apart. Chips are dashed while reach is showing, so a screenshot taken in that mode is
recognisable as a diagnostic one rather than as the real page.

`?debug=1` is the path on a phone, where there is no key combination to press. It also survives in a
bookmark or in a share link, which is how to hand somebody else a timeline with the scoring already
visible.

**It is not persisted.** [`src/lib/debug.ts`](src/lib/debug.ts) keeps it in memory like everything
else here, so it dies with the tab. A sticky debug flag would be the first thing to break the promise
at the top of this file, and leaving it switched on for the next visitor would be a strange thing to
do to them.

### Reach reaches the analysis whether or not it is on screen

Nothing about the display affects tuning. Every thumbs up or down sends the full-precision `reachKm`,
the `significance` behind it, and a derived `headroom` — how much of the event's reach was left over
at that distance, where `0.0` means the row scraped in at the very edge. See
[`src/lib/feedback.ts`](src/lib/feedback.ts) for the whole payload and, more to the point, for the
list of things it will never send.

Distance arrives **bucketed** rather than exact, in nine buckets that straddle the 1500 km national
scopeBase on purpose. That is deliberate: enough to tune a reach curve against, not enough to locate
anybody.

---

## Embedding

Build, host the `build/` directory anywhere static, and iframe the `/embed` route. It renders the
form and timeline with no page chrome and reports its own height to the host, since an iframe cannot
size itself.

```html
<iframe
  id="circa"
  src="https://circatimeline.org/embed"
  style="width:100%;border:0;height:640px"
  title="Circa"
  loading="lazy"
></iframe>

<script>
  window.addEventListener('message', function (event) {
    // Pin this to the origin you actually serve Circa from.
    if (event.origin !== 'https://circatimeline.org') return;
    if (event.data && event.data.type === 'circa:height') {
      document.getElementById('circa').style.height = event.data.height + 'px';
    }
  });
</script>
```

The only thing ever posted to the host page is a pixel height, and it is addressed to the embedding
origin rather than broadcast — see [Framing](#framing). The `event.origin` check above is still the
right thing for a host to do: it is what stops some *other* frame on the host page from forging a
height message.

Note that `/embed` is the one route that is deliberately framable. The rest of the site sends
`frame-ancestors 'none'` and will not load in an iframe.

---

## Project layout

```
src/lib/config.ts            every tunable, one file
src/lib/types.ts             engine contract + Circa types
src/lib/dates.ts             partial dates (year / month / day)
src/lib/segments.ts          life events -> engine segments  [the only Circa-owned logic]
src/lib/geocode.ts           Photon lookup, debounce, place identity
src/lib/api.ts               engine client, warm-up ping, sparsity retry
src/lib/session.ts           in-memory app state
src/lib/units.ts             km/mi toggle and distance formatting
src/lib/share.ts             timeline <-> URL fragment payload
src/lib/feedback.ts          thumbs up/down vote payload
src/lib/debug.ts             reach visibility (Ctrl+Alt+R, ?debug=1)
src/lib/url.ts               scheme allowlist for dataset-supplied links
src/lib/components/          form rows, timeline, entry cards
src/routes/+page.svelte      the full page
src/routes/embed/            chromeless build for iframing
scripts/gen-headers.mjs      generates build/_headers at build time
scripts/inline-script-hashes.mjs   hashes the inline scripts the build emitted
scripts/check-inline-hashes.mjs    CI: every inline script is hashed in every policy
static/                      public pages (why, how it works, resources, FAQ) + theme + icons
tests/                       segment derivation, geocoding, sharing, sessions, URL allowlist
```

Vitest collects `tests/**/*.test.ts` only (see `vite.config.ts`), so a test placed next to the module
it covers is never run. Put new suites in `tests/` and import across with a relative path, as the
existing ones do.

---

## Status

v0.1 MVP. Working: the row editor, loose place lookup, segment derivation, the engine client with
its sparsity backstop, the year-scaled timeline, reset, print, the embed route, shareable links,
thumbs up/down relevance feedback, the public pages (why, how it works, resources, FAQ), and the
reach diagnostics above.

Deployed at [circatimeline.org](https://circatimeline.org/) on Cloudflare Pages.
`www.circatimeline.org` redirects to the apex with a `301` that preserves both path and query
string, which matters because a share link carries its entire state in the URL. The original
`circa-2cg.pages.dev` hostname still serves the same build and remains in the API allowlist, so
links shared before the move continue to resolve.

The move needed no change to the CSP, as expected: `connect-src` names the API rather than this
site, `frame-ancestors` is origin-independent, and `paths: { relative: true }` in `svelte.config.js`
means the bundle carries no absolute self-references. What it did need was the new origins in the
API's `ALLOWED_ORIGIN` (comma-separated, exact match) — without them the site loads and every
timeline request fails.

HSTS with `includeSubDomains` commits the apex to HTTPS for a year on the first request a browser
makes to it. That is intended, and it is also why `preload` is **not** sent: preloading ships the
commitment into browsers ahead of any request, and removal takes months. The header is ours to
retract at any time; a preload list entry is not.

---

## Copyright

Copyright © 2026 Ben Noffsinger. All rights reserved.

This repository is public for visibility, not for reuse. Publishing source code does not place it in
the public domain and does not waive copyright; because no license file is present, no rights to
use, copy, modify, or redistribute this work are granted to anyone.

### Third-party attribution

Circa itself is proprietary, but it stands on work that is not, and those obligations travel with
any deployment:

- **[GeoHistory](https://github.com/noffsingercb/GeoHistory)** — the timeline engine and dataset,
  published by the same author under the MIT License. Circa consumes it as a service; that license
  governs the engine, not this front end.
- **[Photon](https://photon.komoot.io/)** and **OpenStreetMap** — place lookup. OSM data is
  © OpenStreetMap contributors, available under the Open Database License (ODbL). Any public
  deployment must credit them.
- **[Lucide](https://lucide.dev/)** — the thumbs-up and thumbs-down icon paths, inlined in
  `EntryCard.svelte` under the ISC License.
- **Wikidata** (CC0) and **Wikipedia** (CC BY-SA) — the source of the historic events and their
  blurb text. The share-alike terms on Wikipedia-derived text are worth understanding before the
  dataset itself is redistributed or sold.
