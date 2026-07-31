<script lang="ts">
	import { onMount } from 'svelte';
	import { warmUp } from '$lib/api';
	import EventForm from '$lib/components/EventForm.svelte';
	import TimelineView from '$lib/components/TimelineView.svelte';
	import { result, status, timelineEvents } from '$lib/session';
	import { distanceUnit } from '$lib/units';

	/*
	 * Wake the API while the visitor reads and types.
	 *
	 * The service sleeps on the free tier after about 15 minutes of quiet, and
	 * booting it can take up to a minute. Anyone filling in this form needs at
	 * least a name, a place and a date first, so the boot overlaps with work the
	 * visitor was going to do anyway and is usually invisible.
	 *
	 * onMount rather than module scope: this must not run during the prerender
	 * that adapter-static does at build time, where there is no visitor to warm
	 * anything for and the API URL may not even be reachable from the builder.
	 *
	 * void, not await: nothing on this page waits for it. warmUp never rejects,
	 * so there is no failure to handle here -- see the contract in api.ts.
	 */
	onMount(() => {
		void warmUp();
	});
</script>

<svelte:head>
	<title>Circa — the history around a life</title>
	<meta
		name="description"
		content="Enter a few life events and see the history that reached them."
	/>
</svelte:head>

<main>
	<header class="no-print">
		<h1>Circa</h1>
		<p>
			Enter what you know of a life — where it began, where it went, where it ended — and see the
			history that reached those places while it was being lived.
		</p>
	</header>

	<EventForm />

	{#if $status === 'loading'}
		<p class="working">Looking through the record…</p>
	{:else if $status === 'ready' && $result}
		<div class="results">
			<div class="results-head no-print">
				<h2>The timeline</h2>
				<div class="head-actions">
					<!--
						Two buttons rather than a switch: both units stay readable, and the
						active one is stated outright instead of being inferred from which
						side a slider sits on. aria-pressed is what makes that state
						audible to a screen reader.
					-->
					<div class="units" role="group" aria-label="Distance units">
						<button
							type="button"
							class:active={$distanceUnit === 'km'}
							aria-pressed={$distanceUnit === 'km'}
							on:click={() => distanceUnit.set('km')}
						>
							km
						</button>
						<button
							type="button"
							class:active={$distanceUnit === 'mi'}
							aria-pressed={$distanceUnit === 'mi'}
							on:click={() => distanceUnit.set('mi')}
						>
							mi
						</button>
					</div>
					<button type="button" class="ghost" on:click={() => window.print()}>Print</button>
				</div>
			</div>
			<!-- $timelineEvents, not $events: the rail describes the request that was
			     answered, and the live form does not emit on every keystroke anyway. -->
			<TimelineView data={$result} lifeEvents={$timelineEvents} />
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 52rem;
		margin: 0 auto;
		padding: 3rem 1.25rem 6rem;
	}

	h1 {
		font-family: var(--font);
		font-size: 2.4rem;
		margin: 0 0 0.35rem;
		letter-spacing: -0.01em;
	}

	header p {
		margin: 0 0 2rem;
		color: var(--ink-soft);
		max-width: 38rem;
		line-height: 1.55;
	}

	.results-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		border-top: 1px solid var(--line);
		padding-top: 1.5rem;
	}

	.head-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	h2 {
		font-family: var(--font);
		font-size: 1.3rem;
		margin: 0;
	}

	.ghost {
		border: 1px solid var(--line);
		background: #fff;
		color: var(--ink-soft);
		border-radius: 6px;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
	}

	/* One outline around the pair, so they read as two states of one control
	   rather than two unrelated buttons. */
	.units {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
		background: #fff;
	}

	.units button {
		border: 0;
		background: transparent;
		color: var(--ink-soft);
		padding: 0.35rem 0.6rem;
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		cursor: pointer;
	}

	.units button + button {
		border-left: 1px solid var(--line);
	}

	.units button.active {
		background: var(--accent-soft);
		color: #6d4419;
	}

	.working {
		color: var(--ink-soft);
	}
</style>
