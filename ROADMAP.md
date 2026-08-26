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

**The order has since changed, and the scope has grown.** Progression now goes first and
runs all the way through to a working Supabase prototype — including achievements and
highscores, neither of which existed in the original plan. The site track is held until
the Netlify deploy is approved. See
[Why the progression track goes first](#why-the-progression-track-goes-first).

## Decisions

| Question | Answer |
|---|---|
| Repo layout | Monorepo, npm workspaces |
| Serving | One Netlify site, path routing |
| Eventual home | A path on the Varsity Tutors domain (`varsitytutors.com/games/<game>`) |
| VT relationship | Exploratory — **no identity-provider access yet** |
| Player surface | Standalone site (not iframe-embedded) |
| Who reads progress | The student only, for now |
| Backend scope now | Local-first SDK, SQL migrations, **and a working Supabase prototype** |
| Deploy scope now | **Held.** Netlify waits for approval; nothing else waits on Netlify |
| Mastery join key | Internal topic id, with an optional CCSS `standard_code` alongside |
| Prototype identity | Real Supabase auth, dev-only test users. Anonymous sessions stay rejected |
| Achievement copy | Lives in code, like the game catalog. The DB stores unlocks only |
| Highscore shape | Personal best first, and **every board is grade-scoped** |

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

### Why the progression track goes first

The original ladder was site-first: workspace, CI build, base path, theme, landing page,
Netlify, and only then the progression store and the schema. That put **the item this
document itself calls "expensive to retrofit"** — attributing an answer to a topic, and
the schema that consumes it — behind six PRs of build plumbing, none of which it depends
on.

It genuinely does not depend on them. The store is defined inside the game, so jest needs
no configuration change; `supabase/` sits at the repo root under either layout; and the
workspace move is a `git mv` with zero source changes, so it stays a clean operation no
matter how much progression code exists when it happens. The dependency was an artifact of
writing the plan in the order the *site* made sense in.

So the tracks are now independent, and only one of them is actually waiting on anything:
Netlify needs approval, and Track C is mostly the work that makes that deploy correct.

### Why the prototype uses real auth

Anonymous Supabase sessions were rejected below, and stay rejected. The prototype instead
signs in dev-only email/password users.

The point is not the login screen — nobody will ever see it. The point is that
`current_profile_id()`, `can_read_profile()`, `profile_identities` and every RLS policy get
exercised in exactly the shape they will ship in. **The policies are the hard part and the
risky part**, and a prototype that reaches its data through a `SECURITY DEFINER` RPC
callable by `anon` proves the tables exist while proving nothing at all about whether the
data is protected. Two test users and a check that neither can see the other's rows is a
real test of the thing most likely to be wrong.

None of it leaks into production. The auth subject is a *pointer* at our own profile UUID,
so replacing a test user with a VT token-exchange subject is one row in
`profile_identities` and zero policy edits. That is the invariant the whole data model was
built around, and the prototype is the first thing that puts weight on it.

Test credentials never enter the repo: `.env.local`, gitignored. The publishable key is
the only Supabase value that may be committed.

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
  Superseded rather than reversed: see
  [Why the prototype uses real auth](#why-the-prototype-uses-real-auth).
- **A device-id RPC instead of auth for the prototype** — a localStorage UUID claiming a
  profile through a `SECURITY DEFINER` function callable by `anon` is the fastest route to
  a demo, and any caller can pass any device id. RLS separation would be decorative, so
  the prototype would validate everything except the part that carries the risk.
- **Achievement and leaderboard copy in Postgres** — same reasoning as the `games` table:
  it turns a wording fix into a migration and a deploy. See
  [Achievement definitions live in code](#achievement-definitions-live-in-code).
- **A single global highscore board** — incoherent in this game rather than merely unfair,
  because the difficulty of the maths is the player's grade and not the wave number. See
  [Highscores are per-grade](#highscores-are-per-grade-and-a-personal-best-comes-first).
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
├── netlify.toml                (PR 12)
├── CLAUDE.md                   (PR 12) thin, platform-level only
├── ROADMAP.md                  this file
├── scripts/build-site.mjs      (PR 12) zero-dependency assembly
├── .env.local                  (PR 5) gitignored — test credentials, never committed
├── supabase/
│   ├── migrations/             (PR 4) SQL only, unused by any client until PR 5
│   └── seed.sql                (PR 4) games + achievements rows; copy, not schema
├── dist/                       gitignored — the Netlify publish directory
├── games/
│   └── math-blaster/           today's math-blaster/, unchanged
├── apps/
│   └── web/                    (PR 11) landing shell
└── packages/
    └── theme/                  (PR 10) tokens.css only

`supabase/` sits at the repo root under either layout — it is platform-level, not a
workspace — which is why Track A can land it before the workspace move happens.
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

**Three tracks, and the order between them is the change this document last took.**
Track A is the work in flight. Track B turns it into a running prototype against a real
Supabase project. Track C is the site, and it is *held* — the Netlify deploy needs
approval, and most of Track C exists to make that deploy correct.

Nothing in A or B depends on C. The store is defined inside the game, `supabase/` sits at
the repo root under either layout, and the workspace move is a `git mv` with zero source
changes — so C can be taken whenever approval lands without disturbing work already done.

### - [x] PR 0 — Write down the platform roadmap

**Merged.** Created `ROADMAP.md` and cross-linked it from `README.md` and
`.github/CONTRIBUTING.md`. Docs-only, so it landed first and every PR after it arrives
with context rather than as an unexplained rename.

A second docs-only PR then re-ordered the ladder into the three tracks below and added
achievements and highscores to the data model. That it took a whole PR of its own is the
point of [invariant 9](#invariants): the plan changed, so the plan got rewritten before
any code moved.

---

## Track A — progression, local-first

No network code, no Supabase client, nothing that can fail at runtime because a server is
down. This track ends with a schema and a client that has everywhere to put its data
except a database.

### - [ ] PR 1 — Read and write progression through an injected store

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

### - [ ] PR 2 — Make the topic a first-class field

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

Locally the deltas go nowhere; PR 5 gives them a destination. Splitting this from the
migrations means the client change and the schema change are each reviewable on their own
terms — previously they were one PR, and the schema is the half that is hard to undo.

*Verify:* `npm test`. Drive a synthetic event stream through `MasteryRecorder` and assert
the tally. Confirm a run whose curriculum has no `standardCode` still records a `topicId`
— the CCSS code is optional and always will be.

### - [ ] PR 3 — Achievements and a personal best

Two new domains, both still entirely local, and both following the recorder pattern PR 2
establishes: subscribe to `gameEvents`, tally per-run, hand deltas to the store at
game-over. **`RuntimeState` and `gameFlow` gain nothing.**

1. `lib/progression/achievements.ts` holds the definitions — key, name, description, and
   a predicate over the run tally plus the profile, so "this run" and "ever" achievements
   run through one path. **The copy lives in code**, for the same reason the game catalog
   does; see [Achievement definitions live in code](#achievement-definitions-live-in-code).
2. **"Defeat a boss" means `by === 'mastery'`.** `boss-defeated` fires on both routes.
   Outlasting a boss is *escaping* it, and the game already refuses to pay for that — an
   achievement is a payment, so one that fires on the survival route quietly undoes the
   distinction the entire boss economy rests on.
3. Achievements are expressed in the game's own units — waves reached, bosses *defeated*,
   exact-answer streaks, topics practised, currency earned. **None may reference damage,
   health, or a kill count that includes leaked enemies**: the first two do not exist, and
   the third would reward standing still, which is exactly what the wave-clear payout is
   shaped to prevent.
4. `PlayerProfile` grows `achievements: Record<string, number>` (unlock timestamp, absent
   = locked) and `bestScore: number`. Additive with validated fallbacks, so **the storage
   key stays `pixelMathBlaster.profile.v1`** — an old profile is incomplete, not wrong.
5. `score` stays a per-run arcade number everywhere else. Only its *maximum* persists, and
   nothing reads `bestScore` back into a run — it is a record, not a resource.
6. **The game's own `CLAUDE.md` says "There is no leaderboard/high-score persistence", and
   that stops being true here.** Update it in the same PR, and keep the point it was
   making: `highestWaveReached` is still the number that means something in an endless run.
   `bestScore` sits beside it, it does not replace it.

*Verify:* `npm test`, with each achievement unlocked by a synthetic event stream. Pin the
mastery-versus-survival boss case explicitly — it is the one a future contributor will get
wrong. An existing `v1` profile loads with no achievements and `bestScore: 0`.

### - [ ] PR 4 — The SQL migrations

Ships `supabase/migrations/` — the schema described under [Data model](#data-model),
unused by any client until Track B. Landing it alone keeps schema review as schema review,
rather than a diff buried under client code.

Ordered so each migration applies independently: extensions and `profiles`; then
`profile_identities` with `current_profile_id()` and `can_read_profile()`; then the
per-game tables; then achievements and leaderboards; then RLS policies and grants, last.

- `revoke all ... from anon, authenticated` before anything is granted back.
- Every policy calls `(select can_read_profile(...))`, never a bare call — see the note
  under [Data model](#data-model) for why the subquery form is the difference between a
  1ms query and a 400ms one.
- The monotone triggers (`furthest`, `earned`/`spent`, first-unlock-wins on
  `profile_achievements`, `greatest()` on `leaderboard_entries`) land with their own
  tables rather than as a follow-up. They are the layer that survives a client merge bug.
- Every `SECURITY DEFINER` function sets an explicit `search_path`.
- Seed rows for `games` and `achievements` go in `supabase/seed.sql`, **not** a migration:
  they are data a copy edit will touch, and a copy edit must not be a schema change.

*Verify:* `npx supabase db reset` applies cleanly from empty, twice in a row. Then apply to
the project and confirm `get_advisors` returns no security findings — specifically no
table with RLS disabled, and no `SECURITY DEFINER` function with a mutable `search_path`.

---

## Track B — the Supabase prototype

The first network code in the repo. The goal is a prototype that exercises the *real*
policy surface, not one that reaches around it.

### - [ ] PR 5 — The Supabase client, dev auth, and `SupabaseProgressionStore`

Implements `ProgressionStore` against Supabase behind the interface PR 1 introduced. The
localStorage store stays, and stays the boot path.

1. **Local-first is not negotiable here.** `current` still resolves synchronously from the
   cache at construction. The remote read is a background fetch whose result is queued and
   applied only at a safe phase (`boot`, `skillTree`, `runSetup`, `gameover`) — never
   mid-`tick()`, where it would race `awardCurrency()`.
2. Dev-only email/password sign-in — see
   [Why the prototype uses real auth](#why-the-prototype-uses-real-auth). `ensure_profile()`
   (`SECURITY DEFINER`, called once after sign-in) creates the `profiles` row and its
   `profile_identities` mapping if absent and returns the profile id. It is the only thing
   that ever writes `profile_identities`.
3. `revision` is the concurrency check: an update carries the revision it read, a mismatch
   means someone else wrote, and the client re-merges through the *game's* merge rather
   than clobbering. The `furthest` trigger is the net under that, not a substitute for it.
4. An offline write queue, keyed by the same idempotency key `submit_run()` uses, so a
   replay after a dropped connection is exact rather than doubled.
5. **The publishable key is the only Supabase value that may be committed.** Test
   credentials live in a gitignored `.env.local`.
6. `gradeSource.ts`'s `resolveGrade()` finally has a platform answer to read
   (`profiles.grade_level`). Its body is all that changes — it keeps validating against
   `GRADE_ORDER` and falling back to a real grade, because a value arriving over the
   network is precisely the untrusted input that doc comment was written to anticipate.

*Verify:* play a run signed in, reload, and confirm currency, skills and furthest wave
survive. Play again with DevTools → Network → Offline and confirm the run is uninterrupted
and syncs on reconnect. Then sign in as a **second** test user and confirm the first
user's rows are invisible — that is the RLS check, and it is the reason this track exists.

### - [ ] PR 6 — `submit_run()`: mastery, achievements and highscores in one write

A `SECURITY DEFINER` RPC, idempotent on `(profile_id, idempotency_key)`, and the **sole
writer** of mastery, achievement and leaderboard rows. Clients hold read-only policies on
all three.

One call at game-over carries the whole run — the session row, the mastery deltas, the
newly unlocked achievement keys, and the score and wave for the boards — in one
transaction, so a partial run never lands.

- It does **not** re-derive achievements. It cannot: the rules live in the client. This is
  the same posture as client-authoritative currency and carries the same revisit trigger —
  see [Currency is client-authoritative](#currency-is-client-authoritative-on-purpose).
- It **does** enforce what the database can enforce cheaply and without duplicating game
  logic: `correct <= attempts`, `spent <= earned`, first-unlock-wins on achievements,
  `greatest()` on board entries, and the monotone `furthest`.

*Verify:* call it twice with the same idempotency key and confirm the second call is a
no-op rather than a doubling. Confirm a direct client `insert` into `skill_mastery` is
refused. Confirm a board entry submitted lower than the stored one does not lower it.

---

## Track C — the site (held pending approval)

Unchanged from the original ladder apart from its numbers and its position. **PR 12 is the
approval gate**; PRs 7–11 are the work that makes it correct, and may be taken early if
convenient — none of them touches progression.

### - [ ] PR 7 — Move the game into an npm workspace

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

### - [ ] PR 8 — Run the production build in CI

Adds a root `build` script and one CI step, placed **last** so a bundling failure never
masks a type or test failure.

Deliberately separate from PR 7: `npm run build` has never run in CI, so it may fail on
first contact. Isolated, that is a three-line fix; bundled, it blocks the restructure.

*Verify:* CI green, with the build step visibly executing.

### - [ ] PR 9 — Serve the game under `/games/math-blaster/`

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

`/` returning 404 under preview is expected until PR 12. Note in the game's README that
the dev URL is now `localhost:5173/games/math-blaster/` — this will confuse someone.

### - [ ] PR 10 — Extract the colour palette into `packages/theme`

Ships one file, `tokens.css` (the font `@import` plus the `:root` block), consumed via
`@import '@pixel-blaster/theme/tokens.css'`. Visually identical.

This is the only package with no resolution hazards: jest never sees it (the sole CSS
import is in `main.ts`, which no test imports), and `svelte-check` already has
`vite/client` in `types`.

Move only the tokens. Leave `body`, `#app`, and the element rules in the game's
`app.css` — `body { display: flex }` is game layout and would fight the catalog grid.

*Verify:* `npm run check --workspaces`; the game looks unchanged.

### - [ ] PR 11 — Add the landing page

`apps/web`, plain Vite + Svelte 5, matching the game's scaffolding. The catalog lives in
`apps/web/src/games.ts` as the single source of truth for each game's id, title, blurb,
href, thumbnail, and status. Static content only — no progress data, no auth.

No `packages/game-registry` yet: it would have exactly one consumer, and the build script
deliberately discovers games by globbing `games/*` instead.

*Verify:* `npm run dev -w apps/web`; cards render and link correctly.

### - [ ] PR 12 — Assemble and deploy the site to Netlify

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

### Deferred

- [ ] **PR 13** — extract `packages/progression`. Needs a `moduleNameMapper` in the game's
  jest config: `tsconfig.jest.json` uses node10 module resolution, which ignores the
  `exports` field, and jest's default `transformIgnorePatterns` excludes `/node_modules/`,
  which is where the workspace symlink lives.
- [ ] **PR 14** — real VT auth: third-party JWTs or the token-exchange Edge Function,
  replacing the dev sign-in from PR 5. Blocked on
  [open question 1](#open-questions-for-varsity-tutors), not on any code here.
- [ ] **PR 15** — a *public* leaderboard surface. Blocked on
  [open question 3](#open-questions-for-varsity-tutors); the schema and the writes ship in
  Track B, only the rendering of another player's row waits.
- [ ] **PR 16** — per-game progress summaries on the catalog cards.
- [ ] **PR 17** — `packages/game-registry`, once a consumer outside `apps/web` exists.

---

## Data model

Migrations land in PR 4 and go unused until PR 5.

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
| `achievements` | `key`, `game_slug`, `enabled` only. Copy lives in code, exactly as with `games`. |
| `profile_achievements` | `(profile_id, achievement_key)`, `unlocked_at`, `progress int`. **First unlock wins** — a trigger keeps the earliest timestamp. |
| `leaderboard_entries` | `(game_slug, board_key, profile_id)`, upserted with `greatest()`. `board_key` **carries the grade**. |
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

`submit_run()` is a `SECURITY DEFINER` RPC and the **sole writer** of mastery, achievement
and leaderboard rows; clients get read-only policies on all three. It is idempotent on
`(profile_id, idempotency_key)`, so replay from an offline queue is exact.

### Highscores are per-grade, and a personal best comes first

A single global board would be **incoherent in this game**, not merely unfair. Difficulty
of the maths is the player's grade and not the wave number — that separation is the point
of `curriculumLadderForGrade()`, and it means a grade-3 player and a kindergartener who
both reach wave 20 did not do the same thing. So `board_key` carries the grade
(`furthest_wave:g1`), and an unscoped board is a bug rather than a feature request.

Two boards, because the game already has two numbers and they mean different things.
`furthest_wave` is the one that means something in an endless run — it is what the
end-of-run screen reports and what gates where a future run may start. `score` is the
arcade number, and a board is somewhere for it to matter: a strong player's surplus
currently runs into the run clock's ceiling and stops there, and the game's own notes say
the fix is to give that surplus somewhere to go rather than to shrink it.

**The personal best lands first, in the profile blob.** It needs no table, no policy and
no second player, and for a single-player K–3 game it is most of the value — "beat your
own record" is the mechanic, and a public board is a feature on top of it.

**A public board also needs the minors question answered before it ships.** Until then the
schema exists and the prototype writes to it, but nothing renders another player's row.
When something does, the display name is an **arcade handle, generated rather than typed**:
free text from children is a moderation problem the prototype has no business acquiring,
and a real name is something this document has already committed to not storing.

### Achievement definitions live in code

Same reasoning as the `games` table, and worth restating because the pull toward a rich
`achievements` table is strong. Name, description, icon and unlock rule are all things a
copy edit or a balance tweak will touch, and putting them in Postgres turns each one into
a migration and a deploy. The database stores what only it can: that this profile unlocked
this key, once, at this time.

The `enabled` flag is the exception, and it earns its row — retiring an achievement that
turns out to be broken or unreachable should not require a client release.

**Achievements are recorded, not adjudicated.** `submit_run()` writes the keys the client
hands it, because the rules are in the client and the alternative is keeping two copies of
them in sync. Same trade as currency below, same revisit trigger.

### Currency is client-authoritative, on purpose

It already is — `devTools.ts` ships a console command to grant yourself currency, and the
game's own docs treat that as fine. It is single-player, there is no leaderboard, and no
money is involved. Making purchases server-authoritative would mean reimplementing
`baseSkillTree.ts`'s cost, prerequisite, and installment logic in PL/pgSQL and keeping two
copies in sync forever.

CHECK constraints (`spent <= earned`, `correct <= attempts`) and the monotone trigger do
the cheap 80% — they stop bugs and casual tampering with no duplicated game logic.

**Revisit when** a *public* leaderboard ships, money is involved, or mastery is shown to a
parent or tutor. The last is the serious one: a falsified score is trivia, but a falsified
mastery signal is worse than no data, because a person may act on it.

Achievements and the personal best join this trade rather than changing it. A personal
best a player can edit is between them and themselves; a public board is the trigger, and
it is deferred for an unrelated reason anyway.

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
10. **An achievement may never reward escaping a boss.** `boss-defeated` fires on both
    routes and carries `by`; only `'mastery'` is a defeat. The boss economy rests entirely
    on outlasting a fight paying nothing, and an achievement is a payment.
11. **No leaderboard is global across grades.** `board_key` carries the grade. See
    [Highscores](#highscores-are-per-grade-and-a-personal-best-comes-first).
12. **Only the publishable key is ever committed.** Service-role keys and test credentials
    live in a gitignored `.env.local`. RLS and grants are the only things protecting this
    data, and a leaked service-role key defeats all of them at once.
13. **Achievement and catalog copy lives in code, not in the database.** The DB stores
    unlocks, ids and an `enabled` flag — never a name, description or icon.
14. **Every `SECURITY DEFINER` function sets an explicit `search_path`.** Without it the
    caller controls resolution, which turns a helper into a privilege-escalation path.
    `get_advisors` flags this, which is why PR 4 verifies against it.

## Open questions for Varsity Tutors

None of these block Track A. **One of them now blocks part of Track B**, which is new:
question 3 gates any *public* leaderboard, and the boards were not in scope when this list
was written. Three change the architecture rather than just configuration:

1. **Can the platform mint a JWT with a custom `role: "authenticated"` claim?** This gates
   third-party auth entirely. If not, the token-exchange path is the only option.
2. **Does it expose the student's grade level?** This is precisely what `resolveGrade()`
   was built to consume.
3. **Are these users minors?** A K–3 game says yes, so COPPA/FERPA likely apply — which
   decides whether we may store names or emails at all, and means any future leaderboard
   needs an arcade handle rather than a real name. **Until this is answered, store no
   personally identifying information.**

Lower stakes, but needed before Track B reaches real users: the stable user id type,
access-token lifetime and whether the browser can refresh silently, whether tutor and
parent roles exist, and who operates the Supabase project long-term. The prototype answers
none of these and does not need to — it runs on dev test users precisely so that the
identity question can stay open while the schema and the policies get settled.
