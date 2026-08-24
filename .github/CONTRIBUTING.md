# Contributing to Math Blaster

Thanks for your interest in contributing! This project lives entirely inside the
`math-blaster/` subfolder of this repository.

## Getting started

```
git clone https://github.com/Reynold-Mario/Math-blaster.git
cd Math-blaster/math-blaster
npm install
```

## Development

- `npm run dev` — start the Vite dev server
- `npm run build` — production build
- `npm run preview` — preview a production build locally

## Before opening a pull request

All PRs into `main` are gated by CI, which runs two checks. Please run both locally first:

```
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

See [`math-blaster/CLAUDE.md`](../math-blaster/CLAUDE.md) for architecture notes and
AI-agent guidance, and [`math-blaster/README.md`](../math-blaster/README.md) for a
gameplay/feature overview.
