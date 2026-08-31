<script lang="ts">
	import Game from './lib/Game.svelte';
</script>

<!--
  This file used to be an arcade cabinet: a red body, a backlit marquee with
  fourteen bulbs, a CRT bezel with a scanline overlay and a vignette, speaker
  vents and an "Insert Knowledge to Continue" coin-op label. All of it was
  decoration wrapped around the game, and all of it is gone.

  What is left is a container. The pixel art stays pixel art - the bitmap font
  and nearest-neighbour canvas scaling are untouched; it is the fake glass and
  the furniture around it that have been removed.
-->
<div class="stage">
	<Game />
</div>

<style>
	.stage {
		width: 100%;
		max-width: 720px;
		margin: 0 auto;
	}
</style>
