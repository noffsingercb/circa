<script lang="ts">
	import type { ChipCount } from '$lib/filters';

	/**
	 * The chip controls above the timeline.
	 *
	 * Deliberately dumb: the parent owns the filter state and hands this
	 * component the chips to draw, which ones are off, and how to change that.
	 * TimelineView is the only place that knows both the entries and the state,
	 * and it is where the filtered count has to be reported anyway.
	 */
	export let scope: readonly ChipCount[] = [];
	export let category: readonly ChipCount[] = [];
	export let hidden: ReadonlySet<string>;
	export let toggle: (id: string) => void;
	export let showAll: () => void;

	/*
	 * A group with one chip is not a filter, it is an off switch for the whole
	 * timeline -- pressing it can only empty the list, since every row in the
	 * group belongs to that single chip. Suppressed rather than rendered as a
	 * control that has exactly one useless position.
	 */
	$: showScope = scope.length > 1;
	$: showCategory = category.length > 1;

	$: anyHidden = hidden.size > 0;
</script>

{#if showScope || showCategory}
	<div class="filters no-print">
		{#if showScope}
			<!--
				aria-pressed rather than a checkbox, matching the km/mi and Reach
				controls already in +page.svelte: the state is announced as pressed or
				not, and the group is named so a screen reader says what the row of
				buttons is for before reading the buttons.
			-->
			<div class="group" role="group" aria-label="Filter by how far an event reached">
				<span class="legend">Reach</span>
				{#each scope as item (item.chip.id)}
					<button
						type="button"
						class="chip"
						class:off={hidden.has(item.chip.id)}
						aria-pressed={!hidden.has(item.chip.id)}
						on:click={() => toggle(item.chip.id)}
					>
						{item.chip.label}
						<span class="count">{item.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if showCategory}
			<div class="group" role="group" aria-label="Filter by kind of event">
				<span class="legend">Kind</span>
				{#each category as item (item.chip.id)}
					<button
						type="button"
						class="chip"
						class:off={hidden.has(item.chip.id)}
						aria-pressed={!hidden.has(item.chip.id)}
						on:click={() => toggle(item.chip.id)}
					>
						{item.chip.label}
						<span class="count">{item.count}</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if anyHidden}
			<button type="button" class="reset" on:click={showAll}>Show all</button>
		{/if}
	</div>
{/if}

<style>
	.filters {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		margin: 1.25rem 0 0;
	}

	.group {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}

	.legend {
		font-size: 0.7rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
		margin-right: 0.15rem;
	}

	/*
	 * Shaped like EntryCard's chips on purpose -- same radius, same type size --
	 * so the controls read as the same vocabulary as the labels they filter.
	 * Interactive rather than decorative, so they carry the accent tint at rest
	 * and go flat and struck-through when off.
	 */
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.72rem;
		padding: 0.2rem 0.55rem;
		border-radius: 999px;
		border: 1px solid #e0cdb4;
		background: var(--accent-soft);
		color: #6d4419;
		cursor: pointer;
	}

	/*
	 * An off chip has to be unmistakably off at a glance, because the only other
	 * evidence is rows that are no longer there. Colour alone would not survive
	 * a greyscale print or a red-green deficiency, so the label is struck through
	 * as well.
	 */
	.chip.off {
		background: #fff;
		border-color: var(--line);
		color: #a29a8c;
		text-decoration: line-through;
	}

	.count {
		font-size: 0.66rem;
		font-variant-numeric: tabular-nums;
		opacity: 0.75;
	}

	.reset {
		border: 1px solid var(--line);
		background: #fff;
		color: var(--ink-soft);
		border-radius: 6px;
		padding: 0.25rem 0.6rem;
		font-size: 0.75rem;
		cursor: pointer;
	}

	.reset:hover {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-soft);
	}
</style>
