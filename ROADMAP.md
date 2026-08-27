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
runs all the way through to a working Supabase prototype — including achievements and a
personal best score, neither of which existed in the original plan. The site track is held until
the Netlify deploy is approved. See
[Why the progression track goes first](#why-the-progression-track-goes-first).

## Decisions

| Question | Answer |
|---|---|
| Repo layout | Monorepo, npm workspaces |
| Serving | One Netlify site, path routing |
| Eventual home | A path inside the student experience (`varsitytutors.com/learner/games/<game>`) |
| VT relationship | The student experience is a **read-only reference**; only this repo changes |
| Player surface | Standalone site (not iframe-embedded), launched by full navigation |
| Launch context | The VT games catalog at `/learner/games`, by an already-signed-in learner |
| Who reads progress | The student only, for now |
| Backend scope now | Local-first SDK, SQL migrations, **and a working Supabase prototype** |
| Deploy scope now | **Held.** Netlify waits for approval; nothing else waits on Netlify |
| Mastery join key | Internal topic id, with an optional CCSS `standard_code` alongside |
| Prototype identity | Real Supabase auth, dev-only test users. Anonymous sessions stay rejected |
| Real identity | The VT **learner** (per child, not per household), via [Track D](#track-d--vt-identity) |
| Achievement copy | Lives in code, like the game catalog. The DB stores unlocks only |
| Highscore shape | **A personal best, and nothing else.** No leaderboard, global or scoped |

### Why the route shape is `/learner/games/<slug>/` from day one

The intended long-term home is a **path** on the VT domain, and
[Track D](#track-d--vt-identity) turns out to *require* it — the platform's cookies are
`SameSite=Lax`, so identity only works same-origin. The site still has to ship standalone
first. So the URL shape is chosen once, now, and never changes:

```
/learner/games/math-blaster/     a game — this deploy, standalone and proxied alike
/learner/games/<next>/           the next game
/learner/games/                  the platform's catalog — theirs, not ours
/                                the standalone catalog — preview only
```

**Settled: the prefix is `/learner/games/`, inside the student experience's own subtree.**
It was briefly open. This repo had been assuming `/games/*`, and the platform turns out
not to use that at all — its existing games are subject-scoped (`/math-games/<slug>` for
nine of its 28 catalog entries, ten such prefixes in all), so the prefix being assumed was
never going to be granted. The student experience will be updated to serve this shape;
that work is theirs and comes later. What matters here is that `base` is settled *before*
PR 9 turns it into a build-time literal.

Two consequences, one of them a real loss:

- **Identity gets easier, not harder.** The game now sits beside the endpoints it reads:
  from this game's path, `/learner/api/auth/get-session` is a sibling on the same origin.
  `VITE_VT_IDENTITY_BASE` is already documented as `/learner`, and `vtIdentity.ts` already
  composes `${base}/api/...` and already sends `credentials: 'include'` — so Phase 1 needs
  **no change** to work under this decision.
- **Our own catalog page is shadowed.** `/learner/games` is the *platform's* catalog, and
  it is the one a child actually reaches. The standalone catalog in PR 11 is therefore a
  preview surface rather than a destination — live on the standalone domain, unreachable
  once proxied. Worth knowing before building much of it.

Only the *games* claim a fixed path. The standalone catalog stays at `/`: it is the one
surface with no proxied counterpart, so there is nothing for it to match. Building each
game at `base: '/learner/games/<slug>/'` from the start is what makes the proxy a no-op —
**every already-published game URL still resolves**, with no rebuild, no base-path change
and no broken asset fetches. A `/learner` prefix on a standalone site with no learner
concept is cosmetically odd and costs nothing. A *different* prefix per deploy target
would cost two artifacts, because `base` is a build-time literal and the built HTML
carries absolute asset paths.

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
- **A Supabase Edge Function for the token exchange** — it cannot work, rather than merely
  being worse. The credentials are `httpOnly` cookies first-party to `varsitytutors.com`,
  so nothing on `*.supabase.co` is ever sent them and the function would have nothing to
  verify. It has to be same-origin with the game. See
  [Auth, when it comes](#auth-when-it-comes).
- **Third-party auth against VT's own JWKS** — provably dead, not blocked: the student
  experience runs Better Auth with no `jwt` plugin, so there is no VT-issued token of any
  kind to validate.
- **Copying `BETTER_AUTH_SECRET` into this game's deploy** — it is the HS256 key that
  signs every session on `.varsitytutors.com`, so a copy here means anything that leaks
  here can forge a session for any user of the platform. The reference's own
  `.env.example` makes the argument, requiring a different secret per *environment* for
  exactly this blast-radius reason; a different *application* is a wider version of the
  same problem. And it would not even work: a valid signature proves a cookie was
  *issued*, not that its session still exists, so the game would need the auth Postgres
  URL as well. Forwarding the cookie to `get-session` needs neither.
  See [invariant 18](#invariants).
- **`auth.admin.generateLink` + `verifyOtp` to mint a real Supabase user** — works, and
  yields refresh tokens, but needs an `auth.users` row per child and therefore an email
  address, therefore a synthetic one that is a lie in a table someone will read. Worse
  structurally: `auth.uid()` becomes a Supabase uuid, so `profile_identities.subject`
  stops being the learner id and the one-line provider swap becomes a rewrite.
- **A shared-secret custom JWT handed to `setSession`** — no refresh path, so a 45-minute
  run outlives its token, and Supabase is moving off shared-secret verification.
- **An auth gate inside the game** — an anonymous player is the *ordinary* case, not an
  error: a standalone build, a signed-out player and an unreachable platform must all land
  on exactly the local game. A gate would turn the design's default state into a failure.
  (This bullet used to rest on the platform's own gate covering the game, which
  [it does not](#track-d--vt-identity) once this deploy serves the path — the conclusion
  survives the correction, the reason did not.)
- **Anonymous Supabase sessions for the prototype** — every browser mints a billable MAU,
  and it creates a profile-merge problem the prototype would otherwise never have.
  Superseded rather than reversed: see
  [Why the prototype uses real auth](#why-the-prototype-uses-real-auth).
- **A device-id RPC instead of auth for the prototype** — a localStorage UUID claiming a
  profile through a `SECURITY DEFINER` function callable by `anon` is the fastest route to
  a demo, and any caller can pass any device id. RLS separation would be decorative, so
  the prototype would validate everything except the part that carries the risk.
- **Achievement copy in Postgres** — same reasoning as the `games` table: it turns a
  wording fix into a migration and a deploy. See
  [Achievement definitions live in code](#achievement-definitions-live-in-code).
- **A leaderboard of any kind, global or grade-scoped** — the highscore is a *personal
  best*, and a table for it would have no second reader. A scoped board was drafted and
  cut; see [A personal best, and no leaderboard](#a-personal-best-and-no-leaderboard).
- **Achievements for boss outcomes** — the boss economy already pays for a defeat and
  already pays nothing for an escape. See
  [Bosses produce no achievements](#bosses-produce-no-achievements).
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
achievements and a personal best to the data model. That it took a whole PR of its own is the
point of [invariant 9](#invariants): the plan changed, so the plan got rewritten before
any code moved.

---

## Track A — progression, local-first

No network code, no Supabase client, nothing that can fail at runtime because a server is
down. This track ends with a schema and a client that has everywhere to put its data
except a database.

### - [x] PR 1 — Read and write progression through an injected store

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
  put(next: S): void;            // in-memory now; PERSISTING it is debounced
  flush(): void;                 // persist pending work now
  onRemote(fn: (merged: S) => void): () => void;
  dispose(): void;               // flush, and drop the pagehide listener
}
```

Two additions to the sketch above, both found while building it. `flush()` exists because
item 4 needs guaranteed writes at specific moments and `put()` cannot express that;
`dispose()` exists because the store registers its own `pagehide` listener, so something
has to remove it. `MergeHint` resolved to `'a-is-newer' | 'b-is-newer'` — the *only*
thing a merge cannot work out for itself, since monotone fields give the same answer
either way and preferences have no "greater" value to compare.

1. Split validation from storage. `PlayerProfile.ts` keeps the type, `isGrade()`,
   `createEmptyProfile()`, and a new **pure** `normalizeProfile(raw: unknown)` holding the
   entire existing coercion body. The store owns the key, the `typeof window` guard, JSON,
   and both try/catches.
2. **The storage key stays `pixelMathBlaster.profile.v1`.** The payload shape is
   unchanged, so per the game's own versioning rule the suffix must not move. Existing
   players keep their currency and skills.
3. Add `earnedTotal` / `spentTotal` beside `currency`, seeded from an old profile as
   `earnedTotal = currency, spentTotal = 0` — *incomplete, not wrong*, so still `v1`.
   **They are what makes a merge possible at all**, and every path that moves currency
   has to maintain them: `awardCurrency()`, both purchase paths, and `devTools`. `max` is
   meaningful on a total and meaningless on a balance, so a spend that skips its
   `spentTotal += n` reappears as free money the next time two copies of a profile meet.
4. **Debounce the writes.** `Game.svelte` currently saves on every `currency-earned`
   event — once per kill, 50–150 writes per run. Free against localStorage, catastrophic
   against a network. Trailing ~2s debounce with a ~15s maximum wait, plus an immediate
   flush on game-over, skill purchase, skip purchase, grade change, and `pagehide`
   (**not** `beforeunload`: unreliable on iOS Safari and it blocks bfcache).
   The maximum wait is not belt-and-braces: without it a run that never goes quiet for
   two seconds never writes at all, and that describes a *busy* run exactly.
5. **Mutate the profile in place; never reassign it.** `installSkillTreeDebugTools(profile)`
   captures the object by reference, so `profile = loaded` would leave the dev tools
   silently holding a stale object. Use `Object.assign(profile, merged)`.
6. The merge lives in the **game**, not the store — a generic store cannot know which
   fields are monotone. `highestWaveReached` and `skillProgress` take `max`;
   `selectedGrade` is a preference, so newest wins. **`skillSubProgress` is the trap:**
   it resets to 0 the instant a level completes, so a naive `max` resurrects a paid-off
   installment as credit toward the next level. Follow the higher *level*, and tie-break
   on installments only when the levels agree.
   Currency falls out of the same reasoning: the merge derives the balance from the two
   totals rather than merging it, because `max` of two *balances* refunds whatever the
   more frugal side had not spent yet. This under-counts concurrent earning on two
   devices — 100 here and 50 there merges to 100, not 150 — which is the deliberate
   direction to be wrong in.
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

*Shipped:* 119 files, 0 errors, 0 warnings; 380 tests passing, up from 336. The
returning-player path is covered end-to-end (real key, real codec, real store) rather
than only as units, and the `skillSubProgress` level-boundary trap has a test named after
what it would cost.

### - [x] PR 2 — Make the topic a first-class field

**The item that gets expensive to retrofit, so it happens early.** There is currently no
way to say which topic a given answer exercised: `ProblemDefinition` carries no
attribution, `Curriculum` is `{operations, numberRange}` with no id, and `gradeTree.ts`
names CCSS codes **in comments only**. This makes them data.

All additive, respecting every existing layer boundary:

1. `Curriculum` gains `id: string` and `standardCode?: string`. **`id` is required**, and
   matches the id of the `gradeTree` topic node that teaches it - mastery is recorded
   against that string, so a topic with two names splits one child's practice across two
   rows that never add up, and nothing throws to say so.
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

**`gradeTree.ts` restated three curricula that already existed in `gameLevels.ts`** —
byte-identical literals for K, `g2-add-sub-100` and `g2-mult-foundation`. Harmless while a
curriculum was anonymous; the moment it carries an id, two objects claim one topic and can
drift apart. Those three now read `k1.curriculum` / `g2a.curriculum` / `g2b.curriculum`
like the other four already did, so there is exactly one object per topic.

*Verify:* `npm test`. Drive a synthetic event stream through `MasteryRecorder` and assert
the tally. Confirm a run whose curriculum has no `standardCode` still records a `topicId`
— the CCSS code is optional and always will be.

*Shipped:* 401 tests, up from 380; 120 files, 0 errors, 0 warnings. Two things worth
knowing:
- **The answered problem must be captured before resolution.** Breaking a shield and
  clearing a non-final layer both mint a *fresh* problem on the same enemy, so reading
  `enemy.problem` at emit time attributes the answer to the problem that replaced it.
  Every multi-layer enemy would have been mis-filed, silently and plausibly.
- **Authored problems stay unattributed.** A boss finale is written by hand, not drawn
  from a curriculum, so `buildAuthoredProblem` sets no `topicId` and the recorder skips
  what it cannot attribute. Inventing a plausible topic would put a fiction into a record
  that a teacher may eventually read.

### - [ ] PR 3 — Achievements and a personal best

Two new domains, both still entirely local, and both following the recorder pattern PR 2
establishes: subscribe to `gameEvents`, tally per-run, hand deltas to the store at
game-over. **`RuntimeState` and `gameFlow` gain nothing.**

1. `lib/progression/achievements.ts` holds the definitions — key, name, description, and
   a predicate over the run tally plus the profile, so "this run" and "ever" achievements
   run through one path. **The copy lives in code**, for the same reason the game catalog
   does; see [Achievement definitions live in code](#achievement-definitions-live-in-code).
2. **No achievement fires on a boss outcome, either way.** See
   [Bosses produce no achievements](#bosses-produce-no-achievements). This is the rule a
   future contributor is most likely to break, because a boss looks like the obvious thing
   to hang an achievement on.
3. **What an achievement may be based on is deliberately still open**, and two things
   are already ruled out: **defeating a boss** (see
   [Bosses produce no achievements](#bosses-produce-no-achievements)) and **completing a
   topic**. Neither is available, and neither is to be reintroduced as "just an example"
   in a comment or a test fixture. The remaining space — waves reached, exact-answer
   streaks, shields broken, currency earned, something not yet thought of — stays
   undecided until it is discussed properly, because an achievement set is a statement
   about what the game wants a child to do and that is not a detail to settle in passing.
   Two constraints hold whatever is chosen: achievements are expressed in the game's own
   units, and **none may reference damage, health, or a kill count that includes leaked
   enemies** — the first two do not exist, and the third would reward standing still,
   which is exactly what the wave-clear payout is shaped to prevent.
4. `PlayerProfile` grows `achievements: Record<string, number>` (unlock timestamp, absent
   = locked) and `bestScore: number`. Additive with validated fallbacks, so **the storage
   key stays `pixelMathBlaster.profile.v1`** — an old profile is incomplete, not wrong.
5. `score` stays a per-run arcade number everywhere else. Only its *maximum* persists, and
   nothing reads `bestScore` back into a run — it is a record, not a resource.
6. **`bestScore` stays in the profile blob and is never promoted to a column.** By this
   document's own escalation rule, `furthest` earned its column because it *gates where a
   run may start* — losing it would let a player skip ground they had not covered. A
   personal best gates nothing, nothing queries across it, and losing it is cosmetic. It
   rides in `state` like everything else.
7. **The game's own `CLAUDE.md` says "There is no leaderboard/high-score persistence".
   Half of that stays true.** There is still no leaderboard. Update the line to say a
   personal best persists and nothing else does, and keep the point it was making:
   `highestWaveReached` is the number that means something in an endless run, and
   `bestScore` sits beside it rather than replacing it.

*Verify:* `npm test`, with each achievement unlocked by a synthetic event stream. Assert
that a run containing a boss defeat and a boss escape unlocks **nothing** — that is the
one a future contributor will get wrong. An existing `v1` profile loads with no
achievements and `bestScore: 0`.

### - [x] PR 4 — The SQL migrations

Ships `supabase/migrations/` — the schema described under [Data model](#data-model),
unused by any client until Track B. Landing it alone keeps schema review as schema review,
rather than a diff buried under client code.

Ordered so each migration applies independently: extensions and `profiles`; then
`profile_identities` with `current_profile_id()` and `can_read_profile()`; then the
per-game tables; then mastery; then achievements; then RLS policies and grants, last.

- `revoke all ... from anon, authenticated` before anything is granted back.
- Every policy calls `(select can_read_profile(...))`, never a bare call — see the note
  under [Data model](#data-model) for why the subquery form is the difference between a
  1ms query and a 400ms one.
- The monotone triggers (`furthest`, `earned`/`spent`, `attempts`/`correct`, and
  first-unlock-wins on `profile_achievements`) land with their own tables rather than as a
  follow-up. They are the layer that survives a client merge bug.
- Every `SECURITY DEFINER` function sets an explicit `search_path`.
- Seed rows for `games` and `achievements` go in `supabase/seed.sql`, **not** a migration:
  they are data a copy edit will touch, and a copy edit must not be a schema change.
- **There is no `leaderboard_entries`.** The highscore is a personal best living in
  `game_progress.state`; a table would have no second reader.

*Verify:* `npx supabase db reset` applies cleanly from empty, twice in a row. Then apply to
the project and confirm `get_advisors` returns no security findings — specifically no
table with RLS disabled, and no `SECURITY DEFINER` function with a mutable `search_path`.

---

## Track B — the Supabase prototype

The first network code in the repo. The goal is a prototype that exercises the *real*
policy surface, not one that reaches around it.

### - [x] PR 5 — The Supabase client, dev auth, and `SupabaseProgressionStore`

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

### - [x] PR 6 — `submit_run()`: a run lands in one idempotent write

A `SECURITY DEFINER` RPC, idempotent on `(profile_id, idempotency_key)`, and the **sole
writer** of session, mastery and achievement rows. Clients hold read-only policies on all
three.

One call at game-over carries the whole run — the session row, the mastery deltas, and the
newly unlocked achievement keys — in one transaction, so a partial run never lands. The
personal best is not in the list: it lives in `game_progress.state`, which the client
writes directly.

- It does **not** re-derive achievements. It cannot: the rules live in the client. This is
  the same posture as client-authoritative currency and carries the same revisit trigger —
  see [Currency is client-authoritative](#currency-is-client-authoritative-on-purpose).
- It **does** enforce what the database can enforce cheaply and without duplicating game
  logic: `correct <= attempts`, `spent <= earned`, first-unlock-wins on achievements, and
  the monotone `furthest`.

*Verify:* call it twice with the same idempotency key and confirm the second call is a
no-op rather than a doubling. Confirm a direct client `insert` into `skill_mastery` is
refused. Confirm re-submitting an already-unlocked achievement does not move its
`unlocked_at` forward.

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

### - [x] PR 8 — Run the production build in CI

Adds a root `build` script and one CI step, placed **last** so a bundling failure never
masks a type or test failure.

Deliberately separate from PR 7: `npm run build` has never run in CI, so it may fail on
first contact. Isolated, that is a three-line fix; bundled, it blocks the restructure.

*Verify:* CI green, with the build step visibly executing.

### - [ ] PR 9 — Serve the game under `/learner/games/math-blaster/`

```ts
// games/math-blaster/vite.config.ts
base: '/learner/games/math-blaster/',
```

`import.meta.env.BASE_URL` is a build-time literal substitution, so `spriteAtlas.ts`'s
`ASSET_BASE` becomes `/learner/games/math-blaster/sprites/` on its own, and Vite
copies `public/` to the root of `outDir`. **No application code changes.**

Standalone because this is the highest-risk change to the game and its failure mode is
*silent*: when a sprite fails to decode, `spriteAtlas` falls back to drawing a plain
silhouette rather than raising anything. A broken base path looks like a subtle art bug.

*Verify:* `npm run build -w games/math-blaster && npm run preview -w games/math-blaster`,
then open `/learner/games/math-blaster/`.
- Network: nine `*.apng`, the favicon, and the hashed JS all return 200. Zero 404s.
- Console: **no `[sprites]` output at all**. This is the check that matters.
- Visually: enemies are pixel art, not grey rectangles.

`/` returning 404 under preview is expected until PR 12. Note in the game's README that
the dev URL is now `localhost:5173/learner/games/math-blaster/` — this will confuse
someone.

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
`games/*` into `dist/learner/games/<id>/`.

> Assemble into a root `dist/`, **not** into `apps/web/dist/`. Vite's `emptyOutDir` wipes
> that directory on every build, so nesting the games inside it would make correctness
> depend on build order.

After each game builds, the script asserts that every absolute `src`/`href` in its
`index.html` starts with `/learner/games/<id>/`, and throws with the fix in the
message. This turns the most likely deploy failure into a build-time error.

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

Cache headers: `/assets/*` is Vite-hashed and can be `immutable`.
**`/learner/games/*/sprites/*` must not be** — those keep their authored filenames
and `npm run sprites` rewrites them in place, so immutable caching would ship stale art
forever.

No `_redirects` and no SPA fallback: neither app has a client router, and Netlify
normalizes a missing trailing slash on its own.

Also lands a thin root `CLAUDE.md` covering platform-level rules only.

*Verify:* `npm run build` at the root, serve `dist/`, and walk `/` →
`/learner/games/math-blaster/`, playing a wave. Confirm `/learner/games/math-blaster`
without the trailing slash redirects rather than 404s. Break the `base` in a scratch
commit and confirm the assembly script throws.

### Deferred

- [ ] **PR 13** — extract `packages/progression`. Needs a `moduleNameMapper` in the game's
  jest config: `tsconfig.jest.json` uses node10 module resolution, which ignores the
  `exports` field, and jest's default `transformIgnorePatterns` excludes `/node_modules/`,
  which is where the workspace symlink lives.
- [x] ~~**PR 14** — real VT auth.~~ **Superseded by [Track D](#track-d--vt-identity).**
  It was blocked on [open question 1](#open-questions-for-varsity-tutors); that question
  now has an answer, and the answer changes the shape rather than unblocking the old
  plan. The two options it framed as alternatives turn out to be one thing — see
  [Auth, when it comes](#auth-when-it-comes).
- [ ] **PR 15** — per-game progress summaries on the catalog cards.
- [ ] **PR 16** — `packages/game-registry`, once a consumer outside `apps/web` exists.

Not deferred, **declined**: a leaderboard. It is not waiting on a dependency — see
[A personal best, and no leaderboard](#a-personal-best-and-no-leaderboard).

---

## Track D — VT identity

The game is launched from the Varsity Tutors games catalog by a learner who is **already
signed in**: `/games` sits in that app's `PROTECTED_PAGE_PATH_PREFIXES`, so an
unauthenticated visitor is bounced to login before the catalog renders. **This game
therefore gates nothing.** What it needs is not a login screen but an answer to *who is
this, and what grade are they in*.

**That gate covers the catalog, not this game's URL** — worth being exact about, because
the route decision makes it easy to assume otherwise. Once this game's path is served by
this deploy, that app's `hooks.server.ts` never runs for it, so a signed-out visitor
typing the URL directly reaches the game rather than a login page. That is not a hole:
identity resolves to anonymous and they get exactly the local game, which is the ordinary
case. It is only a reason never to describe the platform's gate as the thing protecting
this game.

Everything in this track happens in **this** repo. The student experience is a read-only
reference; what it would need is written down under
[Upstream asks](#upstream-asks-the-student-experience) rather than implemented here.

### The constraint everything else follows from

Both credentials are cookies on `.varsitytutors.com`, and both are `httpOnly` **and**
`SameSite=Lax` — `vt_authentication_token` (a VT JWT) and
`__Secure-better-auth.session_token`. Two consequences, and the whole track is shaped by
them:

1. **Browser JS can read neither**, so the game can never hand a bearer token to anything.
2. **A cross-origin request carries neither**, whatever CORS says. `SameSite` is settled
   before CORS is consulted, so there is no header that rescues this.

So both phases need the game served from a **path on the VT host**, not from its own
origin — which is what Track C was already building toward (PR 9). Until that routing
exists this code ships **inert**: an anonymous answer is the ordinary case and produces
exactly the game that shipped before identity existed. That is a deployment dependency,
not a code one, which is why the code lands first.

**The catalog cannot express any other shape**, which makes this a type error rather than
a preference. `GameCatalogEntry.launchUrl` is typed to a root-relative path, and every
entry is composed as `new URL(launchUrl, VT_HOST)` — so an off-origin `.netlify.app` URL
neither type-checks nor survives composition. All 28 entries launch to a path on the VT
origin; none points anywhere else.

Note also what is *not* here: the student experience uses **Better Auth**, not Supabase
auth, and deleted its own Supabase auth bridge — every server read there is service-role
with explicit filters. **There is no browser `auth.uid()` to borrow.**

### What the reference says, verified

Measured against the checkout on 2026-08-27, so nobody re-derives it — and because two
claims this track already made (no `jwt` plugin, and `/games` being a protected prefix)
had been asserted rather than checked. The student experience is a read-only reference;
none of this is ours to change.

| Thing | Where | What it says |
|---|---|---|
| Better Auth | `lib/server/auth/index.ts` | Declared `^1.6.26`, installed **1.7.1** |
| Plugins | same | `vtProvider()`, `admin()`, `sveltekitCookies()` — **no `jwt` plugin** |
| Optional? | `lib/server/auth/impl.ts` | **No** — `getAuth()` is unconditional |
| Session read | `/learner/api/auth/get-session` | Better Auth's own endpoint, via `[...auth]` |
| Household read | `/learner/api/learners` | `{ learners: [...] }`; 401 signed out |
| Learner DTO | `lib/server/learners/list.ts` | `id`, `name`, `grade?`, `avatarId`, `isPrimary`, `createdAt?` |
| The gate | `auth/app-route-access.ts:51` | `/games` is in `PROTECTED_PAGE_PATH_PREFIXES` |
| The catalog | `lib/games/catalog.ts` | 28 entries, `launchUrl` root-relative |
| Active learner | `routes/learner/games/+page.server.ts` | `activeLearnerId` already in scope |
| Local sign-in | `/learner/api/auth/dev-login` | Non-prod; sets `vt_authentication_token` |

Five of those carry detail a table cannot hold:

- **The bridge is gone.** `@varsitytutors/auth-supabase-bridge` is absent from both
  `package.json` and `node_modules`, and `AUTH_IMPL` survives only in stale comments. So
  Better Auth is *the* session layer rather than one of two, and the note above about
  there being no browser `auth.uid()` to borrow is settled rather than provisional.
- **`PROTECTED_PAGE_PATH_PREFIXES` is matched after SvelteKit strips the `/learner`
  base**, which is why the entry reads `/games` — the gate claim at the top of this
  track holds as written.
- **PR 17 keeps three fields of the learner DTO and drops the rest.** `name` and
  `avatarId` never reach this repo's types ([invariant 15](#invariants)).
- **Upstream ask 1 is one line, not a feature** — the catalog page already holds the
  active learner id and already passes it to `recordRecentGameLaunch`.
- **Real local auth does not boot from the reference as checked out.**
  `BETTER_AUTH_SECRET` is populated in its gitignored `.env`, but both
  `AUTH_SUPABASE_DB_*` URLs are empty and `makeAuth()` throws on the second. Worth
  knowing before planning to test Phase 2 against a local student experience: the var
  to obtain is the pooled Postgres URL, **not** the signing key
  ([invariant 18](#invariants)).

### Phase 1 — identity and grade

Reads who is playing and what grade they are in. Depends on nothing being built anywhere
else, and touches no Supabase.

### - [ ] PR 17 — The identity port, and the one file that knows VT exists

`lib/identity/`: `LearnerIdentity.ts` is the PORT (types only — no `fetch`, no DOM, no
`import.meta.env`), `vtIdentity.ts` the sole implementation. Exactly the split
`RemoteProgression.ts` / `supabaseRemote.ts` already makes, and for the same reason:
everything downstream stays testable under `testEnvironment: node`.

Nothing imports it, so the bundle is byte-identical.

Three properties are pinned because all three fail quietly:

- **`resolve()` never throws**, the same total contract `ProgressionCodec.parse` holds.
- **It never returns a child's name.** The household payload carries them; `name` and
  `avatarId` are dropped where the response is parsed, and `LearnerIdentity` offers
  nowhere to put one. A test asserts the exact key set, so a later edit cannot smuggle
  one back.
- **An unvalidated `?learner=` is never believed.** It is user-editable and it decides
  whose permanent practice record a run lands in, so an unrecognised id falls back to the
  primary learner — and if the household could not be read *at all*, the whole resolve
  gives up. "Cannot validate" must never take the same branch as "validated".

`base` is typed as a same-origin **path**, never an origin, so the only configuration that
can work is the only one the type lets you write. A 200 that is not JSON counts as
`unavailable`: a standalone build with a base configured but no platform behind it answers
with its own `index.html` and a 200, which must not read as a signed-out player.

*Verify:* `npm run check && npm test`; the twelve cases cover both fallbacks, a stranger's
id, an unreadable household, 401, a signed-out 200, HTML-instead-of-JSON, an offline
reject, an empty household, an unknown grade, memoization, and the no-fetch backstop.
`npm run build` — main bundle unchanged.

### - [ ] PR 18 — `nearestAuthoredGrade()` in `gradeTree.ts`

The platform's vocabulary is wider than the game's: it emits `'K'|'1'..'12'|'college'|
'adult'`, and `GRADE_TOPICS` only reaches grade 3.

`curriculumLadderForGrade` falls back to **every authored curriculum** for an unauthored
grade. That is the right failure for a hand-picked grade (a run with no problems is far
worse than one at the wrong difficulty) and the **wrong** one for a platform assertion: a
grade-7 learner would be handed K-through-3 shuffled into a single ladder, starting on
Kindergarten addition. So clamp instead — above the ceiling means "the hardest thing we
teach", which is an honest statement of a *content* gap.

Lives in `gradeTree.ts` rather than in `identity/` because it is a question about the
curriculum, and `SkillTreeScreen.svelte` already computes the same
`topicsForGrade(g).length > 0` predicate for `PLAYABLE_GRADES`. **The ceiling is derived
from `GRADE_TOPICS`, never hardcoded**, so authoring grade 4 stays the pure data addition
`math-blaster/CLAUDE.md`'s known-gaps section promises it is.

Returns `null` for anything unrecognised — the platform has no usable opinion, and the
local pick stands.

*Verify:* `'K'→'K'`, `'7'→'3'`, `'college'→'3'`, `'kindergarten'→null`, plus a property
test that any non-null result is a grade with non-empty `topicsForGrade`, so authoring
grade 4 later cannot break it silently.

### - [ ] PR 19 — The platform grade reaches a run

`platformGradeStore.ts`, composed **outermost**:

```
localStorage  →  learnerScoped (PR 20)  →  supabase  →  platformGrade
```

It applies `codec.applyPlatformGrade` and emits through `onRemote`. `gradeSource.ts` is
**not touched** — its docstring already said the store would put the grade on the profile
and `resolveGrade()` would keep validating it, which is exactly what happens.

Two rules inside it:

- **The platform grade is applied last, always**, so it outranks both the local picker and
  a Supabase row whose `grade_source` is `'self'`. A late inner merge re-applies it rather
  than losing it.
- **It never calls `put()`.** A background write is the race `ProgressionStore` warns
  about. It emits; `Game.svelte`'s existing safe-phase `$effect` applies it and the next
  ordinary save persists it. If the child never triggers one, nothing is lost — the
  platform re-asserts on the next boot, which is correct for a value the platform owns.

Not an option on `createSupabaseProgressionStore`: that returns `inner` unchanged when
`remote === null`, which is **precisely the Phase-1 configuration**, so the grade would be
silently dropped in the only shipping config. And not routed through
`profiles.grade_source` either, which is dead in Phase 1 for want of a session.

`SkillTreeScreen.svelte` gains `gradeLocked` and hides the picker when a platform grade is
in force. Without it the child picks grade 1, plays, reloads, and it snaps back with no
explanation — the control would be lying.

`vtIdentityClient.ts` arrives here, mirroring `supabaseClient.ts` exactly: the **only**
file reading `VITE_VT_IDENTITY_BASE`, so no `.test.ts` can reach an `import.meta`
([invariant 6](#invariants)), and `Game.svelte` gets a synchronous
`isVtIdentityConfigured()` at construction the way it already gets
`isSupabaseConfigured()`.

*Verify:* with the var unset — **zero requests and byte-identical behaviour**, and the
whole `vtIdentity` fetch path folds out of the bundle (`isVtIdentityConfigured` collapses
to `return false`, so the `createVtIdentity` call is dead code). The wrapper itself is
always constructed and does ship: measured **+2.37 kB / +0.84 kB gzip** on the main bundle,
plus 0.25 kB of picker CSS. That is the ship default and the path that has to be boringly
safe. Then
grade `'2'` emits `selectedGrade: '2'`, `'7'` emits `'3'`, `null` emits *nothing at all*,
and `current` stays readable synchronously before any promise settles.

### - [ ] PR 20 — Storage is scoped to the learner

`pixelMathBlaster.profile.v1` and `pixelMathBlaster.pendingRuns.v1` are one slot per
**browser**. Two children on one tablet share currency, skills, and each other's queued
runs.

**The un-namespaced key never moves.** It becomes the permanent *anonymous slot*, and a
learner gets a **suffix** — so the documented key stays a literal prefix of the new one and
the `v1` rule keeps meaning what it meant.

```
pixelMathBlaster.profile.v1                 anonymous (unchanged, forever)
pixelMathBlaster.profile.v1.<learnerId>     per learner
pixelMathBlaster.claimedBy.v1               the ONE learner that adopted the anonymous save
```

**The claim marker is the point.** A copy alone would hand sibling B whatever sibling A
built before signing in. Instead the first learner to appear on a device with an anonymous
save claims it; a later, different learner finds the marker set and starts fresh. The
anonymous slot is never deleted, so a guest still has it. There is deliberately **no
merge** across that boundary — merging A into B is the same bug at a different moment.

`runQueue` rekeys against the **same** marker: one claim per device, not one per key.
Mis-attributing a queued run is worse than mis-attributing a profile, because
`submit_run()` writes it into a child's permanent mastery record.

Needs a store *factory* rather than a store — `localStorageStore.open()` binds its key
once — but both keys are already injectable (`keyFor`, `key`), so nothing inside either
store changes.

*Verify:* in one browser profile — play anonymously then identify as A (carries over);
reload as B (fresh, A's slot untouched); reload as A (A's profile back).

### Phase 2 — a real Supabase session

Replaces the dev sign-in. **Depends on the routing**, because the exchange is the only
thing that can see the cookies.

### - [x] PR 21 — The store re-syncs when identity changes

`supabaseStore` fired `syncFromRemote()` exactly once at `open()` and returned early when
`currentProfileId()` was `null`. Nothing subscribed to an auth change, which is why
`devTools` told you to reload. One option:

```ts
onIdentityChange?(listener: () => void): () => void;
```

**The plan had the listener deciding that an identity changed. It must not, and that is
the one thing this PR got wrong on paper.** Supabase's auth listener fires for
`TOKEN_REFRESHED` and `INITIAL_SESSION` as well as for a sign-in, so a store that adopted
whenever it was notified would reset a playing child to an empty profile on a routine
token refresh. So the store compares the profile id it *observes* against the one the
state in hand belongs to, and an event only ever means "look again". The subscription
helper deliberately does not filter either: a second idea of the current identity would
have to be kept in step with the store's.

Four properties, each silent when wrong:

- **AN IDENTITY CHANGE ADOPTS, IT NEVER MERGES.** `inner.current` still holds the
  *previous* identity's state - the cache is keyed by learner, not by session - so merging
  it is exactly how sibling A's currency lands on sibling B's account. An adopting sync
  starts from `codec.empty()` and discards the pending push.
- **An adopt takes the row's PREFERENCES too.** Left on `hintFor`, a `grade_source` of
  `'self'` would lose the row's own grade to `empty()`'s default: the hint says "the local
  pick wins", and on this path there is no local pick.
- **A superseded sync abandons itself.** An `epoch`, bumped by every request and
  re-checked after every `await`, so a read already in flight for the previous identity
  cannot emit one child's profile into another's session. `disposed` cannot express this -
  the handle is alive, it is the answer that went stale.
- **A push never crosses an identity boundary.** An identity can change between the
  `put()` that queued a payload and the debounced push that sends it, so `push()`
  re-checks and drops the payload rather than writing it to the wrong row. Nothing is
  lost: the cache already has it.

Sign-out deliberately changes nothing on screen - a signed-out player gets exactly the
local game, not an emptied one. Not forgetting the id is also what makes signing back in
as the same person a merge and as somebody else an adopt.

*Verify:* 10 tests in `supabaseStore.test.ts`, driven through the real cache. Each was
mutation-checked: disabling adopt, the adopt hint, the epoch, the push guard or the
empty-row emit fails at least one test. The `syncing` re-entrancy guard is the exception,
and says so in the code - every current caller bumps the epoch first, so nothing reaches
it and removing it leaves the suite green. It is kept for the caller that would not bump.
Bundle with no credentials: 133.37 -> 133.94 kB (+0.57 kB, +0.26 kB gzip) with `@supabase`
still absent from the output entirely, so [the fold](#invariants) holds. The dev console's
"RELOAD THE PAGE" wart is gone.

### - [ ] PR 22 — The session and JWKS functions

A **Netlify Function in the game's own deploy** at
`/learner/games/math-blaster/api/session`, because the cookies are first-party to
`varsitytutors.com` and only a same-origin endpoint ever receives them. **This is why
it cannot be a Supabase Edge Function** — nothing on `*.supabase.co` is ever sent them.

It forwards the request's own `Cookie` header server-side to
`GET {VT_ORIGIN}/learner/api/auth/get-session`, requires a real session, re-validates the
requested learner against `/learner/api/learners`, and then signs a short-lived ES256 JWT
with `sub` = the learner id and `role: "authenticated"`, publishing its public key at
`/learner/games/math-blaster/api/jwks.json`. **The learner id is re-validated
server-side even though the client already did it** — the client is the thing being
defended against.

Per-game rather than shared, because `/learner/games/*` above this game's slug is the
student experience's own subtree and not ours to claim. A second game either gets its own
function or the exchange moves to a shared allocation — a decision for whenever there is
a second game.

The signing key is server-only env and **never `VITE_`-prefixed**, which would inline it
into the bundle.

### - [ ] PR 23 — The client consumes it, and the dev sign-in goes

Supabase project configured to trust that JWKS as a third-party auth provider; the browser
supplies the token through supabase-js's `accessToken` callback, which re-mints near
expiry — so **nothing long-lived sits in a child's browser and there is no refresh token
at all**.

That forces `persistSession: false` / `autoRefreshToken: false`, and two auth
configurations cannot coexist in one client, which is why deleting
`devTools.signIn/signOut` belongs in **this** PR and not a follow-up. The
[fragility rule](#invariants) still holds: the credential guard must stay in the same
function body as the `await import('@supabase/supabase-js')`.

One migration, additive. `current_profile_id()` and `ensure_profile()` resolve
`provider = 'vt'` against `auth.jwt() ->> 'sub'` — not `(auth.uid())::text`, which is
equivalent for a uuid `sub` but silently returns `null` if a learner id ever is not one.
Both keep `SECURITY DEFINER` and an explicit `search_path`
([invariant 14](#invariants)).

**`profile_identities` gains its `('vt', subject)` row with no data migration**, because
`ensure_profile()` is idempotent and already runs on every boot. The prototype's
`('supabase', <uuid>)` rows stay as orphaned pointers. Stated honestly: **a dev tester's
prototype progress does not carry over** — there is no mapping from a test email to a
learner id, and inventing one would be a data migration in disguise.

The function also writes `profiles.grade_level` / `grade_source = 'platform'`, which
finally makes that branch of `supabaseStore` *correct* rather than merely reachable.
**Only a trusted server may write `'platform'`** — the column exists to mean "something
trusted asserted this", and `profiles_update_own` currently lets the client lie.

*Verify:* on staging, launch as a real learner and play a run; confirm the `profiles` row,
the `('vt', <learnerId>)` identity row, and `submit_run` landing with its mastery deltas.
Then the one that actually matters: **two children in the same household, and neither can
read the other's `game_progress`, `game_sessions` or `skill_mastery` rows.** Then
`get_advisors` clean.

### Upstream asks (the-student-experience)

This repo cannot implement any of these. Listed so nobody re-derives them.

1. **The catalog appends `?learner=<active learner id>`** to this game's `launchUrl`, or
   exposes an endpoint returning the active learner. `vt_active_learner` is `httpOnly` and
   nothing returns it, so the game can read the whole household but not the device's pick.
   Phase 1 ships without it at a cost of one boot at the wrong difficulty; **Phase 2 must
   not**, because there the cost is a permanent record on the wrong child.
   **Verified to be one line**: `routes/learner/games/+page.server.ts` already returns
   `activeLearnerId`, and `+page.svelte` already hands it to `recordRecentGameLaunch`
   beside the href it composes.
2. **A router path allocation for this game's deploy**, plus the asset-origin story —
   that app's own `paths.assets` plus a permissive `Access-Control-Allow-Origin` on
   immutable assets is the precedent. **Both phases depend on this**, and it is the one
   ask with no workaround available from inside this repo.
   **The prefix is settled**: `/learner/games/<slug>/`, inside that app's own subtree.
   So the ask is a rule that resolves *before* the `/learner/*` catch-all and forwards the
   full path unrewritten — the built HTML carries absolute asset paths, so a rule that
   strips the prefix breaks every asset. See the route-shape rationale near the top of
   this file.
3. *Optional:* enable Better Auth's `jwt` plugin there, so the exchange could verify a
   JWKS-signed token instead of calling `get-session`, and we could retire our own signing
   key. **Verified absent**, rather than assumed: the plugin list is `vtProvider()`,
   `admin()`, `sveltekitCookies()`.

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
| `games` | `slug` and `enabled` only. **All** metadata stays in the code manifest, name included; a DB-backed one turns copy edits into migrations. |
| `game_progress` | `(profile_id, game_slug)`, `state jsonb`, `revision`, plus a promoted `furthest int`. The personal best rides in `state` — see [below](#a-personal-best-and-no-leaderboard) |
| `skill_mastery` | `(profile_id, topic_id)`, nullable `standard_code`, attempts/correct. **Not keyed by game** — that is the entire point. |
| `game_sessions` | one row per run, unique on `(profile_id, idempotency_key)` |
| `currency_balances` | `earned` and `spent` as two **monotone** counters; balance is generated |
| `achievements` | `key`, `game_slug`, `enabled` only. Copy lives in code, exactly as with `games`. |
| `profile_achievements` | `(profile_id, achievement_key)`, `unlocked_at`, `progress int`. **First unlock wins** — a trigger keeps the earliest timestamp. |
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

`submit_run()` is a `SECURITY DEFINER` RPC and the **sole writer** of session, mastery and
achievement rows; clients get read-only policies on all three. It is idempotent on
`(profile_id, idempotency_key)`, so replay from an offline queue is exact.

### A personal best, and no leaderboard

The highscore is **the player's own best, and there is no board.** Not a global one, not a
grade-scoped one, not one deferred behind a flag.

A scoped board was drafted first, on the reasoning that a *global* board is incoherent
here — difficulty of the maths is the player's grade and not the wave number, so a grade-3
player and a kindergartener who both reach wave 20 did not do the same thing. That
reasoning holds, but it argues for something narrower rather than for something scoped:
once a board only compares a player against others doing the same maths at the same
grade, in a single-player game with no social surface, the remaining audience for it is
the player themself. Which is a personal best.

So it needs no table, no policy, no `profile_id` on anything, and no second player.
`bestScore` sits in `game_progress.state` beside the rest of the profile. It is
deliberately **not** promoted to a column the way `furthest` was: `furthest` earned that
because it *gates where a run may start*, so losing it would let a player skip ground they
had never covered, whereas losing a personal best is cosmetic. The escalation rule above
is a query, and nothing queries across best scores.

Two problems disappear with the board, and they were the expensive ones. A public board
needed the minors question answered before it could ship, and it needed a display name —
which meant a generated arcade handle, because free text from children is a moderation
problem this project has no reason to acquire and a real name is something this document
has already committed to not storing. Neither is a cost worth paying for a feature whose
audience is one person.

`highestWaveReached` remains the number that means something in an endless run. `bestScore`
sits beside it; the arcade score is still per-run everywhere else, and nothing reads a best
back into a run.

### Bosses produce no achievements

**Defeating a boss pays bounty and run time. Escaping one pays nothing. Neither unlocks an
achievement**, and that is not an oversight to be corrected later.

The boss economy is already a complete reward system, and it already draws the only
distinction that matters: `onBossDefeated` grants bounty and `BOSS_CLEAR_BONUS_MS` on the
mastery route and grants neither on the survival route. An achievement on top would be a
second payment for an event that is already paid, delivered through a different channel
with different rules — and the moment those two channels disagree about what a boss is
worth, the fight has two answers.

The timing makes it worse than redundant. The game's own notes record that making the
mastery route the only paying one **cost the youngest players the most** — a slow grade-K
player's median run fell from wave 10 to wave 6, and at roughly an 11% mastery rate they
almost never collect. The fix is coming from the curriculum, deliberately not from the
boss numbers. Hanging achievements off boss defeats would stack another mastery-gated
payout onto exactly the players who cannot reach the first one, which is the regression
that work exists to absorb.

Achievements therefore live somewhere in the parts of the game that are not already a
reward system — but *where* exactly is an open question, and topic completion is out too.
See PR 3 item 3.

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

And no key may name a boss outcome — see
[Bosses produce no achievements](#bosses-produce-no-achievements).

### Currency is client-authoritative, on purpose

It already is — `devTools.ts` ships a console command to grant yourself currency, and the
game's own docs treat that as fine. It is single-player, there is no leaderboard, and no
money is involved. Making purchases server-authoritative would mean reimplementing
`baseSkillTree.ts`'s cost, prerequisite, and installment logic in PL/pgSQL and keeping two
copies in sync forever.

CHECK constraints (`spent <= earned`, `correct <= attempts`) and the monotone trigger do
the cheap 80% — they stop bugs and casual tampering with no duplicated game logic.

**Revisit when** money is involved, or mastery is shown to a parent or tutor. The second is
the serious one: a falsified score is trivia, but a falsified mastery signal is worse than
no data, because a person may act on it.

Achievements and the personal best join this trade rather than changing it, and they are
the easy case: a personal best a player can edit is between them and themselves. The
leaderboard that would have made cheating other people's problem is
[not being built](#a-personal-best-and-no-leaderboard).

### Auth, when it comes

**It came, and the two options above were never alternatives.** This section used to
frame it as Supabase Third-Party Auth against VT's JWKS — "conditional on VT being able to
mint a `role: "authenticated"` claim" — with a token-exchange function as the fallback.

Reading the student experience settles it. It runs **Better Auth with no `jwt` plugin**,
so it issues session cookies and no JWT of any kind: there is no VT JWKS to point at, and
that option looks dead. It is not, because **the old framing assumed VT is the issuer.
We are the issuer.** The `role` claim is ours to write.

So the shape is both options at once: a **token-exchange function that verifies VT's
cookie server-side and then signs our own token**, consumed through Third-Party Auth
against a **JWKS we host**. See [Track D](#track-d--vt-identity) for the ladder. Three
consequences worth stating here, because each one is a decision the old text got wrong:

- **It is a Netlify Function in the game's own deploy, not a Supabase Edge Function.**
  The credentials are first-party `httpOnly` cookies on `varsitytutors.com`; nothing on
  `*.supabase.co` is ever sent them, so an Edge Function would have nothing to verify.
- **There is no `auth.users` row and no refresh token.** supabase-js's `accessToken`
  callback re-mints a short-lived JWT on demand, so nothing long-lived sits in a child's
  browser — and `auth.uid()` *is* the learner id, which keeps
  `profile_identities.subject` the platform's own id and makes the provider swap the
  one-line change [the data model](#data-model) was built for.
- **No email is involved**, which matters while open question 3 stands. The alternatives
  that mint a real Supabase user (`generateLink` + `verifyOtp`) need one, and a synthetic
  address is a lie in a table someone will eventually read.

---

## Invariants

Platform-level rules that did not exist before this work. Most are one-line mistakes with
expensive, quiet consequences.

1. **A game's id is one string in four places** — the directory under `games/`, the vite
   `base`, the catalog `href`, and the `game_slug` in the database. `scripts/build-site.mjs`
   asserts two of them agree; keep the other two in step by hand.
2. **Namespace every game's localStorage keys with its id, and scope them to the learner
   when one is known.** All games share one origin, so an unprefixed key is a collision
   waiting to happen; and one slot per *browser* means two children on a tablet share
   currency, skills and each other's queued runs. **The un-namespaced key never moves** —
   it is the anonymous slot, a learner gets a suffix, and relocating it would strand every
   current player.
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
10. **No achievement fires on a boss outcome, defeat or escape.** The boss economy
    already pays for one and already pays nothing for the other; an achievement would be
    a second payment through a channel with different rules. See
    [Bosses produce no achievements](#bosses-produce-no-achievements).
11. **The highscore is a personal best. There is no leaderboard, and no table for one.**
    See [A personal best, and no leaderboard](#a-personal-best-and-no-leaderboard).
12. **Only the publishable key is ever committed.** Service-role keys and test credentials
    live in a gitignored `.env.local`. RLS and grants are the only things protecting this
    data, and a leaked service-role key defeats all of them at once. **A signing key is
    never `VITE_`-prefixed**: the prefix is what inlines a value into the browser bundle,
    so a private key that picks one up ships to every player.
13. **Achievement and catalog copy lives in code, not in the database.** The DB stores
    unlocks, ids and an `enabled` flag — never a name, description or icon.
14. **Every `SECURITY DEFINER` function sets an explicit `search_path`.** Without it the
    caller controls resolution, which turns a helper into a privilege-escalation path.
    `get_advisors` flags this, which is why PR 4 verifies against it.
15. **No VT-derived value other than the opaque learner id may be persisted or
    transmitted.** Names, emails, avatars and household ids are dropped at the parse
    boundary in `vtIdentity.ts`, and the types offer nowhere to put them. An unused field
    is one refactor away from a used one, which is why they are discarded rather than
    merely ignored. See [open question 3](#open-questions-for-varsity-tutors).
16. **Identity is never the boot path.** `resolve()` is a `fetch`; `store.open()` must not
    await it and there must never be a loading phase. A late identity arrives through
    `onRemote` at a safe phase, exactly like a remote merge — see
    [Why progression boot stays synchronous](#why-progression-boot-stays-synchronous).
17. **An identity change adopts, it never merges**, and **only a trusted server writes
    `grade_source = 'platform'`.** Merging the previous learner's cached state into the
    new learner's row is how one sibling's currency lands on another's account; and that
    column exists to mean "something trusted asserted this", so a client that can write it
    can lie about it.
18. **Never hold the platform's session-signing key, or its auth database URL.**
    Verifying a session means *asking* the student experience — forwarding the request's
    own `Cookie` header to `get-session` — never checking its cookie ourselves.
    `BETTER_AUTH_SECRET` signs every session on `.varsitytutors.com`, and a local
    signature check would not be sufficient anyway: validity lives in Postgres or in a
    five-minute cookie cache, so checking it here either needs the auth database too or
    trusts a stale snapshot. The only signing key this repo ever holds is the one it
    generates for its own JWKS.

## Open questions for Varsity Tutors

None of these block Track A or Track B. Question 3 nearly did — a public leaderboard would
have needed it answered first — but the highscore is
[a personal best](#a-personal-best-and-no-leaderboard), so it does not. Three of them
change the architecture rather than just configuration:

1. ~~**Can the platform mint a JWT with a custom `role: "authenticated"` claim?**~~
   **Answered: no, not today — and it stopped mattering.** The student experience runs
   Better Auth (declared `^1.6.26`, installed 1.7.1) with no `jwt` plugin, so it issues
   session cookies and no JWT at all. This used to "gate third-party auth entirely"; it
   does not, because we verify the cookie server-side and sign our own token. Downgraded
   to an [upstream ask](#upstream-asks-the-student-experience) that would let us retire
   our signing key. See [Auth, when it comes](#auth-when-it-comes).
2. ~~**Does it expose the student's grade level?**~~ **Answered: yes.**
   `GET /learner/api/learners` returns `grade` per learner, vocabulary
   `['K','1'..'12','college','adult']`. Note what this did *not* settle: the mismatch with
   `GRADE_TOPICS` (authored K–3 only) is a **content** gap, not an integration one, and an
   unclamped grade-7 learner would land on Kindergarten addition via
   `curriculumLadderForGrade`'s every-curriculum fallback — hence PR 18 below.
3. **Are these users minors?** **Answered by implication: yes.** The platform's model is a
   household owner holding named child learners with an `isPrimary` flag — a family
   product. So COPPA/FERPA likely apply and the rule stands: **until this is answered
   formally, store no personally identifying information.** It now has a concrete edge
   rather than a hypothetical one — the household payload carries children's **names**,
   and PR 17 drops them at the parse boundary. The one VT-derived value that does reach
   disk is the opaque learner id, as a storage-key suffix and as `profile_identities.subject`.

Lower stakes, but needed before Track B reaches real users: the stable user id type,
access-token lifetime and whether the browser can refresh silently, whether tutor and
parent roles exist, and who operates the Supabase project long-term. The prototype answers
none of these and does not need to — it runs on dev test users precisely so that the
identity question can stay open while the schema and the policies get settled.
