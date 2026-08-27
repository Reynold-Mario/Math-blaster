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
npm run dev      # the game's dev server
npm run dev -w apps/web    # the catalog page
npm run check    # svelte-check + tsc across every workspace
npm test         # jest across every workspace
npm run build    # production build of every workspace
```

The two dev servers are separate, and the catalog's Play links point at the games by
absolute path (`/learner/games/math-blaster/`) because in production one origin serves
both. So **to follow a Play link locally, run both** — the game on Vite's default 5173,
then the catalog, which proxies that path prefix through to it (see
[`apps/web/vite.config.ts`](./apps/web/vite.config.ts)):

```
npm run dev                 # terminal 1 — the game, on :5173
npm run dev -w apps/web     # terminal 2 — the catalog, on :5174
```

Then browse the catalog at `:5174` and click through. With only the catalog running, a
Play link lands on its SPA fallback and quietly re-serves the catalog itself — same URL,
no error. Reaching the game through `:5174` rather than `:5173` also puts both surfaces
on one origin, so `localStorage` progression behaves the way it will in production
instead of splitting into a per-port slot.

Where this is going — more games, a catalog page, and per-profile progression — is in
[`ROADMAP.md`](./ROADMAP.md), along with the ordered list of changes to get there.

What has to be true before this runs in production is in [`todo.md`](./todo.md).

Contributing? See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md).
