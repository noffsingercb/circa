<script lang="ts">
	import type { CircaEntry } from '$lib/types';
	import { distanceUnit, formatDistance } from '$lib/units';

	export let entry: CircaEntry;

	const SCOPE_LABEL: Record<string, string> = {
		local: 'Local',
		regional: 'Regional',
		national: 'National',
		global: 'Global'
	};

	/**
	 * Births and deaths are drawn from the engine's person tier but keep a stored
	 * scope of 'local', so rendering entry.scope verbatim badges David Packard's
	 * birth as "Local" alongside genuinely local history. That misreads a working
	 * feature as a bug -- the person tier exists precisely so people do not
	 * consume local slots.
	 *
	 * The engine does not report which tier a row was drawn from, so category is
	 * the available proxy. It is exact: PERSON_CATEGORIES in core.ts is
	 * {birth, death}, the same test used to route the draw.
	 */
	$: isPerson = entry.category === 'birth' || entry.category === 'death';

	$: scopeKey = isPerson ? 'person' : (entry.scope ?? 'unknown');

	$: scopeLabel = isPerson
		? 'Person'
		: entry.scope
			? (SCOPE_LABEL[entry.scope] ?? entry.scope)
			: 'Unclassified';

	/*
	 * Both figures follow the toggle. Converting the distance and leaving the
	 * reach in kilometres would put two units in one sentence and make the
	 * comparison between them meaningless, which is the whole point of the line.
	 */
	$: reachNote = `${formatDistance(entry.distanceKm, $distanceUnit)} of ${formatDistance(
		entry.reachKm,
		$distanceUnit
	)} reach`;
</script>

<article class="card">
	<p class="date">{entry.date}</p>
	<h3>
		<!--
			displayTitle, not title. The dump titles rows after entities, so title
			holds "Oklahoma" where displayTitle holds "Oklahoma Statehood", and
			"Insulin" where displayTitle holds "Discovery of Insulin". The engine
			guarantees displayTitle is populated, falling back to title itself, so
			no fallback is needed here.
		-->
		{#if entry.sourceUrl}
			<a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.displayTitle}</a>
		{:else}
			<!-- Dump rows without a source link render as plain text rather than as a dead anchor. -->
			<span>{entry.displayTitle}</span>
		{/if}
	</h3>
	{#if entry.blurb}
		<p class="blurb">{entry.blurb}</p>
	{/if}
	<p class="chips">
		<span class="chip scope {scopeKey}">{scopeLabel}</span>
		<span class="chip">{reachNote}</span>
		{#if entry.relaxed}
			<span class="chip relaxed" title="Little happened nearby in this stretch, so the bar for inclusion was lowered.">
				Wider net
			</span>
		{/if}
	</p>
</article>

<style>
	.card {
		background: #fff;
		border: 1px solid var(--line);
		border-radius: var(--radius);
		padding: 0.75rem 0.9rem;
		box-shadow: 0 1px 2px rgba(28, 26, 23, 0.04);
	}

	.date {
		margin: 0;
		font-size: 0.72rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--ink-soft);
	}

	h3 {
		margin: 0.15rem 0 0.35rem;
		font-family: var(--font);
		font-size: 1.05rem;
		font-weight: 600;
		line-height: 1.3;
	}

	h3 a {
		color: var(--ink);
		text-decoration: none;
		border-bottom: 1px solid var(--accent-soft);
	}

	h3 a:hover {
		border-bottom-color: var(--accent);
	}

	.blurb {
		margin: 0 0 0.5rem;
		font-size: 0.88rem;
		line-height: 1.45;
		color: #40392f;
	}

	.chips {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}

	.chip {
		font-size: 0.7rem;
		padding: 0.15rem 0.45rem;
		border-radius: 999px;
		background: #f4f1ea;
		color: var(--ink-soft);
		border: 1px solid var(--line);
	}

	.chip.relaxed {
		background: #fdf5e3;
		border-color: #e8d6a8;
		color: #7a5a12;
	}

	.chip.scope.national,
	.chip.scope.global {
		background: var(--accent-soft);
		border-color: #e0cdb4;
		color: #6d4419;
	}

	/* Person rows read as biography rather than geography, so they get their own
	   colour instead of borrowing the local chip's. */
	.chip.scope.person {
		background: #eef2f7;
		border-color: #cfd9e6;
		color: #3d5573;
	}

	.chip.scope.unknown {
		font-style: italic;
	}
</style>
