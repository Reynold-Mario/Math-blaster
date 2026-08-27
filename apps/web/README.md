# The catalog

The standalone landing page: a grid of what there is to play. Plain Vite + Svelte 5,
no runtime dependencies, no auth, no network.

```
npm run dev -w apps/web
```

`apps/web/src/games.ts` is the single source of truth for what this page says about each
game. Adding a game is one entry there — the href is derived from its `id`, so there is no
second place to keep in step.

**This page is a preview surface, not a destination.** `/learner/games` is the platform's
own catalog and it is the one a child actually reaches; this one is live on the standalone
domain and unreachable once the games are proxied. `ROADMAP.md` says so under "Why the
route shape is `/learner/games/<slug>/` from day one" — worth reading before building much
more here.

Under `npm run dev` the Play link 404s. That is expected: this dev server serves only this
workspace, and the two are assembled into one `dist/` by `scripts/build-site.mjs` (PR 12).
