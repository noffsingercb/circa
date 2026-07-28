<script lang="ts">
	import { onMount, tick } from 'svelte';
	import EventForm from '$lib/components/EventForm.svelte';
	import TimelineView from '$lib/components/TimelineView.svelte';
	import { result, status } from '$lib/session';

	/**
	 * Chromeless build for iframing into another page.
	 *
	 * An iframe cannot size itself, so this route measures its own document and
	 * posts the height to whatever embedded it. The host listens for a message of
	 * type 'circa:height' and sets the iframe height. See README > Embedding.
	 *
	 * Nothing but a number is ever posted, and it goes to the parent frame only.
	 */
	let root: HTMLElement;

	function reportHeight() {
		if (!root || typeof window === 'undefined' || window.parent === window) return;
		const height = Math.ceil(root.getBoundingClientRect().height) + 24;
		window.parent.postMessage({ type: 'circa:height', height }, '*');
	}

	onMount(() => {
		reportHeight();
		const observer = new ResizeObserver(() => reportHeight());
		observer.observe(root);
		window.addEventListener('resize', reportHeight);
		return () => {
			observer.disconnect();
			window.removeEventListener('resize', reportHeight);
		};
	});

	$: if ($status || $result) {
		tick().then(reportHeight);
	}
</script>

<svelte:head>
	<title>Circa</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="embed" bind:this={root}>
	<EventForm />

	{#if $status === 'loading'}
		<p class="working">Looking through the record…</p>
	{:else if $status === 'ready' && $result}
		<TimelineView data={$result} />
	{/if}
</div>

<style>
	.embed {
		padding: 1.25rem;
		max-width: 52rem;
		margin: 0 auto;
	}

	.working {
		color: var(--ink-soft);
	}
</style>
