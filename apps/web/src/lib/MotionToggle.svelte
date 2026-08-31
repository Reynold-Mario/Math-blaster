<script lang="ts">
	import { onMount } from 'svelte';
	import { motion } from '@pixel-blaster/motion';

	/**
	 * THE CONTROL FOR A CHILD WHOSE DEVICE SETTING IS NOT THEIRS TO CHANGE.
	 *
	 * It sits on the catalog rather than only inside a game because this is the
	 * first screen with anything moving on it - the card heroes are looping
	 * APNGs - so "turn it down before you have to look at it" has to be possible
	 * here. The preference is stored per origin, so pressing it here is also what
	 * the game reads on the next page; see `packages/motion`.
	 */
	let reduced = $state(motion.reduced);

	// Live, so an OS-level change while the page is open is picked up too.
	// Subscribing in onMount rather than at the top level is what pairs the
	// unsubscribe with this component's own lifetime.
	onMount(() => motion.subscribe((next) => (reduced = next)));
</script>

<!--
  `aria-pressed` rather than a label that changes with the state: the accessible
  name stays "Reduce motion" and the state is announced separately, so a screen
  reader user is never told the name of a control they have not got.
-->
<button
	class="motion"
	class:on={reduced}
	type="button"
	aria-pressed={reduced}
	onclick={() => motion.toggle()}
>
	<span class="glyph" aria-hidden="true">{reduced ? '⏸' : '✨'}</span>
	Reduce motion
</button>

<style>
	.motion {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 12px;
		font-family: 'Press Start 2P', monospace;
		font-size: 9px;
		line-height: 1.4;
		color: var(--text-dim);
		background: var(--surface-alt);
		border: 2px solid var(--edge);
		border-radius: 10px;
		cursor: pointer;
	}

	/* The pressed state is a real colour change and not just the glyph, because
     a 12px glyph is not a state indicator. */
	.motion.on {
		color: var(--bg);
		background: var(--accent-cyan);
		border-color: var(--edge-strong);
	}

	.motion:focus-visible {
		outline: 3px solid var(--accent-cyan);
		outline-offset: 2px;
	}

	.glyph {
		font-family: 'Baloo 2', sans-serif;
		font-size: 12px;
	}
</style>
