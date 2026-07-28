<script lang="ts">
	import EntryCard from '$lib/components/EntryCard.svelte';
	import { MIN_GAP_PX, PX_PER_YEAR } from '$lib/config';
	import type { CircaEntry, CircaResult } from '$lib/types';

	export let data: CircaResult;

	interface Placed {
		entry: CircaEntry;
		y: number;
		trueY: number;
	}

	function fractionalYear(iso: string): number {
		const year = Number(iso.slice(0, 4));
		const month = Number(iso.slice(5, 7)) || 1;
		const day = Number(iso.slice(8, 10)) || 1;
		const yearStart = Date.UTC(year, 0, 1);
		const yearLength = Date.UTC(year + 1, 0, 1) - yearStart;
		return year + (Date.UTC(year, month - 1, day) - yearStart) / yearLength;
	}

	/**
	 * Position every entry on a true year scale, then push apart anything that
	 * would overlap. A leader line is drawn back to the honest position so a
	 * dense cluster still reads as a cluster.
	 */
	function layout(entries: CircaEntry[]): Placed[] {
		if (entries.length === 0) return [];
		const origin = fractionalYear(entries[0].dateStartISO);
		let previous = Number.NEGATIVE_INFINITY;

		return entries.map((entry) => {
			const trueY = (fractionalYear(entry.dateStartISO) - origin) * PX_PER_YEAR;
			const y = Math.max(trueY, previous + MIN_GAP_PX);
			previous = y;
			return { entry, y, trueY };
		});
	}

	$: entries = data.entries;
	$: placed = layout(entries);
	$: firstYear = entries.length ? Math.floor(fractionalYear(entries[0].dateStartISO)) : 0;
	$: lastYear = entries.length
		? Math.ceil(fractionalYear(entries[entries.length - 1].dateStartISO))
		: 0;
	$: height = placed.length ? placed[placed.length - 1].y + 150 : 0;
	$: ticks = buildTicks(firstYear, lastYear);

	function buildTicks(from: number, to: number): { year: number; y: number }[] {
		if (!from || to <= from) return [];
		const step = to - from > 160 ? 25 : to - from > 60 ? 10 : 5;
		const start = Math.ceil(from / step) * step;
		const out: { year: number; y: number }[] = [];
		for (let year = start; year <= to; year += step) {
			out.push({ year, y: (year - from) * PX_PER_YEAR });
		}
		return out;
	}
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

	<div class="timeline" style="height: {height}px">
		<div class="rail"></div>

		{#each ticks as tick (tick.year)}
			<div class="tick" style="top: {tick.y}px"><span>{tick.year}</span></div>
		{/each}

		{#each placed as item (item.entry.id)}
			{#if item.y - item.trueY > 4}
				<div
					class="leader"
					style="top: {item.trueY}px; height: {item.y - item.trueY}px"
				></div>
			{/if}
			<div class="dot {item.entry.scope}" style="top: {item.y}px"></div>
			<div class="entry" style="top: {item.y - 12}px">
				<EntryCard entry={item.entry} />
			</div>
		{/each}
	</div>

	<p class="provenance">
		{entries.length} events · {firstYear}–{lastYear} · dataset {data.datasetVersion} · {data.generatedWith}
	</p>
{/if}

<style>
	.timeline {
		position: relative;
		margin: 1.5rem 0 0;
		padding-left: 5.5rem;
	}

	.rail {
		position: absolute;
		left: 5rem;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--line);
	}

	.tick {
		position: absolute;
		left: 0;
		width: 4.4rem;
		text-align: right;
		font-size: 0.7rem;
		color: var(--ink-soft);
		border-top: 1px dashed transparent;
		transform: translateY(-0.5em);
	}

	.leader {
		position: absolute;
		left: 5rem;
		width: 2px;
		background: var(--accent-soft);
	}

	.dot {
		position: absolute;
		left: 5rem;
		width: 9px;
		height: 9px;
		margin-left: -3.5px;
		border-radius: 50%;
		background: #fff;
		border: 2px solid var(--ink-soft);
	}

	/* Dot weight tracks how far the event reached, not how close it was. */
	.dot.local {
		width: 7px;
		height: 7px;
		margin-left: -2.5px;
		border-color: #b6ac9c;
	}

	.dot.national {
		width: 11px;
		height: 11px;
		margin-left: -4.5px;
		border-color: var(--accent);
	}

	.dot.global {
		width: 13px;
		height: 13px;
		margin-left: -5.5px;
		border-color: var(--accent);
		background: var(--accent);
	}

	.entry {
		position: absolute;
		left: 6.5rem;
		right: 0;
		max-width: 34rem;
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
