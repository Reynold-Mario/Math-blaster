# Contributing to Pixel Blaster

Thanks for your interest in contributing! This repository is an npm-workspace monorepo.
The game lives in `games/math-blaster/`; every command below runs from the repo root.

## Getting started

```
git clone https://github.com/Reynold-Mario/Math-blaster.git
cd Math-blaster
npm ci
```

## Development

- `npm run dev` — start the game's Vite dev server
- `npm run build` — production build of every workspace
- `npm run preview -w games/math-blaster` — preview a production build locally

`-w <workspace>` targets one package; without it the root scripts fan out across all of
them with `--workspaces --if-present`.

## Before opening a pull request

All PRs into `main` are gated by CI, which runs three checks. Please run all three from
the repo root first:

```
npm run build   # vite build — type-checking is not bundling, so this catches what check cannot
npm run check   # svelte-check + tsc — must pass with 0 errors/warnings
npm test        # jest unit tests
```

Both must pass locally and in CI before a PR can be merged.

## Code style

This project does not currently use a linter or formatter (no ESLint/Prettier configured).
Please match the existing style/formatting of the surrounding code. If you'd like to
introduce a linter/formatter, open an issue or PR to discuss it first rather than
including it alongside an unrelated change.

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
