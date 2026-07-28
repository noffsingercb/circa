<script lang="ts">
	import type { CircaEntry } from '$lib/types';

	export let entry: CircaEntry;

	const SCOPE_LABEL: Record<string, string> = {
		local: 'Local',
		regional: 'Regional',
		national: 'National',
		global: 'Global'
	};

	$: reachNote = `${Math.round(entry.distanceKm)} km of ${Math.round(entry.reachKm)} km reach`;
</script>

<article class="card">
	<p class="date">{entry.date}</p>
	<h3>
		<a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer">{entry.title}</a>
	</h3>
	<p class="blurb">{entry.blurb}</p>
	<p class="chips">
		<span class="chip scope {entry.scope}">{SCOPE_LABEL[entry.scope] ?? entry.scope}</span>
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
</style>
