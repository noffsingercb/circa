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
| `PX_PER_YEAR` | `14` | Vertical pixels per calendar year |
| `MIN_GAP_PX` | `96` | Minimum spacing before crowded entries are nudged apart |
| `GEOCODE_DEBOUNCE_MS` | `300` | Keystroke settle time before a place lookup fires |
| `GEOCODE_MIN_QUERY` | `3` | Shortest query that triggers a lookup |

### Engine mirrors — handle with care

These restate values whose real home is `DEFAULT_CONFIG` in geohistory-core. Circa sends them on the
wire, which means **it silently overrides the engine's own defaults**.

| Value | Default | Mirrors |
| --- | --- | --- |
| `BASE_FLOOR` | `0.15` | `DEFAULT_CONFIG.significanceFloor` |
| `MAX_PER_SEGMENT` | `10` | `DEFAULT_CONFIG.maxPerSegment` (engine default is 12) |
| `MAX_SEGMENTS` | `20` | `DEFAULT_CONFIG.maxSegments` |

`RELAXED_FLOOR` (`0.05`) and `MIN_MATCHES` (`3`) are the sparsity backstop: if a segment returns
fewer than `MIN_MATCHES` entries, that segment alone is re-queried at the lower floor and the extra
entries are marked "Wider net" in the UI.

> **Known coupling.** If GeoHistory ever changes its default floor — say from 0.15 to 0.22 — Circa
> will keep sending 0.15 and no test will catch the drift. Two ways out, neither implemented yet:
> stop sending a floor on the normal request so the engine default always wins and send an explicit
> floor only on the sparsity retry; or expose `DEFAULT_CONFIG` from the API and relax to "engine
> default minus 0.10" rather than a literal. Until then, this table is the thing to check after an
> engine release.

`scopeQuota` and `categoryWeights` are **deliberately not sent**. Per-tier flood control is the
engine's job, so a retune in GeoHistory reaches Circa with no release here.

### What does and does not require a Circa release

| Change in GeoHistory | Circa work |
| --- | --- |
| New events seeded, or a full re-ingest | **None.** Rebuild, redeploy the API, done |
| Scoring or reach retuned (`npm run score reach`) | **None.** No version bump, no redeploy here |
| Category weights or scope quotas retuned | **None.** Circa never sends them |
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
| `npm run build` | Static bundle into `build/` |
| `npm run preview` | Serve the built bundle |
| `npm test` | Unit tests (vitest) |
| `npm run check` | Svelte + TypeScript typecheck |

### Requires a running GeoHistory API

Circa talks to `POST {VITE_CIRCA_API}/v1/timeline`. Until the engine's `server.ts` is extracted,
containerized, and deployed, point `VITE_CIRCA_API` at a local `npm run serve` on port 8787.

The API must be reachable from the browser and must allow the embedding origin via CORS. It should
be hosted as a container on a managed host — never on a personal machine, and never with a path from
public traffic back into a workstation or its credentials.

### A note on `src/lib/types.ts`

The engine half of that file restates the geohistory-core@0.4.1 contract rather than importing it,
so that Circa builds today, before `packages/geohistory-core` is extracted and published. Once the
package exists, delete that block and re-export from the package — the names are identical on
purpose. Only shapes are duplicated, never logic.

---

## Embedding

Build, host the `build/` directory anywhere static, and iframe the `/embed` route. It renders the
form and timeline with no page chrome and reports its own height to the host, since an iframe cannot
size itself.

```html
<iframe
  id="circa"
  src="https://your-host.example/embed"
  style="width:100%;border:0;height:640px"
  title="Circa"
  loading="lazy"
></iframe>

<script>
  window.addEventListener('message', function (event) {
    // Pin this to the origin you actually serve Circa from.
    if (event.origin !== 'https://your-host.example') return;
    if (event.data && event.data.type === 'circa:height') {
      document.getElementById('circa').style.height = event.data.height + 'px';
    }
  });
</script>
```

The only thing ever posted to the host page is a pixel height.

---

## Project layout

```
src/lib/config.ts            every tunable, one file
src/lib/types.ts             engine contract + Circa types
src/lib/dates.ts             partial dates (year / month / day)
src/lib/segments.ts          life events -> engine segments  [the only Circa-owned logic]
src/lib/geocode.ts           Photon lookup, debounce, place identity
src/lib/api.ts               engine client + sparsity retry
src/lib/session.ts           in-memory app state
src/lib/components/          form rows, timeline, entry cards
src/routes/+page.svelte      the full page
src/routes/embed/            chromeless build for iframing
tests/                       segment derivation, geocoding
```

---

## Status

v0.1 MVP. Working: the row editor, loose place lookup, segment derivation, the engine client with
its sparsity backstop, the year-scaled timeline, reset, print, and the embed route.

Not yet: thumbs up/down relevance feedback, and a deployed API to point at.

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
- **Wikidata** (CC0) and **Wikipedia** (CC BY-SA) — the source of the historic events and their
  blurb text. The share-alike terms on Wikipedia-derived text are worth understanding before the
  dataset itself is redistributed or sold.
