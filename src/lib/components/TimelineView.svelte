<script lang="ts">
	import EntryCard from '$lib/components/EntryCard.svelte';
	import { isoStart } from '$lib/dates';
	import type { CircaEntry, CircaResult, LifeEvent } from '$lib/types';

	export let data: CircaResult;

	/**
	 * The visitor's own life events, merged into the same stream as the history.
	 *
	 * Optional, and empty by default, so the component still renders on its own
	 * in the embed route where there is no form to supply them.
	 */
	export let lifeEvents: LifeEvent[] = [];

	/**
	 * A single row of the timeline: either something the engine returned or
	 * something the visitor typed. Both carry an ISO date so the two can be
	 * ordered against each other.
	 */
	type Row =
		| { kind: 'entry'; key: string; iso: string; year: number; entry: CircaEntry }
		| { kind: 'life'; key: string; iso: string; year: number; life: LifeEvent };

	const KIND_LABEL: Record<string, string> = {
		birth: 'Born',
		death: 'Died',
		residence: 'Lived in',
		marriage: 'Married'
	};

	function kindLabel(kind: string): string {
		return KIND_LABEL[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1);
	}

	function yearOfIso(iso: string): number {
		return Number(iso.slice(0, 4));
	}

	/**
	 * scope is nullable on the wire, and an unclassified row would otherwise
	 * produce class="dot null" in the markup.
	 */
	function scopeClass(entry: CircaEntry): string {
		if (entry.category === 'birth' || entry.category === 'death') return 'person';
		return entry.scope ?? 'unknown';
	}

	/**
	 * Merge the two sources into one ordered list.
	 *
	 * Ties are broken by putting the life event first: if someone was born in
	 * the same year as a recorded event, the birth is the reason the rest of
	 * the row exists and reads better above it.
	 */
	function buildRows(entries: CircaEntry[], life: LifeEvent[]): Row[] {
		const rows: Row[] = entries.map((entry) => ({
			kind: 'entry' as const,
			key: `entry:${entry.id}`,
			iso: entry.dateStartISO,
			year: yearOfIso(entry.dateStartISO),
			entry
		}));

		for (const event of life) {
			// A row with no year cannot be placed, and a half-filled form is the
			// normal state of this app rather than an error.
			if (event.date.year === null) continue;
			const iso = isoStart(event.date);
			rows.push({
				kind: 'life' as const,
				key: `life:${event.id}`,
				iso,
				year: yearOfIso(iso),
				life: event
			});
		}

		return rows.sort((a, b) => {
			if (a.iso !== b.iso) return a.iso < b.iso ? -1 : 1;
			if (a.kind === b.kind) return 0;
			return a.kind === 'life' ? -1 : 1;
		});
	}

	/**
	 * How old the person was, in whole years, from the birth year alone.
	 *
	 * Deliberately coarse. Most entries carry a year and nothing else, and the
	 * birth usually does too, so computing from full dates would produce a
	 * number that looks exact and is not. This can be a year out either way,
	 * which is how ages in a life story are normally spoken anyway.
	 */
	function ageAt(row: Row, birth: number | null): number | null {
		if (birth === null) return null;
		// The Born tile would read "age 0", which is technically true and looks
		// like a mistake.
		if (row.kind === 'life' && row.life.kind === 'birth') return null;
		const age = row.year - birth;
		// An event predating the birth is possible -- the engine's first segment
		// can reach back before it -- and a negative age is worse than none.
		return age < 0 ? null : age;
	}

	$: entries = data.entries;
	$: rows = buildRows(entries, lifeEvents);
	$: firstYear = rows.length ? rows[0].year : 0;
	$: lastYear = rows.length ? rows[rows.length - 1].year : 0;

	$: birthYear =
		lifeEvents.find((event) => event.kind === 'birth' && event.date.year !== null)?.date.year ??
		null;

	// The year is printed only where it changes. Repeating it against every
	// card in a busy decade adds noise without adding information.
	$: yearShown = rows.map((row, index) => index === 0 || row.year !== rows[index - 1].year);

	// Age follows the year: the two read as one heading over a group of cards
	// that share a date.
	$: ages = rows.map((row, index) => (yearShown[index] ? ageAt(row, birthYear) : null));
</script>

{#if entries.length === 0}
	<p class="empty">
		Nothing in the record reached those places in those years. Try a wider span or a nearby city.
	</p>
{:else}
	{#if data.relaxedSegments.length > 0}
		<p class="notice no-print">
			Little was recorded near some stretches of this life, so the bar for inclusion was lowered
			there. Those entries are marked <strong>Wider net</strong>.
		</p>
	{/if}

	<ol class="timeline">
		<div class="rail" aria-hidden="true"></div>

		{#each rows as row, index (row.key)}
			<li class="row">
				<div class="gutter">
					{#if yearShown[index]}<span class="year">{row.year}</span>{/if}
					{#if ages[index] !== null}<span class="age">age {ages[index]}</span>{/if}
				</div>

				{#if row.kind === 'life'}
					<span class="dot life" aria-hidden="true"></span>
					<div class="body">
						<div class="life-card">
							<p class="life-kind">{kindLabel(row.life.kind)}</p>
							<p class="life-title">
								{row.life.label || row.life.place?.name || 'A life event'}
							</p>
							{#if row.life.label && row.life.place}
								<p class="life-place">{row.life.place.name}</p>
							{/if}
						</div>
					</div>
				{:else}
					<span class="dot {scopeClass(row.entry)}" aria-hidden="true"></span>
					<div class="body">
						<EntryCard entry={row.entry} />
					</div>
				{/if}
			</li>
		{/each}
	</ol>

	<p class="provenance">
		{entries.length} events · {firstYear}–{lastYear} · dataset {data.datasetVersion} · {data.generatedWith}
	</p>
{/if}

<style>
	.timeline {
		position: relative;
		list-style: none;
		margin: 1.5rem 0 0;
		padding: 0;
	}

	/*
	 * The rail is decoration now rather than a scale. It stops short at both
	 * ends so it does not appear to continue past the first and last events.
	 */
	.rail {
		position: absolute;
		left: 5.2rem;
		top: 0.9rem;
		bottom: 0.9rem;
		width: 2px;
		background: var(--line);
	}

	.row {
		display: grid;
		grid-template-columns: 4.4rem 1.6rem minmax(0, 1fr);
		align-items: start;
		margin: 0 0 1.1rem;
	}

	.row:last-child {
		margin-bottom: 0;
	}

	.gutter {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		padding-top: 0.55rem;
		line-height: 1.25;
	}

	.year {
		font-size: 0.72rem;
		color: var(--ink-soft);
		font-variant-numeric: tabular-nums;
	}

	/* Quieter than the year: it is context for the card, not its date. */
	.age {
		font-size: 0.66rem;
		color: #a29a8c;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.dot {
		justify-self: center;
		margin-top: 0.72rem;
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid var(--ink-soft);
		z-index: 1;
	}

	/* Dot weight tracks how far the event reached, not how close it was. */
	.dot.local {
		width: 7px;
		height: 7px;
		border-color: #b6ac9c;
	}

	.dot.national {
		width: 11px;
		height: 11px;
		border-color: var(--accent);
	}

	.dot.global {
		width: 13px;
		height: 13px;
		border-color: var(--accent);
		background: var(--accent);
	}

	.dot.person {
		border-color: #3d5573;
	}

	.dot.unknown {
		border-style: dotted;
	}

	.dot.life {
		width: 11px;
		height: 11px;
		border-color: #3d5573;
		background: #3d5573;
	}

	.body {
		min-width: 0;
		max-width: 34rem;
	}

	/*
	 * Life events are filled rather than white so they read as the visitor's
	 * own rows at a glance, without a legend.
	 */
	.life-card {
		background: #eef2f7;
		border: 1px solid #cfd9e6;
		border-radius: 8px;
		padding: 0.7rem 0.9rem;
	}

	.life-kind {
		margin: 0 0 0.15rem;
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #3d5573;
	}

	.life-title {
		margin: 0;
		font-family: var(--font);
		font-size: 1rem;
		color: var(--ink);
	}

	.life-place {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		color: var(--ink-soft);
	}

	.notice {
		margin: 0;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		background: #fdf5e3;
		border: 1px solid #e8d6a8;
		color: #6b5210;
		font-size: 0.82rem;
	}

	.empty {
		color: var(--ink-soft);
		font-size: 0.9rem;
	}

	.provenance {
		margin: 1rem 0 0;
		font-size: 0.72rem;
		color: var(--ink-soft);
	}
</style>
