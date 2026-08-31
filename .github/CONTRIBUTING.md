# Contributing to Pixel Blaster

Thanks for your interest in contributing! This repository is an npm-workspace monorepo.
The game lives in `games/math-blaster/` and the catalog page in `apps/web/`; every command
below runs from the repo root.

## Getting started

```
git clone https://github.com/Reynold-Mario/Math-blaster.git
cd Math-blaster
npm ci
```

## Development

- `npm run dev` — start every dev server: the catalog on :5173, each game behind it.
  Open <http://localhost:5173/> and click through; the catalog proxies the games
- `npm run dev -w apps/web` / `npm run dev -w games/math-blaster` — one server alone
- `npm run build` — production build of every workspace
- `npm run preview -w games/math-blaster` — preview a production build locally

`-w <workspace>` targets one package; without it the root scripts fan out across all of
them with `--workspaces --if-present`.

## Before opening a pull request

All PRs into `main` are gated by CI. Please run all four from the repo root first:

```
npm run lint    # prettier --check + eslint — formatting is enforced, not suggested
npm run build   # vite build — type-checking is not bundling, so this catches what check cannot
npm run check   # svelte-check + tsc — must pass with 0 errors/warnings
npm test        # jest unit tests
```

All four must pass locally and in CI before a PR can be merged.

## Code style

Formatting is Prettier's, and it is not a matter of taste: `npm run lint` fails on any file
`prettier --check` would rewrite. `npm run format` fixes the whole repo in place — run it,
or format on save, rather than hand-matching the surrounding code.

`eslint.config.js` and `prettier.config.js` live at the repo root and cover every
workspace. Both mirror `the-student-experience`, which this repo treats as a **read-only
reference** for tooling; `todo.md` 2.1 records what was taken from it, what was skipped,
and why. If you want to change a rule, change it there and say which way the reference
goes.

Suppressions are config-level and commented, not inline. Where a rule is genuinely wrong
for a file, it is switched off for that file in `eslint.config.js` with the reason written
down — see the `svelte/prefer-svelte-reactivity` block. That way the exemption is
reviewable in one place instead of scattered through the source.

## Branching & PR workflow

- Branch off `main` (e.g. `feat/short-description`, `fix/short-description`).
- Keep PRs small and focused on a single change.
- Open a PR against `main`. The "Build, Check & Test" CI check must pass before merge.
- Reference related issues in the PR description where applicable.

## Architecture & project conventions

See [`games/math-blaster/CLAUDE.md`](../games/math-blaster/CLAUDE.md) for architecture
notes and AI-agent guidance, and [`games/math-blaster/README.md`](../games/math-blaster/README.md)
for a gameplay/feature overview.

For where the repository is headed — a multi-game monorepo with a landing page and
per-profile progression — see [`ROADMAP.md`](../ROADMAP.md). It carries the ordered list
of changes and a set of platform-level invariants worth reading before you restructure
anything.
