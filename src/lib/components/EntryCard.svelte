<script lang="ts">
	import { castVote, votedVerdict, type Verdict } from '$lib/feedback';
	import type { CircaEntry } from '$lib/types';
	import { distanceUnit, formatDistance } from '$lib/units';

	export let entry: CircaEntry;

	/**
	 * The decade of the life segment this entry was matched against, as "1920s".
	 *
	 * Supplied by the parent because it is genuinely not derivable here. The card
	 * receives one entry and nothing else; entry.segmentIndex indexes a segment
	 * list this component never sees, and entry.dateStartISO is the EVENT's date,
	 * not the person's era -- close enough to look right in the database and
	 * wrong in exactly the way that would poison the analysis.
	 *
	 * Null means "this entry cannot be voted on", which is the honest state on
	 * the embed route where no segments are in memory.
	 */
	export let segmentDecade: string | null = null;

	/** Stamped on the vote so feedback can be split across dataset releases. */
	export let datasetVersion: string | null = null;

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

	/* ---------------------------------------------------------------------- */
	/* Feedback                                                               */
	/* ---------------------------------------------------------------------- */

	/**
	 * Re-read when the entry changes, so a card recycled onto a different event
	 * by the keyed each block does not inherit the previous one's filled thumb.
	 * Deliberately does not depend on `voted`, which is what lets the click below
	 * assign to it without this immediately overwriting the assignment.
	 */
	$: voted = votedVerdict(entry.id);

	$: votable = segmentDecade !== null;

	function vote(verdict: Verdict): void {
		if (voted) return;
		const accepted = castVote({ entry, verdict, segmentDecade, datasetVersion });
		// A refusal here means the guard fired -- the same event was already voted
		// on, most likely because it appears in two overlapping segments. Reflect
		// the verdict that actually counted rather than the one just clicked.
		voted = accepted ? verdict : (votedVerdict(entry.id) ?? voted);
	}
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
	<div class="footer">
		<p class="chips">
			<span class="chip scope {scopeKey}">{scopeLabel}</span>
			<span class="chip">{reachNote}</span>
			{#if entry.relaxed}
				<span class="chip relaxed" title="Little happened nearby in this stretch, so the bar for inclusion was lowered.">
					Wider net
				</span>
			{/if}
		</p>

		{#if votable}
			<!--
				class:voted keeps the controls on screen once a verdict is in, so the
				filled thumb does not vanish the moment the pointer leaves and leave
				someone unsure whether the click registered.
			-->
			<div class="thumbs" class:voted={voted !== null}>
				<button
					type="button"
					class="thumb"
					class:on={voted === 'up'}
					disabled={voted !== null}
					aria-pressed={voted === 'up'}
					aria-label="This event belongs here"
					title="This event belongs here"
					on:click={() => vote('up')}
				>
					<!-- Text glyphs rather than icon files: the app ships no icon set, and
					     these render identically in the print stylesheet's absence. -->
					<span aria-hidden="true">&#128077;</span>
				</button>
				<button
					type="button"
					class="thumb"
					class:on={voted === 'down'}
					disabled={voted !== null}
					aria-pressed={voted === 'down'}
					aria-label="This event does not belong here"
					title="This event does not belong here"
					on:click={() => vote('down')}
				>
					<span aria-hidden="true">&#128078;</span>
				</button>
			</div>
		{/if}
	</div>
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

	/*
	 * The chips and the thumbs share the bottom line. align-items: flex-end
	 * keeps the buttons on the last row of chips when they wrap, rather than
	 * floating beside the first.
	 */
	.footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.chips {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		min-width: 0;
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

	/*
	 * Hidden by opacity, NOT by display or visibility.
	 *
	 * A display:none button is not in the tab order at all, so a keyboard
	 * visitor could never reach it -- and :focus-within, which is what reveals
	 * the controls for that visitor, can never fire on something unfocusable.
	 * The buttons are always present and always focusable; only their paint
	 * changes.
	 */
	.thumbs {
		display: flex;
		gap: 0.15rem;
		flex: none;
		opacity: 0;
		transition: opacity 120ms ease-in;
	}

	.card:hover .thumbs,
	.thumbs:focus-within,
	.thumbs.voted {
		opacity: 1;
	}

	.thumb {
		appearance: none;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 0.1rem 0.25rem;
		font-size: 0.82rem;
		line-height: 1.2;
		cursor: pointer;
		/* Greyed until chosen, so an unvoted pair does not read as two live
		   opinions already registered. */
		filter: grayscale(1);
		opacity: 0.55;
	}

	.thumb:hover {
		background: #f4f1ea;
		opacity: 0.85;
	}

	.thumb.on {
		filter: none;
		opacity: 1;
		border-color: var(--accent-soft);
		background: var(--accent-soft);
	}

	/*
	 * The unchosen thumb fades out rather than disappearing: the row still reads
	 * as a pair, and its width does not change under the pointer.
	 */
	.thumb:disabled {
		cursor: default;
	}

	.thumb:disabled:not(.on) {
		opacity: 0.2;
	}

	/*
	 * Below the mobile breakpoint there is no hover to reveal anything with, so
	 * the controls are simply always there.
	 */
	@media (max-width: 640px) {
		.thumbs {
			opacity: 1;
		}
	}

	/* A printed timeline is a keepsake; buttons on it are noise. */
	@media print {
		.thumbs {
			display: none;
		}
	}
</style>
