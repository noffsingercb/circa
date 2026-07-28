<script lang="ts">
	import EventForm from '$lib/components/EventForm.svelte';
	import TimelineView from '$lib/components/TimelineView.svelte';
	import { result, status } from '$lib/session';
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
				<button type="button" class="ghost" on:click={() => window.print()}>Print</button>
			</div>
			<TimelineView data={$result} />
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

	.working {
		color: var(--ink-soft);
	}
</style>
