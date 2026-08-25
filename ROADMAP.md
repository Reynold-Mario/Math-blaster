# Platform Roadmap

How this repository becomes a multi-game arcade, and the order to build it in.

This document is **self-contained**: it carries the decisions, the sequence, and the
reasoning. If you are picking this up cold — human or agent — you should be able to
execute the whole ladder from this file alone.

Scope note: this is the **platform** doc. [`games/math-blaster/CLAUDE.md`](./math-blaster/CLAUDE.md)
remains the authority on the game itself, and the two must not start restating each
other.

---

## Why

Today the repository holds one game, `math-blaster`, and nothing else. It needs to hold
several — served from one site, behind a catalog page, with each player's progress
tracked against their profile and shared sensibly between games.

Four things follow from that: a workspace layout that scales past one game, a landing
page, a hosting story (Netlify for the static site, Supabase for progression), and a
progression layer that survives the arrival of real authentication without a rewrite.

## Decisions

| Question | Answer |
|---|---|
| Repo layout | Monorepo, npm workspaces |
| Serving | One Netlify site, path routing |
| Eventual home | A path on the Varsity Tutors domain (`varsitytutors.com/games/<game>`) |
| VT relationship | Exploratory — **no identity-provider access yet** |
| Player surface | Standalone site (not iframe-embedded) |
| Who reads progress | The student only, for now |
| Backend scope now | Local-first SDK + SQL migrations; **no Supabase client code yet** |
| Mastery join key | Internal topic id, with an optional CCSS `standard_code` alongside |

### Why the route shape is `/games/<slug>/` from day one

The intended long-term home is a **path** on the VT domain, but there is no VT identity
access today and the site has to ship standalone first. So the URL shape is chosen once,
now, and never changes:

```
/games/                  the catalog
/games/math-blaster/     a game
/games/<next>/           the next game
```

On the standalone domain, `/` redirects to `/games/`. When `/games/*` is later proxied
to this Netlify site, **every already-published URL still resolves** — no rebuild, no
base-path change, no broken asset fetches. Building each game at
`base: '/games/<slug>/'` from the start is what buys that, and it costs nothing today.

### Why progression boot stays synchronous

Progression is **local-cache-first and synchronous at boot**. `GamePhase` gains no
`'loading'` state, and `Game.svelte`'s `let profile = $state(...)` keeps its shape.

Two reasons. The local cache is always present, so there is nothing to wait for — no
spinner, no `💰 0 banked` flash before the real number arrives, and offline play keeps
working. And `gameFlow.ts` **mutates `profile` directly** during `tick()`, so a remote
copy landing mid-run would race `awardCurrency()`. Remote state is queued and applied
only at a safe phase (`boot`, `skillTree`, `runSetup`, `gameover`).

### Rejected options, and why

Recorded so they are not re-proposed:

- **SvelteKit for the landing page** — there are zero routes to justify a router, and it
  brings an adapter, a generated directory, a different tsconfig lineage, and a much
  larger dependency tree into a repo whose stated identity is zero runtime dependencies.
  Auth does not require it; Supabase sessions are client-side and work fine on a static SPA.
- **Netlify's monorepo mode (one site per package)** — it gives each package its own
  domain, and separate origins mean separate storage, cookies, and session. That destroys
  the entire reason single-origin path routing was chosen.
- **One Vite app with multi-page input** — works, but pins every game to one Svelte
  version and one plugin set, lets one game's build break the landing page's deploy, and
  makes the workspace boundary decorative.
- **SAML SSO via Supabase** — Supabase routes SSO by *email domain*, so a student on
  `@gmail.com` cannot be routed to VT's IdP. Viable only for a future district channel.
- **Anonymous Supabase sessions for the prototype** — every browser mints a billable MAU,
  and it creates a profile-merge problem the prototype would otherwise never have.
- **Server-authoritative currency and skill purchases** — would mean reimplementing
  `baseSkillTree.ts`'s cost/prerequisite/installment logic in PL/pgSQL and keeping two
  copies in sync, for a single-player game where cheating harms nobody. See
  [Currency is client-authoritative](#currency-is-client-authoritative-on-purpose).
- **Extracting an engine / renderer / skill-tree package** — one consumer, no evidence
  about the right boundaries. See the second-consumer rule under [Invariants](#invariants).

## Target layout

```
pixel-blaster/                  repo root == Netlify base directory
├── .nvmrc                      "22"
├── package.json                workspace root
├── package-lock.json           consolidated
├── netlify.toml                (PR 6)
├── CLAUDE.md                   (PR 6) thin, platform-level only
├── ROADMAP.md                  this file
├── scripts/build-site.mjs      (PR 6) zero-dependency assembly
├── supabase/migrations/        (PR 8) SQL only, unused by any client
├── dist/                       gitignored — the Netlify publish directory
├── games/
│   └── math-blaster/           today's math-blaster/, unchanged
├── apps/
│   └── web/                    (PR 5) landing shell
└── packages/
    └── theme/                  (PR 4) tokens.css only
```

Root `package.json`:

```json
{
  "name": "pixel-blaster", "private": true, "version": "0.0.0", "type": "module",
  "workspaces": ["apps/*", "games/*", "packages/*"],
  "scripts": {
    "dev": "npm run dev --workspace apps/web",
    "check": "npm run check --workspaces --if-present",
    "test": "npm run test --workspaces --if-present",
    "build": "node scripts/build-site.mjs"
  },
  "engines": { "node": ">=22" }
}
```

`--workspaces` excludes the root, so a root script calling the same script name in each
workspace does not recurse. `.nvmrc` at the root serves both `actions/setup-node` and
Netlify's own version detection. The lockfile consolidates at the root; npm hoists, so
`jest` / `vite` / `svelte-check` / `tsc` still resolve from inside `games/math-blaster`.

---

## The PR ladder

One branch, one PR, one change. Each must be independently green in CI.

### - [ ] PR 0 — Write down the platform roadmap

**This PR.** Creates `ROADMAP.md` and cross-links it from `README.md` and
`.github/CONTRIBUTING.md`. Docs-only, so it lands first and every PR after it arrives
with context rather than as an unexplained rename.

*Verify:* every relative link resolves on GitHub; the ladder below matches the plan.

### - [ ] PR 1 — Move the game into an npm workspace

The first restructure PR. **Zero source changes, zero behaviour changes** — `npm run check`
and `npm test` produce identical output.

- `git mv math-blaster games/math-blaster`
- `git mv games/math-blaster/.nvmrc .nvmrc`, and the same for `.vscode/`
- `git rm games/math-blaster/package-lock.json`; add the root `package.json` above;
  `npm install` to regenerate a root lockfile *(large and generated — say so in the PR
  body so review focuses on the small file)*
- merge the two `.gitignore`s into the root one. `dist` with no leading slash matches at
  any depth, covering root, `apps/*`, and `games/*` in one line; add `.netlify`
- `.github/workflows/ci.yml`: delete the `defaults:` block entirely, repoint
  `node-version-file` and `cache-dependency-path` at the root, and switch to
  `npm run check --workspaces --if-present` / `npm run test --workspaces --if-present`
- fix the paths in `README.md`, `.github/CONTRIBUTING.md` (its "lives entirely inside the
  `math-blaster/` subfolder" claim becomes false), `.github/pull_request_template.md`, and
  the game's own `CLAUDE.md` and `README.md`

No tsconfig or jest edits are needed: every tsconfig path is relative to its own file,
and `jest.config.cjs` uses `<rootDir>`, which defaults to the config file's directory.

> **Do not rename the `math-blaster` package.** `--workspace games/math-blaster` addresses
> it by path regardless, so renaming is pure churn.
>
> **Do not touch `name: Build, Check & Test` in the workflow** — see
> [Invariants](#invariants).

*Verify:* `npm ci` at the root, then `npm run check --workspaces` and
`npm run test --workspaces`. 18 test files, 0 errors, 0 warnings.

### - [ ] PR 2 — Run the production build in CI

Adds a root `build` script and one CI step, placed **last** so a bundling failure never
masks a type or test failure.

Deliberately separate from PR 1: `npm run build` has never run in CI, so it may fail on
first contact. Isolated, that is a three-line fix; bundled, it blocks the restructure.

*Verify:* CI green, with the build step visibly executing.

### - [ ] PR 3 — Serve the game under `/games/math-blaster/`

```ts
// games/math-blaster/vite.config.ts
base: '/games/math-blaster/',
```

`import.meta.env.BASE_URL` is a build-time literal substitution, so `spriteAtlas.ts`'s
`ASSET_BASE` becomes `/games/math-blaster/sprites/` on its own, and Vite copies `public/`
to the root of `outDir`. **No application code changes.**

Standalone because this is the highest-risk change to the game and its failure mode is
*silent*: when a sprite fails to decode, `spriteAtlas` falls back to drawing a plain
silhouette rather than raising anything. A broken base path looks like a subtle art bug.

*Verify:* `npm run build -w games/math-blaster && npm run preview -w games/math-blaster`,
then open `/games/math-blaster/`.
- Network: nine `*.apng`, the favicon, and the hashed JS all return 200. Zero 404s.
- Console: **no `[sprites]` output at all**. This is the check that matters.
- Visually: enemies are pixel art, not grey rectangles.

`/` returning 404 under preview is expected until PR 6. Note in the game's README that
the dev URL is now `localhost:5173/games/math-blaster/` — this will confuse someone.

### - [ ] PR 4 — Extract the colour palette into `packages/theme`

Ships one file, `tokens.css` (the font `@import` plus the `:root` block), consumed via
`@import '@pixel-blaster/theme/tokens.css'`. Visually identical.

This is the only package with no resolution hazards: jest never sees it (the sole CSS
import is in `main.ts`, which no test imports), and `svelte-check` already has
`vite/client` in `types`.

Move only the tokens. Leave `body`, `#app`, and the element rules in the game's
`app.css` — `body { display: flex }` is game layout and would fight the catalog grid.

*Verify:* `npm run check --workspaces`; the game looks unchanged.

### - [ ] PR 5 — Add the landing page

`apps/web`, plain Vite + Svelte 5, matching the game's scaffolding. The catalog lives in
`apps/web/src/games.ts` as the single source of truth for each game's id, title, blurb,
href, thumbnail, and status. Static content only — no progress data, no auth.

No `packages/game-registry` yet: it would have exactly one consumer, and the build script
deliberately discovers games by globbing `games/*` instead.

*Verify:* `npm run dev -w apps/web`; cards render and link correctly.

### - [ ] PR 6 — Assemble and deploy the site to Netlify

`scripts/build-site.mjs` builds `apps/web` into a **fresh root `dist/`**, then builds each
`games/*` into `dist/games/<id>/`.

> Assemble into a root `dist/`, **not** into `apps/web/dist/`. Vite's `emptyOutDir` wipes
> that directory on every build, so nesting the games inside it would make correctness
> depend on build order.

After each game builds, the script asserts that every absolute `src`/`href` in its
`index.html` starts with `/games/<id>/`, and throws with the fix in the message. This
turns the most likely deploy failure into a build-time error.

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

Cache headers: `/assets/*` is Vite-hashed and can be `immutable`. **`/games/*/sprites/*`
must not be** — those keep their authored filenames and `npm run sprites` rewrites them
in place, so immutable caching would ship stale art forever.

No `_redirects` and no SPA fallback: neither app has a client router, and Netlify
normalizes a missing trailing slash on its own.

Also lands a thin root `CLAUDE.md` covering platform-level rules only.

*Verify:* `npm run build` at the root, serve `dist/`, and walk `/` → `/games/` →
`/games/math-blaster/`, playing a wave. Confirm `/games/math-blaster` without the trailing
slash redirects rather than 404s. Break the `base` in a scratch commit and confirm the
assembly script throws.

### - [ ] PR 7 — Read and write progression through an injected store

Introduces `ProgressionStore` / `ProgressionCodec` / `ProgressionHandle`, defined **inside
the game** so jest needs no configuration change, with a localStorage implementation only.

```ts
export interface ProgressionCodec<S> {
  gameSlug: string; stateVersion: number;
  empty(): S;
  parse(raw: unknown): S;        // MUST NOT THROW — today's validator, verbatim
  merge(a: S, b: S, hint: MergeHint): S;
  furthest(state: S): number;    // the monotone "how far have they got" scalar
}
export interface ProgressionHandle<S> {
  readonly current: S;           // SYNCHRONOUS at construction — this is the boot path
  put(next: S): void;            // sync local write + debounced remote write
  onRemote(fn: (merged: S) => void): () => void;
}
```

1. Split validation from storage. `PlayerProfile.ts` keeps the type, `isGrade()`,
   `createEmptyProfile()`, and a new **pure** `normalizeProfile(raw: unknown)` holding the
   entire existing coercion body. The store owns the key, the `typeof window` guard, JSON,
   and both try/catches.
2. **The storage key stays `pixelMathBlaster.profile.v1`.** The payload shape is
   unchanged, so per the game's own versioning rule the suffix must not move. Existing
   players keep their currency and skills.
3. Add `earnedTotal` / `spentTotal` beside `currency`, seeded from an old profile as
   `earnedTotal = currency, spentTotal = 0` — *incomplete, not wrong*, so still `v1`.
4. **Debounce the writes.** `Game.svelte` currently saves on every `currency-earned`
   event — once per kill, 50–150 writes per run. Free against localStorage, catastrophic
   against a network. Trailing ~2s debounce with a ~15s maximum wait, plus an immediate
   flush on game-over, skill purchase, skip purchase, grade change, and `pagehide`
   (**not** `beforeunload`: unreliable on iOS Safari and it blocks bfcache).
5. **Mutate the profile in place; never reassign it.** `installSkillTreeDebugTools(profile)`
   captures the object by reference, so `profile = loaded` would leave the dev tools
   silently holding a stale object. Use `Object.assign(profile, merged)`.
6. The merge lives in the **game**, not the store — a generic store cannot know which
   fields are monotone. `highestWaveReached` and `skillProgress` take `max`;
   `selectedGrade` is a preference, so newest wins. **`skillSubProgress` is the trap:**
   it resets to 0 the instant a level completes, so a naive `max` resurrects a paid-off
   installment as credit toward the next level. Follow the higher *level*, and tie-break
   on installments only when the levels agree.
7. Rewrite `PlayerProfile.test.ts` against `normalizeProfile`, preserving every assertion;
   the hand-stubbed localStorage moves to a new small store test. `testEnvironment` stays
   `node` — no jsdom.
8. `gradeSource.ts` needs **no code change**, only a doc-comment redirect. Once the store
   is injected, "the grade comes from the platform" is implemented inside the store, and
   `resolveGrade()` keeps validating against `GRADE_ORDER` exactly as it already demands.

*Verify:* `npm test` green. An existing `pixelMathBlaster.profile.v1` still loads with its
currency and skills intact. In DevTools → Application → Local Storage, the write count
during a wave drops from per-kill to a handful. `window.pixelMathBlaster.addCurrency(1000)`
still works — that one catches the stale-reference bug in item 5.

### - [ ] PR 8 — Add the mastery seam and the SQL migrations

**The item that gets expensive to retrofit, so it happens early.** There is currently no
way to say which topic a given answer exercised: `ProblemDefinition` carries no
attribution, `Curriculum` is `{operations, numberRange}` with no id, and `gradeTree.ts`
names CCSS codes **in comments only**. This makes them data.

All additive, respecting every existing layer boundary:

1. `Curriculum` gains `id: string` and `standardCode?: string`.
2. `generateProblem()` copies both onto `ProblemDefinition`. **`EnemyInstance` grows no
   field** — the renderer must stay a pure function of `(runtime, theme, nowMs)`.
3. `topicId` / `standardCode` are added to the existing `hit-*` variants in `events.ts`.
   Adding a *field* to an existing variant does not trigger the "update `GameCanvas` and
   `audio.ts`" convention — only a new variant does.
4. A `MasteryRecorder` subscribes to `gameEvents`, tallies per-run, and hands the deltas
   to the store on game-over. **No changes to `RuntimeState` or `gameFlow`** — this matches
   the codebase's existing pattern: `gameFlow` emits, subscribers interpret independently.

Locally the deltas go nowhere. The same PR lands `supabase/migrations/`, unused by any
client, so the schema decisions get made while they are still cheap to change.

*Verify:* unit-test the merge functions directly, especially `skillSubProgress` across a
level boundary. `npx supabase db reset` applies the migrations cleanly.

### Deferred

- [ ] **PR 9** — extract `packages/progression`. Needs a `moduleNameMapper` in the game's
  jest config: `tsconfig.jest.json` uses node10 module resolution, which ignores the
  `exports` field, and jest's default `transformIgnorePatterns` excludes `/node_modules/`,
  which is where the workspace symlink lives.
- [ ] **PR 10** — `SupabaseProgressionStore` and real auth.
- [ ] **PR 11** — per-game progress summaries on the catalog cards.
- [ ] **PR 12** — `packages/game-registry`, once a consumer outside `apps/web` exists.

---

## Data model

Migrations land in PR 8 and go unused until PR 10.

**The invariant that makes auth swappable: `profiles.id` is our own UUID, the auth subject
is a mutable pointer at it, and nothing has a foreign key to `auth.users`.** With
third-party JWTs there is no `auth.users` row to reference at all. Hold this, and adding
real auth later is one insert into `profile_identities` per user — never a data migration.

| Table | Shape |
|---|---|
| `profiles` | our UUID primary key, `grade_level`, `grade_source ('self' \| 'platform')` |
| `profile_identities` | `subject` → `profile_id`. **RLS enabled, zero policies — deny-all.** Only `SECURITY DEFINER` functions touch it. |
| `games` | `slug`, `name`, `enabled` only. Rich metadata stays in the code manifest; a DB-backed one turns copy edits into migrations. |
| `game_progress` | `(profile_id, game_slug)`, `state jsonb`, `revision`, plus a promoted `furthest int` |
| `skill_mastery` | `(profile_id, topic_id)`, nullable `standard_code`, attempts/correct. **Not keyed by game** — that is the entire point. |
| `game_sessions` | one row per run, unique on `(profile_id, idempotency_key)` |
| `currency_balances` | `earned` and `spent` as two **monotone** counters; balance is generated |
| `leaderboard_entries` | `(game_slug, board_key, profile_id)`, upserted with `greatest()` |
| `guardianships` | ships empty; costs nothing and saves rewriting every read policy later |

**A JSONB blob per game, not typed tables.** The existing profile is already a validated
blob with a documented versioning rule; the boot read is a single primary-key lookup,
where typed tables would make the hottest path a wide join; and game #2 needs no DDL at
all. JSONB's weakness is querying *inside* documents, and nothing does that. The
escalation trigger is a **query**, not a size: promote a field to a generated column, then
to a real column, and only give it its own table when two independent writers touch it.

**The load-bearing trick** is a `before update` trigger doing
`new.furthest := greatest(old.furthest, new.furthest)`. The database independently
enforces the invariant that matters most — `highestWaveReached` gates where a run may
start — so a client merge bug degrades to "lost some currency", never "lost a record".

**Two functions, then every policy is trivial:** `current_profile_id()` and
`can_read_profile(target)`. Routing *every* read through the latter, even the ones that
only check self-ownership, turns "add tutor or parent access" from an eight-table policy
rewrite into a four-line function edit.

Two rules that are easy to get wrong:
- `revoke all ... from anon, authenticated` first. The publishable key ships in the JS
  bundle, so RLS and grants are the only things protecting this data.
- Always write `(select can_read_profile(...))`, not a bare call. The subquery form lets
  Postgres hoist it into an InitPlan and evaluate it **once per query instead of once per
  row** — the difference between a 1ms query and a 400ms one.

`submit_run()` is a `SECURITY DEFINER` RPC and the **sole writer** of mastery and
leaderboard rows; clients get read-only policies on both. It is idempotent on
`(profile_id, idempotency_key)`, so replay from an offline queue is exact.

### Currency is client-authoritative, on purpose

It already is — `devTools.ts` ships a console command to grant yourself currency, and the
game's own docs treat that as fine. It is single-player, there is no leaderboard, and no
money is involved. Making purchases server-authoritative would mean reimplementing
`baseSkillTree.ts`'s cost, prerequisite, and installment logic in PL/pgSQL and keeping two
copies in sync forever.

CHECK constraints (`spent <= earned`, `correct <= attempts`) and the monotone trigger do
the cheap 80% — they stop bugs and casual tampering with no duplicated game logic.

**Revisit when** a leaderboard ships, money is involved, or mastery is shown to a parent
or tutor. The last is the serious one: a falsified score is trivia, but a falsified
mastery signal is worse than no data, because a person may act on it.

### Auth, when it comes

The primary option is **Supabase Third-Party Auth** against VT's JWKS, conditional on VT
being able to mint a `role: "authenticated"` claim. If they cannot, that option is dead.

The fallback — and the one worth actually building — is a **token-exchange Edge
Function**. The ask on VT is minimal ("sign a 60-second blob containing the user id"), it
can be stubbed with a local signer in development, it yields real Supabase refresh tokens
so long sessions survive, and it lets us put `profile_id` directly into `app_metadata`,
which makes RLS identity resolution free rather than a per-query lookup.

---

## Invariants

Platform-level rules that did not exist before this work. Most are one-line mistakes with
expensive, quiet consequences.

1. **A game's id is one string in four places** — the directory under `games/`, the vite
   `base`, the catalog `href`, and the `game_slug` in the database. `scripts/build-site.mjs`
   asserts two of them agree; keep the other two in step by hand.
2. **Namespace every game's localStorage keys with its id.** All games now share one
   origin, so an unprefixed key is a collision waiting to happen.
   `pixelMathBlaster.profile.v1` already complies.
3. **A module moves to `packages/` when it has a second real consumer**, not when it looks
   reusable. With one consumer, every boundary is a guess, and extraction also costs a
   jest `moduleNameMapper` entry and a new class of "works in `vite build`, fails in
   `npm test`" bug.
4. **Never `base: './'`.** A relative base makes `import.meta.env.BASE_URL` resolve against
   the current document URL, which breaks the moment a path gains a segment.
5. **Never `force = true` on a fallback redirect.** A forced fallback returns HTML for
   `*.apng`, the APNG parser throws on it, and every sprite silently becomes a grey
   silhouette. Netlify already skips redirects when a static file exists, so `force` is
   never the fix.
6. **`import.meta.env` must not be reachable from any `.test.ts`.** `tsconfig.jest.json`
   sets `"module": "commonjs"`, so `import.meta` is a compile error. This is the same class
   of trap as the existing rule that assets are fetched by URL and never imported.
7. **Nothing has a foreign key to `auth.users`.** See the data model above.
8. **Do not rename the CI job.** `Build, Check & Test` is a required status check on
   `main`. Renaming it, splitting it into a matrix, or adding a `paths:` filter all break
   merges — a required check that reports as *skipped* blocks a merge just as firmly as
   one that fails.
9. **Update this file in the same PR that changes what it describes.** A roadmap is exactly
   the kind of document that drifts, and correcting doc drift has already cost this repo
   one dedicated PR.

## Open questions for Varsity Tutors

None of these block PRs 0–8. Three change the architecture rather than just configuration:

1. **Can the platform mint a JWT with a custom `role: "authenticated"` claim?** This gates
   third-party auth entirely. If not, the token-exchange path is the only option.
2. **Does it expose the student's grade level?** This is precisely what `resolveGrade()`
   was built to consume.
3. **Are these users minors?** A K–3 game says yes, so COPPA/FERPA likely apply — which
   decides whether we may store names or emails at all, and means any future leaderboard
   needs an arcade handle rather than a real name. **Until this is answered, store no
   personally identifying information.**

Lower stakes, but needed before PR 10: the stable user id type, access-token lifetime and
whether the browser can refresh silently, whether tutor and parent roles exist, and who
operates the Supabase project long-term.
