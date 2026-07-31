<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { createPhotonProvider, createSuggester } from '$lib/geocode';
	import { LIFE_EVENT_KINDS } from '$lib/types';
	import type { LifeEvent, LifeEventKind, ResolvedPlace } from '$lib/types';

	export let event: LifeEvent;
	export let canRemove = true;

	/**
	 * Kinds already claimed by another row. Selecting them here is blocked
	 * rather than hidden, so the list of choices does not reshuffle as rows are
	 * added. A row never disables its own current kind.
	 */
	export let disabledKinds: LifeEventKind[] = [];

	const dispatch = createEventDispatcher<{ remove: string }>();
	const suggester = createSuggester(createPhotonProvider());

	let suggestions: ResolvedPlace[] = [];
	let open = false;

	function onPlaceInput(node: Event) {
		const value = (node.currentTarget as HTMLInputElement).value;
		event.placeQuery = value;
		event.place = null;
		open = true;
		suggester.suggest(value, (places) => {
			suggestions = places;
		});
	}

	function choose(place: ResolvedPlace) {
		event.place = place;
		event.placeQuery = place.name;
		suggestions = [];
		open = false;
	}

	const PRECISION_NOTE: Record<string, string> = {
		country: 'Country only — matched from the country centre',
		admin1: 'State or region only — matched from its centre',
		county: 'County only — matched from its centre',
		locality: ''
	};

	onDestroy(() => suggester.cancel());
</script>

<div class="row">
	<select bind:value={event.kind} aria-label="Kind of life event">
		{#each LIFE_EVENT_KINDS as kind (kind.value)}
			<option
				value={kind.value}
				disabled={kind.value !== event.kind && disabledKinds.includes(kind.value)}
			>
				{kind.label}
			</option>
		{/each}
	</select>

	<div class="place">
		<input
			type="text"
			value={event.placeQuery}
			placeholder="City, state, or just a country"
			autocomplete="off"
			aria-label="Place"
			on:input={onPlaceInput}
			on:focus={() => (open = suggestions.length > 0)}
		/>
		{#if open && suggestions.length > 0}
			<ul class="suggestions">
				<!--
					Keyed by position on purpose. placeKey is city-level, so two features
					in one city can produce an identical key and Svelte throws on
					duplicates, killing the row until the page is reloaded. This list is
					replaced wholesale on every response and holds no state worth
					preserving across updates.
				-->
				{#each suggestions as place, index (index)}
					<li>
						<button type="button" on:click={() => choose(place)}>{place.name}</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if event.place && PRECISION_NOTE[event.place.level]}
			<p class="note">{PRECISION_NOTE[event.place.level]}</p>
		{/if}
	</div>

	<div class="date">
		<input type="number" bind:value={event.date.year} placeholder="Year" aria-label="Year" min="1" max="2200" />
		<input type="number" bind:value={event.date.month} placeholder="Mo" aria-label="Month" min="1" max="12" />
		<input type="number" bind:value={event.date.day} placeholder="Day" aria-label="Day" min="1" max="31" />
	</div>

	<button
		type="button"
		class="remove"
		disabled={!canRemove}
		aria-label="Remove this life event"
		on:click={() => dispatch('remove', event.id)}
	>
		&times;
	</button>
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 9rem minmax(12rem, 1fr) auto 2rem;
		gap: 0.5rem;
		align-items: start;
		margin-bottom: 0.6rem;
	}

	.place {
		position: relative;
	}

	.place input {
		width: 100%;
	}

	.date {
		display: grid;
		grid-template-columns: 5rem 3.5rem 3.5rem;
		gap: 0.35rem;
	}

	.suggestions {
		position: absolute;
		z-index: 10;
		top: 100%;
		left: 0;
		right: 0;
		margin: 0.15rem 0 0;
		padding: 0;
		list-style: none;
		background: #fff;
		border: 1px solid var(--line);
		border-radius: 6px;
		box-shadow: 0 6px 18px rgba(28, 26, 23, 0.08);
		overflow: hidden;
	}

	.suggestions button {
		display: block;
		width: 100%;
		text-align: left;
		padding: 0.45rem 0.6rem;
		border: 0;
		background: none;
	}

	.suggestions button:hover {
		background: var(--accent-soft);
	}

	.note {
		margin: 0.25rem 0 0;
		font-size: 0.75rem;
		color: var(--ink-soft);
	}

	.remove {
		border: 1px solid var(--line);
		background: #fff;
		border-radius: 6px;
		height: 2.1rem;
		color: var(--ink-soft);
	}

	.remove:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	@media (max-width: 620px) {
		.row {
			grid-template-columns: 1fr 2rem;
			grid-template-areas: 'kind remove' 'place place' 'date date';
		}
	}
</style>
