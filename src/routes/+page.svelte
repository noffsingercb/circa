<script lang="ts">
	import { onMount } from 'svelte';
	import { warmUp } from '$lib/api';
	import EventForm from '$lib/components/EventForm.svelte';
	import SiteFooter from '$lib/components/SiteFooter.svelte';
	import TimelineView from '$lib/components/TimelineView.svelte';
	import { listenForReachKey, REACH_KEY_HINT, reachArmed, showReach } from '$lib/debug';
	import { decodeShare, encodeShare } from '$lib/share';
	import { events, result, status, submit, timelineEvents } from '$lib/session';
	import { distanceUnit } from '$lib/units';

	/** True once this visit was opened from a shared link, for the wait message. */
	let openedFromLink = false;

	/** The dataset the sender saw, if they sent one. Compared against the result. */
	let senderDataset: string | null = null;

	let shareDialog: HTMLDialogElement | undefined;
	let shareInput: HTMLInputElement | undefined;
	let shareUrl = '';
	let copyState: 'idle' | 'copied' | 'failed' = 'idle';

	/*
	 * Wake the API while the visitor reads and types.
	 *
	 * The service sleeps on the free tier after about 15 minutes of quiet, and
	 * booting it can take up to a minute. Anyone filling in this form needs at
	 * least a place and a date first, so the boot overlaps with work the visitor
	 * was going to do anyway and is usually invisible.
	 *
	 * onMount rather than module scope: this must not run during the prerender
	 * that adapter-static does at build time, where there is no visitor to warm
	 * anything for and the API URL may not even be reachable from the builder.
	 *
	 * A shared link is the one path where the boot has nothing to hide behind,
	 * so it waits for the warm-up instead of firing and forgetting. Filling the
	 * form first is deliberate: the visitor watches their relative's life appear
	 * on screen while the query is in flight, which explains both what the page
	 * is and what it is waiting for far better than a spinner does.
	 *
	 * The whole body is one async IIFE because decodeShare has to inflate the
	 * payload before it knows whether this is a shared link at all.
	 */
	onMount(() => {
		void (async () => {
			const shared = await decodeShare(window.location.hash);

			if (shared === null) {
				// void, not await: nothing on this page waits for it. warmUp never
				// rejects, so there is no failure to handle -- see api.ts.
				void warmUp();
				return;
			}

			openedFromLink = true;
			senderDataset = shared.datasetVersion;
			events.set(shared.events);

			await warmUp();
			// One automatic request and no more. If it fails, EventForm shows the
			// error and its own button, and the form is still filled in, so trying
			// again is a single press the visitor chooses to make.
			await submit();
		})();

		// Returned so the key listener is torn down with the component. The IIFE
		// above is fired rather than awaited because onMount cannot return a
		// cleanup function and a promise at the same time.
		return listenForReachKey();
	});

	/**
	 * Build the link at the moment it is asked for.
	 *
	 * From $timelineEvents rather than $events, so the link describes the
	 * timeline actually on screen. Anything typed into the form since is part of
	 * a request nobody has run yet, and sending it would share a page the sender
	 * has never seen.
	 *
	 * The payload goes after the '#'. Fragments are not transmitted to the
	 * server, so the places and dates in the form stay out of Cloudflare's and
	 * Render's request logs -- a query string would write both to two providers
	 * on every open.
	 */
	async function openShare() {
		const payload = await encodeShare($timelineEvents, $result?.datasetVersion ?? null);
		if (payload === '') return;

		shareUrl = `${window.location.origin}${window.location.pathname}#${payload}`;
		copyState = 'idle';
		shareDialog?.showModal();

		// Pre-selected so select-and-copy works immediately, which matters because
		// the clipboard call below is the part that can fail.
		queueMicrotask(() => shareInput?.select());
	}

	async function copyShare() {
		// Selected first, so every path below leaves the visitor one Ctrl+C away
		// from the link even if both copy attempts are refused.
		shareInput?.select();

		try {
			await navigator.clipboard.writeText(shareUrl);
			copyState = 'copied';
			return;
		} catch {
			// Fall through to the older API rather than giving up here.
		}

		// Deprecated, and still the only thing that works outside a secure
		// context. Note that localhost IS a secure context by spec, so this is not
		// about local dev -- it is about a phone reaching the dev server over a
		// LAN IP, and about older Safari, where writeText is simply absent.
		try {
			copyState = document.execCommand('copy') ? 'copied' : 'failed';
		} catch {
			copyState = 'failed';
		}
	}

	/*
	 * Determinism holds only against the same dataset. Once the corpus is
	 * rescored, an old link quietly returns a different timeline than the sender
	 * saw -- not corruption, but the sender said "look at this" about something
	 * the recipient can no longer see. Two string comparisons disclose it; no
	 * extra request is needed, since the result carries its own version.
	 */
	$: datasetDrifted =
		openedFromLink &&
		senderDataset !== null &&
		$result?.datasetVersion != null &&
		$result.datasetVersion !== senderDataset;
</script>

<svelte:head>
	<title>Circa — the history around a life</title>
	<meta
		name="description"
		content="Give Circa a birth or a death and the places a life touched, and see the history that was within reach of those places at the time."
	/>
</svelte:head>

<main>
	<header class="no-print">
		<h1>Circa</h1>
		<p class="intro">
			Circa shows you what was happening around a person’s life. Give it a birth or a death, plus
			any places they lived, and it builds a timeline of the events that were within reach of those
			places at the time.
		</p>
		<!--
			Stated once, up here, because the question it answers arrives before the
			form is filled in rather than after. Short on purpose: the detail lives
			in the FAQ, and spelling it out at length here would imply there is
			something to disclose.
		-->
		<p class="privacy">
			Circa doesn’t ask who you’re looking up. No accounts, no names, no sign-in.
			<a
				class="why"
				href="/faq"
				data-sveltekit-reload
				title="A place and a date are all Circa needs. There is no name field, nothing is saved, and no account exists to tie a search to. Read more in the FAQ."
				aria-label="Why Circa asks for so little — read the FAQ"
			>
				?
			</a>
		</p>
	</header>

	<!-- Wrapped rather than marked inside EventForm: the form has no opinion
	     about print, this page does. On paper the controls are not part of the
	     document, and at ~740px they would render at desktop width anyway --
	     EventRow only stacks below 640px. -->
	<div class="no-print">
		<EventForm />
	</div>

	{#if $status === 'loading'}
		<!-- Name the wait rather than spinning at someone. A visitor who arrived
		     from a link did not choose to be here and will not wait through an
		     unexplained pause; being told why costs nothing. -->
		<p class="working">
			{#if openedFromLink}
				Waking the history service — this can take up to a minute the first time.
			{:else}
				Looking through the record…
			{/if}
		</p>
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
					<!--
						Absent until asked for, by Ctrl+Alt+R or by ?debug=1. It states its
						own position rather than disappearing when switched off, so what a
						visitor sees and what the scoring saw are one click apart instead of
						another keystroke apart.
					-->
					{#if $reachArmed}
						<div class="units debug" role="group" aria-label="Reach calculations">
							<button
								type="button"
								class:active={$showReach}
								aria-pressed={$showReach}
								title={`Show the reach behind each row (${REACH_KEY_HINT})`}
								on:click={() => showReach.update((on) => !on)}
							>
								Reach
							</button>
						</div>
					{/if}
					<!-- Here rather than in the page header because a link cannot exist
					     before a timeline does. -->
					<button type="button" class="ghost" on:click={openShare}>Share this timeline</button>
					<button type="button" class="ghost" on:click={() => window.print()}>Print</button>
				</div>
			</div>

			{#if datasetDrifted}
				<p class="drift">
					This link was made against dataset {senderDataset}, and the history record has been
					updated since. Some events may differ from the ones the sender saw.
				</p>
			{/if}

			<!-- $timelineEvents, not $events: the rail describes the request that was
			     answered, and the live form does not emit on every keystroke anyway. -->
			<TimelineView data={$result} lifeEvents={$timelineEvents} />
		</div>
	{/if}
</main>

<!-- Outside main, so it sits below the page's own bottom padding rather than
     inside the reading column. Not added to the embed route: that build is
     chromeless by design and is being iframed into someone else's page, where
     navigation belongs to the host and not to us. -->
<SiteFooter />

<!-- One <dialog>, no library. Escape closes it and focus returns to the Share
     button natively; a hand-rolled overlay would have to reimplement both. -->
<dialog bind:this={shareDialog} class="share no-print" on:close={() => (copyState = 'idle')}>
	<h2>Share this timeline</h2>
	<p>
		Anyone opening this link gets the same life events filled in, and the timeline builds itself.
		Nothing is stored on a server — the whole timeline travels inside the link.
	</p>

	<input bind:this={shareInput} class="url" type="text" readonly value={shareUrl} />

	<div class="share-actions">
		{#if copyState === 'copied'}
			<span class="copied" role="status">Copied</span>
		{:else if copyState === 'failed'}
			<span class="copied" role="status">Selected — press Ctrl+C</span>
		{/if}
		<span class="spacer"></span>
		<button type="button" class="ghost" on:click={() => shareDialog?.close()}>Close</button>
		<button type="button" class="primary" on:click={copyShare}>Copy link</button>
	</div>
</dialog>

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

	/* Tightened because a second line now follows it. The 2rem gap belongs
	   below the pair, not between them. */
	header p.intro {
		margin-bottom: 0.8rem;
	}

	.privacy {
		font-size: 0.85rem;
	}

	/* A quiet circled question mark. Hover gives the sentence, clicking goes
	   to the FAQ -- title alone is invisible to a keyboard, so the link is the
	   real affordance and the tooltip is the shortcut. */
	.why {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.05rem;
		height: 1.05rem;
		border: 1px solid var(--line);
		border-radius: 50%;
		color: var(--ink-soft);
		text-decoration: none;
		font-size: 0.7rem;
		line-height: 1;
		vertical-align: middle;
		margin-left: 0.15rem;
	}

	.why:hover {
		border-color: var(--accent);
		color: var(--accent);
		background: var(--accent-soft);
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

	/* Echoes the dashed chip in EntryCard, so a screenshot taken with reach on
	   is recognisable as a diagnostic view rather than as the real page. */
	.units.debug {
		border-style: dashed;
	}

	.working {
		color: var(--ink-soft);
	}

	/* Stated quietly. The timeline is not wrong, it is just not identical to
	   the one the sender was looking at. */
	.drift {
		margin: 1rem 0 0;
		padding: 0.6rem 0.75rem;
		border: 1px solid var(--line);
		border-radius: 6px;
		background: var(--accent-soft);
		color: #6d4419;
		font-size: 0.82rem;
	}

	.share {
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 1.25rem;
		max-width: 34rem;
		width: calc(100% - 2rem);
		background: #fff;
		color: var(--ink);
	}

	.share::backdrop {
		background: rgba(28, 26, 23, 0.35);
	}

	.share h2 {
		margin: 0 0 0.5rem;
	}

	.share p {
		margin: 0 0 0.9rem;
		color: var(--ink-soft);
		font-size: 0.85rem;
		line-height: 1.5;
	}

	/* Readable and selectable even when it is long. The input is the fallback
	   for every case where the clipboard write is refused. */
	.url {
		width: 100%;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.75rem;
	}

	.share-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.9rem;
	}

	.spacer {
		flex: 1;
	}

	.copied {
		font-size: 0.8rem;
		color: var(--ink-soft);
	}

	.primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: #fff;
		border-radius: 6px;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
	}
</style>
