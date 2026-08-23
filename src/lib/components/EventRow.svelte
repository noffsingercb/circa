<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { todayISO, yearOf } from '$lib/dates';
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

	/**
	 * Upper bound on the year field, derived from the clock rather than typed in.
	 *
	 * It was max="2200", which is where the browser's native "enter a year
	 * earlier than 2200" message came from -- a bound the engine never shared,
	 * since it refuses anything past next year. Everything from 2028 up was a
	 * year this input invited and the API was always going to reject.
	 *
	 * This attribute is a courtesy, not the gate. It only fires on typed input,
	 * and a timeline rebuilt from a shared URL never touches this form at all,
	 * so assertValid in dates.ts is the check that actually holds. Both are
	 * derived from today so they cannot drift apart.
	 */
	const MAX_YEAR = yearOf(todayISO());

	function onPlaceInput(node: Event) {
		const value = (node.currentTarget as HTMLInputElement).value;
		event.placeQuery = value;
		event.place = null;
		open = true;
		suggester.suggest(value, (places) => {
			suggestions = places;
		});
	}

	let suggestions: ResolvedPlace[] = [];
	let open = false;

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
		<!--
			inputmode alongside type="number": the type is what keeps the value
			numeric and the min/max meaningful, the inputmode is what actually
			gets a keypad rather than a full keyboard on Android.
		-->
		<input
			type="number"
			inputmode="numeric"
			bind:value={event.date.year}
			placeholder="Year"
			aria-label="Year"
			min="1"
			max={MAX_YEAR}
		/>
		<input
			type="number"
			inputmode="numeric"
			bind:value={event.date.month}
			placeholder="Mo"
			aria-label="Month"
			min="1"
			max="12"
		/>
		<input
			type="number"
			inputmode="numeric"
			bind:value={event.date.day}
			placeholder="Day"
			aria-label="Day"
			min="1"
			max="31"
		/>
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
	/*
	 * Four named areas, and every child placed into one.
	 *
	 * The stacked layout at the bottom of this file reorders these controls,
	 * and named areas are the readable way to say so. They are also inert on
	 * their own: grid-template-areas without a matching grid-area on each child
	 * places nothing. That was the bug -- the stacked rule named its areas,
	 * assigned none of them, and the children auto-placed in source order into
	 * a 1fr/2rem grid, which put the place input in the remove-button lane at
	 * roughly 32px wide and its suggestion list along with it.
	 */
	.row {
		display: grid;
		grid-template-columns: 9rem minmax(12rem, 1fr) auto 2rem;
		grid-template-areas: 'kind place date remove';
		gap: 0.5rem;
		align-items: start;
		margin-bottom: 0.6rem;
	}

	select {
		grid-area: kind;
	}

	.place {
		grid-area: place;
		position: relative;
	}

	.place input {
		width: 100%;
	}

	.date {
		grid-area: date;
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
		grid-area: remove;
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

	/*
	 * Stacked, one field per line.
	 *
	 * 640px rather than 620px, matching EntryCard so the app has one mobile
	 * breakpoint instead of two that disagree. The four-column row's own
	 * minimum is 9 + 12 + 12.7 + 2rem plus three 0.5rem gaps, about 595px, and
	 * main adds 1.25rem of padding either side -- so it needs about 635px of
	 * viewport and has to be gone before then. At 620px it was not, and the row
	 * overflowed sideways for the fifteen pixels in between.
	 */
	@media (max-width: 640px) {
		.row {
			grid-template-columns: minmax(0, 1fr) 2.75rem;
			grid-template-areas:
				'kind remove'
				'place place'
				'date date';
			gap: 0.4rem 0.5rem;
			margin-bottom: 1.1rem;
		}

		/*
		 * The date fields spend the width stacking just freed instead of
		 * huddling at the left in fixed tracks. Year keeps the larger share: it
		 * is the only one of the three that takes four digits, and the only one
		 * most visitors fill in.
		 */
		.date {
			grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) minmax(0, 1fr);
		}

		/*
		 * 44px targets. Every control here is hit with a thumb, and the place
		 * suggestions are hit with the keyboard already open.
		 */
		select,
		.place input,
		.date input {
			min-height: 2.75rem;
		}

		.remove {
			height: 2.75rem;
			font-size: 1.15rem;
		}

		.suggestions button {
			padding: 0.7rem 0.6rem;
		}

		/*
		 * The list opens downward into the on-screen keyboard, so it is capped
		 * and scrolls rather than running underneath it. It is deliberately not
		 * flipped above the input: that needs live measurement against the
		 * visual viewport, which is worth writing only with a device in hand.
		 */
		.suggestions {
			max-height: 40vh;
			overflow-y: auto;
			overscroll-behavior: contain;
		}
	}
</style>
