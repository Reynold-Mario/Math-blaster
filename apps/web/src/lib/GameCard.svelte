<script lang="ts">
  import { gameHref, type CatalogGame } from '../games'
  import { SPRITE_ART, SPRITE_SCALE } from '../sprites'

  interface Props {
    game: CatalogGame
  }
  let { game }: Props = $props()

  const art = $derived(SPRITE_ART[game.sprite])

  /** Narrowed once here rather than inside the markup. `gameHref` takes a
   *  `PlayableGame`, so this is what turns "does this card link anywhere" into
   *  a single decision the type checker can follow. */
  const playable = $derived(game.status === 'playable' ? game : null)
</script>

<!--
  Card anatomy is lifted from the platform's own catalog
  (the-student-experience, `routes/learner/games/+page.svelte`): accent border,
  full-bleed art, title, grades badge, blurb, a Play pill, and an accent bar
  along the bottom. What is NOT lifted is its interaction model - see below.
-->
<li class="card" class:upcoming={!playable} style="--card-accent: {game.accent}">
  <span class="hero" aria-hidden="true">
    <!--
      An APNG animates natively in an `<img>` - every browser that matters has
      supported it for years, and one that does not renders the first frame as
      a still PNG rather than breaking. This is unrelated to the game's
      `render/apng.ts`, which exists only because a canvas needs decoded frames.

      Width and height are real attributes so the card cannot reflow when the
      art lands.
    -->
    <img
      class="hero-sprite"
      src={art.url}
      alt=""
      width={art.w * SPRITE_SCALE}
      height={art.h * SPRITE_SCALE}
    />
    <span class="hero-glyph">{playable ? '🚀' : '👾'}</span>
  </span>

  <div class="body">
    <div class="head">
      <h3 class="title">
        {#if playable}
          <a href={gameHref(playable)}>{game.name}</a>
        {:else}
          {game.name}
        {/if}
      </h3>
      <span class="grades">{game.grades}</span>
    </div>

    <p class="blurb">{game.description}</p>

    {#if playable}
      <span class="play" aria-hidden="true">▶ Play</span>
    {:else}
      <span class="play soon">🔒 Coming soon</span>
    {/if}
  </div>

  <span class="accent-bar" aria-hidden="true"></span>
</li>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--surface);
    border: 3px solid var(--card-accent);
    border-radius: 14px;
    /* The chunky offset shadow from the game's `.big-btn`. The point is that
       the catalog and the game look like one product. */
    box-shadow: 0 4px 0 rgba(0, 0, 0, 0.3);
    transition:
      transform 160ms ease,
      box-shadow 160ms ease;
  }

  .card:not(.upcoming):hover {
    transform: translateY(-4px);
    box-shadow: 0 8px 0 rgba(0, 0, 0, 0.35);
  }

  /* ---- the hero ---- */

  .hero {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 16 / 9;
    background: var(--tooltip);
    border-bottom: 3px solid var(--edge);
    overflow: hidden;
  }

  /* The card's accent as a glow behind the sprite, which is what stands in for
     the per-game artwork the platform's catalog has and this repo does not. */
  .hero::before {
    content: '';
    position: absolute;
    inset: -30%;
    background: radial-gradient(circle at 50% 65%, var(--card-accent), transparent 62%);
    opacity: 0.32;
  }

  .hero-sprite {
    position: relative;
    /* The `<img>` equivalent of the canvas renderer's
       `ctx.imageSmoothingEnabled = false`. Without it a 36x19 sprite drawn at
       5x is a blurry smear and the pixel-art premise dies. */
    image-rendering: pixelated;
    filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.45));
  }

  .hero-glyph {
    display: none;
    position: relative;
    font-size: 44px;
  }

  /* ---- the body ---- */

  .body {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px 16px;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .title {
    font-family: 'Press Start 2P', monospace;
    font-size: 11px;
    line-height: 1.5;
    text-transform: uppercase;
    color: var(--text);
  }

  .title a {
    color: inherit;
    text-decoration: none;
  }

  /* THE WHOLE CARD IS THE CLICK TARGET, BUT THE LINK IS ONLY THE TITLE.
     The platform's catalog uses a card-sized `<a>` carrying an
     `aria-label="Play <name>"`, which drops the `<h3>` out of the document
     outline and hides the blurb from the accessible name. This gets the same
     hit area with none of that: a short unique accessible name, a real heading,
     and no label to keep in step with visible copy. The trade is that text
     inside a card is not selectable, which is acceptable for a card. */
  .title a::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }

  .grades {
    flex-shrink: 0;
    padding: 4px 8px;
    font-family: 'Press Start 2P', monospace;
    font-size: 8px;
    color: var(--text-dim);
    background: var(--surface-alt);
    border: 2px solid var(--edge);
    border-radius: 8px;
  }

  .blurb {
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .play {
    align-self: flex-start;
    margin-top: auto;
    padding: 8px 12px;
    font-family: 'Press Start 2P', monospace;
    font-size: 9px;
    color: #fff;
    background: var(--card-accent);
    border: 2px solid var(--edge-strong);
    border-radius: 10px;
  }

  .play.soon {
    color: var(--text-dim);
    background: var(--surface-alt);
  }

  .accent-bar {
    height: 4px;
    background: var(--card-accent);
    /* Without this it eats clicks in the bottom 4px of the card, because the
       title's `::after` overlay sits below it in paint order. */
    pointer-events: none;
  }

  /* ---- focus ---- */

  .title a:focus-visible {
    outline: 3px solid var(--accent-cyan);
    outline-offset: 2px;
  }

  /* Move the ring to the card, so the indicator matches the actual click
     target. The rule above is the fallback where `:has()` is unavailable - it
     still outlines the title, just more tightly. `:focus-within` was the
     obvious alternative and is wrong: it fires on mouse click too, so every
     click would leave a ring behind. */
  .card:has(.title a:focus-visible) {
    outline: 3px solid var(--accent-cyan);
    outline-offset: 3px;
  }

  .card:has(.title a:focus-visible) .title a:focus-visible {
    outline: none;
  }

  /* ---- not built yet ---- */

  /* Dim the ART, never the whole card. A blanket `opacity` composites
     `--text-dim` down against a near-black page and pushes the blurb under the
     4.5:1 contrast floor - it reads as "dimmed" to a sighted user and as "fails
     AA" to a checker. The text stays at full strength; the greyed art and the
     locked pill are what carry the meaning. */
  .card.upcoming {
    border-color: var(--edge);
    box-shadow: none;
  }

  .card.upcoming .hero {
    filter: grayscale(0.75);
    opacity: 0.55;
  }

  .card.upcoming .accent-bar {
    opacity: 0.45;
  }

  /* ---- reduced motion ---- */

  /*
   * KEYED ON AN ATTRIBUTE, AND `@media (prefers-reduced-motion: reduce)` IS
   * GONE RATHER THAN KEPT ALONGSIDE IT.
   *
   * `packages/motion` resolves the OS setting and an explicit override into one
   * answer and mirrors it onto `<html>` before `mount()` runs. That buys the two
   * things the media query could not: a child on a managed school device, who
   * does not control the OS setting, can still turn this off; and a child whose
   * device forces `reduce` system-wide can turn it back on. It keeps the one
   * thing the media query was good for - the store listens to the query, so an
   * OS-level toggle still applies live with no reload.
   *
   * Running both would mean writing every rule below twice: once inside the
   * query guarded on `:not([data-motion='full'])`, once on
   * `[data-motion='reduce']`. That guard is exactly the kind of thing that gets
   * copied correctly three times and wrongly the fourth.
   */
  :global(html[data-motion='reduce']) .card {
    transition: none;
  }

  :global(html[data-motion='reduce']) .card:not(.upcoming):hover {
    transform: none;
  }

  /* AN APNG CANNOT BE PAUSED FROM CSS. There is no `animation-play-state` for
     an `<img>`, and every one of these sprites declares `num_plays: 0` in its
     `acTL` chunk, which means loop forever. The two options were authoring a
     static twin of each sprite - doubling the art pipeline for one setting - or
     not painting it. This does the second, and stands an emoji in its place,
     which is the icon vocabulary the game already uses throughout.

     The game does NOT have to make this trade: a canvas draws whichever frame
     it is told to, so `GameCanvas.svelte` freezes the same art instead of
     hiding it. */
  :global(html[data-motion='reduce']) .hero-sprite {
    display: none;
  }

  :global(html[data-motion='reduce']) .hero-glyph {
    display: block;
  }
</style>
