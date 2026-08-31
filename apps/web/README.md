# The catalog

The standalone landing page: a grid of what there is to play. Plain Vite + Svelte 5,
no runtime dependencies, no auth, no network.

```
npm run dev              # this page on :5173, with the games proxied behind it
npm run dev -w apps/web  # this page alone
```

`apps/web/src/games.ts` is the single source of truth for what this page says about each
game. Adding a game is one entry there — the href is derived from its `id`, so there is no
second place to keep in step.

**This page is a preview surface, not a destination.** `/learner/games` is the platform's
own catalog and it is the one a child actually reaches; this one is live on the standalone
domain and unreachable once the games are proxied. `ROADMAP.md` says so under "Why the
route shape is `/learner/games/<slug>/` from day one" — worth reading before building much
more here.

**Run this workspace alone and the Play link goes nowhere.** It is an absolute path, so
it needs the game on the same origin: `npm run dev` at the repo root starts the game's
server too and proxies the path prefix through to it (see `vite.config.ts`), and in
production `scripts/build-site.mjs` (PR 12) assembles both into one `dist/`. With only
this server running there is no 404 to notice — the path hits this dev server's SPA
fallback and it re-serves this page.
