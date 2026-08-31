<script lang="ts">
	import { onMount } from 'svelte';
	import { motion } from '@pixel-blaster/motion';

	/**
	 * THE IN-GAME MOTION CONTROL, and it exists because the OS setting is often
	 * not the child's to change - a managed school tablet is the ordinary case.
	 * `prefers-reduced-motion` is still the default; this outranks it in both
	 * directions. See `packages/motion` for why "both directions" matters.
	 *
	 * The preference is stored per origin, so this and the catalog's toggle are
	 * the same switch seen from two pages.
	 */
	interface Props {
		/**
		 * When set, the control renders as a labelled pill rather than an icon-only
		 * square. The boot screen has room for words and is where a child who needs
		 * this should be able to find it WITHOUT playing a wave first; the HUD has
		 * room for a 40px button next to the mute one and no more.
		 */
		label?: string;
	}
	let { label }: Props = $props();

	let reduced = $state(motion.reduced);

	// Live, so an OS-level change mid-run lands without a reload. Subscribing here
	// rather than at the top level pairs the unsubscribe with this component.
	onMount(() => motion.subscribe((next) => (reduced = next)));
</script>

<!--
  `aria-pressed` with a FIXED name, rather than a name that flips with the state.
  A control called "Reduce motion" that is pressed is unambiguous; one whose name
  changes to "Allow motion" makes a screen reader user guess whether they are
  hearing the current state or the thing about to happen.

  The `aria-label` is dropped when there is visible text, so the accessible name
  comes from the words on screen and the two cannot drift apart.
-->
<button
	class="motion"
	class:labelled={label !== undefined}
	class:on={reduced}
	type="button"
	aria-label={label === undefined ? 'Reduce motion' : undefined}
	aria-pressed={reduced}
	onclick={() => motion.toggle()}
>
	<span class="glyph" aria-hidden="true">{reduced ? '⏸' : '✨'}</span>
	{#if label}<span class="text">{label}</span>{/if}
</button>

<style>
	/* Deliberately the mute button's shape and weight - it is the same kind of
     control, sitting next to it, and a second visual language for "a setting"
     would just be noise. */
	.motion {
		width: 40px;
		height: 40px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 3px solid var(--edge);
		border-radius: 8px;
		background: var(--surface-alt);
		color: var(--text);
		font-size: 16px;
		cursor: pointer;
	}

	.motion.labelled {
		width: auto;
		height: auto;
		padding: 9px 14px;
		font-family: 'Press Start 2P', monospace;
		font-size: 10px;
		line-height: 1.4;
	}

	/* A real colour change, because a 16px glyph is not a state indicator. */
	.motion.on {
		color: var(--bg);
		background: var(--accent-cyan);
		border-color: var(--edge-strong);
	}

	.motion:focus-visible {
		outline: 3px solid var(--accent-warm);
		outline-offset: 2px;
	}

	.labelled .glyph {
		font-size: 13px;
	}
</style>
