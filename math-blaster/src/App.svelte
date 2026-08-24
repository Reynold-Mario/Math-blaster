<script lang="ts">
  import Game from './lib/Game.svelte';
</script>

<div class="cabinet">
  <div class="marquee">
    <div class="bulbs">
      {#each Array(14) as _}
        <span class="bulb"></span>
      {/each}
    </div>
    <span class="marquee-text">🕹️ PIXEL MATH BLASTER</span>
  </div>

  <div class="screen">
    <div class="screen-content">
      <Game />
    </div>
    <div class="scanlines"></div>
    <div class="vignette"></div>
  </div>

  <div class="deck">
    <div class="vents"></div>
    <p class="deck-label">Insert Knowledge to Continue</p>
    <div class="vents"></div>
  </div>
</div>

<style>
  .cabinet {
    width: 100%;
    max-width: 760px;
    margin: 12px auto;
    padding: 14px 14px 18px;
    background: linear-gradient(160deg, #b91c1c, #7f1d1d 70%);
    border-radius: 26px 26px 16px 16px;
    border: 3px solid #450a0a;
    box-shadow: 0 14px 0 rgba(0, 0, 0, 0.25), 0 18px 30px rgba(0, 0, 0, 0.35);
  }

  .marquee {
    position: relative;
    background: linear-gradient(180deg, #fde047, #f59e0b);
    border: 3px solid var(--ink);
    border-radius: 14px;
    padding: 10px 12px 8px;
    margin-bottom: 12px;
    text-align: center;
    overflow: hidden;
  }
  .bulbs {
    display: flex;
    justify-content: space-between;
    padding: 0 2px 6px;
  }
  .bulb {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #fff7d6;
    box-shadow: 0 0 4px 1px rgba(255, 247, 214, 0.9);
  }
  .marquee-text {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(11px, 3.4vw, 16px);
    color: var(--ink);
    letter-spacing: 1px;
  }

  .screen {
    position: relative;
    padding: 14px 12px;
    background: #0f172a;
    border: 4px solid var(--ink);
    border-radius: 16px;
    overflow: hidden;
  }
  .screen-content {
    position: relative;
    z-index: 1;
  }
  .scanlines {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    background: repeating-linear-gradient(
      to bottom,
      rgba(0, 0, 0, 0.12) 0px,
      rgba(0, 0, 0, 0.12) 1px,
      transparent 2px,
      transparent 3px
    );
    mix-blend-mode: multiply;
  }
  .vignette {
    position: absolute;
    inset: 0;
    z-index: 2;
    pointer-events: none;
    box-shadow: inset 0 0 70px rgba(0, 0, 0, 0.45);
    border-radius: 16px;
  }

  .deck {
    margin-top: 14px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .vents {
    flex: 1;
    height: 10px;
    border-radius: 5px;
    background: repeating-linear-gradient(
      90deg,
      rgba(0, 0, 0, 0.35) 0px,
      rgba(0, 0, 0, 0.35) 4px,
      transparent 4px,
      transparent 10px
    );
    background-color: rgba(0, 0, 0, 0.15);
  }
  .deck-label {
    margin: 0;
    font-family: 'Press Start 2P', monospace;
    font-size: 9px;
    color: #fde68a;
    white-space: nowrap;
  }
</style>
