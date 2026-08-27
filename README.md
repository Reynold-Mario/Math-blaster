# Pixel Blaster

A multi-game arcade, served from one site. Today it holds one game.

The game lives in [`games/math-blaster/`](./games/math-blaster) — see
[its README](./games/math-blaster/README.md) for gameplay/feature details and
[its CLAUDE.md](./games/math-blaster/CLAUDE.md) for architecture notes.

## Layout

```
games/math-blaster/   the game
supabase/             migrations and seed — platform-level, not a workspace
```

npm workspaces, so every command runs from this directory:

```
npm ci
npm run dev      # the game's dev server
npm run check    # svelte-check + tsc across every workspace
npm test         # jest across every workspace
npm run build    # production build of every workspace
```

Where this is going — more games, a catalog page, and per-profile progression — is in
[`ROADMAP.md`](./ROADMAP.md), along with the ordered list of changes to get there.

What has to be true before this runs in production is in [`todo.md`](./todo.md).

Contributing? See [`.github/CONTRIBUTING.md`](./.github/CONTRIBUTING.md).
