<script lang="ts">
	import EventRow from '$lib/components/EventRow.svelte';
	import { MAX_EVENTS } from '$lib/config';
	import { addEvent, errorMessage, events, removeEvent, reset, status, submit } from '$lib/session';
</script>

<form
	class="form no-print"
	on:submit|preventDefault={submit}
>
	{#each $events as event (event.id)}
		<EventRow {event} canRemove={$events.length > 1} on:remove={(e) => removeEvent(e.detail)} />
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
		One birth or death is required so the span has an anchor.
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
