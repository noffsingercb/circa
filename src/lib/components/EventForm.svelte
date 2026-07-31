<script lang="ts">
	import EventRow from '$lib/components/EventRow.svelte';
	import { MAX_EVENTS } from '$lib/config';
	import { addEvent, errorMessage, events, removeEvent, reset, status, submit } from '$lib/session';
	import type { LifeEventKind } from '$lib/types';

	/**
	 * Kinds a life can only have once. deriveSegments already behaves this way --
	 * it uses the first birth and the last death -- so allowing duplicates in the
	 * form only produced rows that were displayed and then ignored.
	 */
	const UNIQUE_KINDS: LifeEventKind[] = ['birth', 'death'];

	$: takenKinds = UNIQUE_KINDS.filter((kind) => $events.some((row) => row.kind === kind));

	/**
	 * Re-publish the rows so anything derived from them recomputes.
	 *
	 * EventRow edits its row object in place and never reassigns the array, so
	 * the store does not emit when a kind is chosen or a year typed. Without
	 * this, takenKinds above would be computed from whatever the rows looked
	 * like at the last add or remove -- the exact failure that kept life events
	 * off the timeline earlier tonight.
	 *
	 * Native change events bubble, so one handler on the form catches every
	 * row's select. The array is copied but the row objects are not, and the
	 * keyed each keys on id, so nothing is re-created and no input loses focus.
	 */
	function republish() {
		events.update((rows) => rows.slice());
	}
</script>

<form
	class="form no-print"
	on:submit|preventDefault={submit}
	on:change={republish}
>
	{#each $events as event (event.id)}
		<EventRow
			{event}
			canRemove={$events.length > 1}
			disabledKinds={takenKinds}
			on:remove={(e) => removeEvent(e.detail)}
		/>
	{/each}

	<div class="actions">
		<button type="button" class="ghost" on:click={addEvent} disabled={$events.length >= MAX_EVENTS}>
			+ Add a life event
		</button>
		<span class="spacer"></span>
		<button type="button" class="ghost" on:click={reset}>Start over</button>
		<button type="submit" class="primary" disabled={$status === 'loading'}>
			{$status === 'loading' ? 'Building…' : 'Build the timeline'}
		</button>
	</div>

	<p class="hint">
		Enter as much or as little as you know. A year alone is fine, and so is a country alone.
		One birth or death is required so the span has an anchor, and there can only be one of each.
	</p>

	{#if $status === 'error' && $errorMessage}
		<p class="error" role="alert">{$errorMessage}</p>
	{/if}
</form>

<style>
	.form {
		margin: 0 0 2rem;
	}

	.actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.9rem;
		flex-wrap: wrap;
	}

	.spacer {
		flex: 1;
	}

	button {
		border-radius: 6px;
		padding: 0.5rem 0.9rem;
	}

	.ghost {
		border: 1px solid var(--line);
		background: #fff;
		color: var(--ink-soft);
	}

	.primary {
		border: 1px solid var(--accent);
		background: var(--accent);
		color: #fff;
	}

	.primary:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	.hint {
		margin: 0.9rem 0 0;
		font-size: 0.8rem;
		color: var(--ink-soft);
		max-width: 46rem;
	}

	.error {
		margin: 0.8rem 0 0;
		padding: 0.6rem 0.75rem;
		border-radius: 6px;
		background: #fbe9e7;
		color: #7f2a17;
		font-size: 0.85rem;
	}
</style>
