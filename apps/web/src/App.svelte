<script lang="ts">
  import GameCard from './lib/GameCard.svelte'
  import { GAMES } from './games'
</script>

<main class="page">
  <header class="masthead">
    <!-- Two block spans rather than a `<br>`. A `<br>` gives the same two lines
         visually but concatenates the accessible name to "PIXELBLASTER", which a
         screen reader reads as one invented word. -->
    <h1 class="wordmark"><span>Pixel</span> <span>Blaster</span></h1>
    <p class="tagline">
      Arcade games with the maths built into the mechanics, rather than bolted on as quiz
      screens between the fun bits.
    </p>
  </header>

  <ul class="grid">
    {#each GAMES as game (game.id)}
      <GameCard {game} />
    {/each}
  </ul>

  <footer class="foot">
    <p>
      A standalone preview. On Varsity Tutors these are reached from the learner's own games
      catalog, and each one lives under <code>/learner/games/</code>.
    </p>
  </footer>
</main>

<style>
  /**
   * 720px matches `.stage` in the game's own `App.svelte`, and the reason is
   * not arithmetic: navigating from here into a game should not change the
   * page's measure. It happens to fall out well - two 260px minimum tracks
   * plus an 18px gap is 538, so two columns fit and three do not, which lands
   * four cards as a tidy 2x2 with no media queries anywhere.
   */
  .page {
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 40px 16px 56px;
  }

  .masthead {
    margin-bottom: 28px;
  }

  /* The same typeface treatment as the game's boot screen title. */
  .wordmark {
    font-family: 'Press Start 2P', monospace;
    font-size: clamp(20px, 6vw, 30px);
    line-height: 1.35;
    text-transform: uppercase;
    color: var(--text);
    text-shadow: 3px 3px 0 var(--accent-warm);
  }

  .wordmark span {
    display: block;
  }

  .tagline {
    max-width: 46ch;
    margin-top: 14px;
    font-size: 16px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .grid {
    display: grid;
    /* auto-FILL, not auto-fit. With four entries `auto-fit` collapses the empty
       tracks and stretches the cards into billboards on a wide viewport;
       `auto-fill` keeps the track size honest and lets the row end early. */
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 18px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .foot {
    margin-top: 32px;
    font-size: 14px;
    line-height: 1.5;
    color: var(--text-dim);
  }

  .foot code {
    font-family: 'Press Start 2P', monospace;
    font-size: 10px;
    color: var(--text);
  }
</style>
