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

	/**
	 * Where the height message is addressed.
	 *
	 * This was hardcoded to '*', which means "deliver to whatever origin happens
	 * to be in the parent frame, and do not check". The payload here is a pixel
	 * height, so the leak is small -- but '*' is a habit rather than a decision,
	 * and the same line copied into a route that posts something worth having is
	 * a real disclosure. Address it properly here and the pattern in the codebase
	 * is the correct one.
	 *
	 * It CANNOT be pinned to a constant. /embed is publicly embeddable by design
	 * (its CSP carries frame-ancestors *), so the legitimate host is unknown at
	 * build time -- hardcoding one origin would break the documented feature for
	 * everybody else.
	 *
	 * document.referrer is the parent document's URL for a framed page, so it
	 * gives us the actual embedding origin. Where it is unavailable -- a host
	 * sending Referrer-Policy: no-referrer, or a sandboxed frame -- we fall back
	 * to '*', because a height message that never arrives means an iframe stuck
	 * at its default height, and that is a worse trade for a number that is
	 * already visible to anyone who can see the frame.
	 */
	let targetOrigin = '*';

	function resolveTargetOrigin(): string {
		if (typeof document === 'undefined') return '*';
		const referrer = document.referrer;
		if (!referrer) return '*';
		try {
			const url = new URL(referrer);
			// Anything other than plain http(s) is not an origin postMessage can
			// meaningfully target; 'null' opaque origins land here too.
			if (url.protocol !== 'https:' && url.protocol !== 'http:') return '*';
			return url.origin;
		} catch {
			return '*';
		}
	}

	function reportHeight() {
		if (!root || typeof window === 'undefined' || window.parent === window) return;
		const height = Math.ceil(root.getBoundingClientRect().height) + 24;
		window.parent.postMessage({ type: 'circa:height', height }, targetOrigin);
	}

	onMount(() => {
		// Resolved once, on mount, rather than per message: the parent cannot change
		// under a live frame, and re-reading it on every resize would be work for no
		// gain.
		targetOrigin = resolveTargetOrigin();

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
