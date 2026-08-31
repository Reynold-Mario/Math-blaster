# Pixel Blaster

A multi-game arcade, served from one site. Today it holds one game and a page that
lists it.

The game lives in [`games/math-blaster/`](./games/math-blaster) — see
[its README](./games/math-blaster/README.md) for gameplay/feature details and
[its CLAUDE.md](./games/math-blaster/CLAUDE.md) for architecture notes.

## Layout

```
apps/web/             the catalog page — what there is to play
games/math-blaster/   the game
supabase/             migrations and seed — platform-level, not a workspace
```

Adding a game to the catalog is one entry in
[`apps/web/src/games.ts`](./apps/web/src/games.ts); its href is derived from its id.

npm workspaces, so every command runs from this directory:

```
npm ci
npm run dev      # the catalog on :5173, every game behind it
npm run check    # svelte-check + tsc across every workspace
npm test         # jest across every workspace
npm run build    # production build of every workspace
```

**Open <http://localhost:5173/> and click a card.** `npm run dev` starts one dev server
per playable surface — the catalog on 5173, math-blaster on 5174 — and the catalog proxies
`/learner/games/<slug>/` through to the game's server, so the Play links work as URLs
rather than as a second thing to launch. Ctrl-C stops all of them.

That indirection is the point rather than a convenience: the catalog's Play links are
absolute paths, because in production one origin serves both surfaces. Reaching the game
through the catalog's port reproduces that — one origin, so `localStorage` progression
behaves the way it will in production instead of splitting into a per-port slot. Going
straight to `:5174` is a different origin and a different save.

To run one workspace alone — `npm run dev -w apps/web` for the catalog, `npm run dev -w
games/math-blaster` for the game — note that a catalog without its games serves a Play
link that lands on the SPA fallback and quietly re-serves the catalog itself: same URL,
no error.

A new playable game adds a `dev:<slug>` script to the root `package.json`; `npm run dev`
runs everything matching `dev:*`, so there is no list of servers to keep in step.

Where this is going — more games, a catalog page, and per-profile progression — is in
[`ROADMAP.md`](./ROADMAP.md), along with the ordered list of changes to get there.

What has to be true before this runs in production is in [`todo.md`](./todo.md).

Contributing? See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md).
