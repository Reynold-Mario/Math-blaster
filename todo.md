# Production readiness

The production-readiness ladder, alongside [`ROADMAP.md`](./ROADMAP.md) (the
feature ladder). `ROADMAP.md` says what the platform becomes; this file says what
has to be true before it can be run in production.

**For agents:** cite items by number (`todo.md 1.3`) the way `ROADMAP.md` is cited
by PR number. Keep the numbering stable — renumber only by appending. When an item
lands, tick it and leave the text; a struck item is a record of a decision.

**Current goal: a working prototype backed by a real database.** Netlify approval,
the repo transfer, and everything downstream of them are deferred — see
[Deferred](#deferred-needs-an-approval-first). Do not start Phase 2 work at the
cost of Phase 1.

---

## Where things stand (2026-08-26)

Standards baseline is `the-student-experience` (same stack: Svelte 5 + TS + Vite +
Netlify, same audience), with `student-onboarding-orchestration` for release and
deploy patterns and `eng-mcp-server` for small-repo hygiene.

**Landed on `main`:** `ROADMAP.md` PRs 0, 1, 2 and 4 (#21–#25). The progression
seam exists (`ProgressionStore` / `ProgressionCodec` / `ProgressionHandle`,
localStorage-only), the topic is a first-class field, `MasteryRecorder` tallies
per-topic attempts, and `supabase/migrations/` holds the full schema — 9 tables,
RLS policies, and the monotone triggers.

**Already good, do not redo:** ~401 unit tests, strict TS with zero
`@ts-ignore`, zero TODO markers, no committed secrets, `.nvmrc`-driven CI,
`package-lock.json` v3, colocated tests, imperative commit messages, and two
documents (`games/math-blaster/CLAUDE.md`, `ROADMAP.md`) that record rejected
alternatives.

**The Supabase project exists:** `svelte-games-met-st`, ref
`wyfceserpwwkxowauyld`, us-west-2, Postgres 17, `ACTIVE_HEALTHY`. All 7
migrations are applied to it, and as of 1.1 the committed filenames match the
ledger exactly. The CLI is initialized but not yet linked — see 1.2.

**Done since:** 1.1 migration reconciliation, 1.2 CLI init/link, 1.3 the
`.env*` gitignore hole, 1.4 `ensure_profile()`, and 1.5 the
`SupabaseProgressionStore` — so `ROADMAP.md` PR 5's store half is in.

**Not started:** `ROADMAP.md` PR 3 (achievements — now blocked on a design
decision, see 1b.1), PR 6 (`submit_run()`), dev sign-in (1.6); no linter, no
formatter, no production build in CI, no error handling around the game loop.

---

## Decisions taken here

Recorded so they are not re-litigated. Each is also written into the file that
actually owns it.

| Date | Decision | Lives in |
|---|---|---|
| 2026-08-26 | Migrations are applied by the CLI from committed files, never by MCP or the dashboard. Applied SQL is never edited. | 1.1, → root `CLAUDE.md` (4.1) |
| 2026-08-26 | **Exception:** comment-only edits to an applied migration are allowed. Executable SQL is not. | 1.1 |
| 2026-08-26 | Achievements are **not** based on defeating bosses, and **not** on completing topics. What they *are* based on stays open until discussed. | `ROADMAP.md` PR 3 item 3 |
| 2026-08-26 | Drift fixed by renaming local files to the applied versions, not `migration repair`. | 1.1 |
| 2026-08-26 | Docker is optional; only `supabase login` blocks Phase 1. | 1.2 / 1.2b |

---

## Phase 1 — A working prototype on a real database

The current goal. Delivers `ROADMAP.md` PR 5, plus the two setup gaps that PR 5
cannot land without. Order matters: 1.1 through 1.3 are prerequisites, not
parallel work.

### 1.1 ~~Reconcile the migration drift~~ — DONE (2026-08-26)

**What was wrong.** The 7 committed migrations and the 7 applied ones had the same
names and different version numbers (`20260826120000_profiles` vs
`20260826113641_profiles`, and so on). They had been applied out-of-band via MCP
`apply_migration` rather than by the CLI from the files — the giveaway is that each
ledger row holds the whole file as a *single* statement, which is what
`apply_migration` does and `db push` does not. The CLI therefore considered all 7
local files unapplied and would have tried to run them again.

**What was verified first.** Comment-stripped, whitespace-normalised SQL was
compared per migration against `supabase_migrations.schema_migrations`. All 7 are
**byte-identical in executable SQL** (same statement count, same md5). Every
difference is comments. So the live schema is exactly what the committed files
describe, and no DDL needed to change.

Three files did differ in prose, worth knowing:

- `rls_and_grants` and `revoke_public_execute_on_functions` — the committed
  versions carry *better* comments than the applied ones (the committed
  `revoke_public_execute` adds "Caught by `get_advisors` on first apply, not by
  review" and sharpens the closing note). Committed text kept.
- `achievements` line 21 — committed said `("defeat 5 bosses")`, applied said
  `("practise 15 topics")`. **Both are now invalid**: boss outcomes and topic
  completion are each ruled out as achievement criteria (decision of 2026-08-26,
  recorded in `ROADMAP.md` PR 3 item 3). So the fix was not to pick one but to
  write a comment that names no criterion at all, since the criteria are
  undecided. Done under the comment-only exception below — this was its first use.

**The fix taken: the 7 local files were renamed to the applied version numbers.**
Chosen over `supabase migration repair` for three reasons — it writes nothing to
the database, it needs no credentials, and `repair` inserts ledger rows with *no*
recorded SQL text, losing the applied statements that are currently there. The
relative order is unchanged (both sequences are monotonic in the same order).
`rls_and_grants.sql:17`'s internal cross-reference was updated from
`20260826120700` to `20260826114032` so it does not dangle.

- [x] Confirm the applied SQL and the committed SQL are identical — done, all 7.
- [x] Reconcile so the ledger and the directory agree — done by rename; all 7
      filenames now match a ledger row, in the same order, with identical SQL.
- [x] **Confirmed by the CLI**, not just by the ledger comparison.
      `supabase migration list` shows all 7 with `local == remote`, in order,
      nothing pending. Independent verification of the rename.
- [ ] Write the rule into the root `CLAUDE.md` (item 4.1), **with its one
      exception**. Until 4.1 lands, it lives here:

      > **Migrations are applied by the CLI from committed files** — never by MCP
      > `apply_migration`, never by the dashboard. **An applied migration's SQL is
      > never edited**; a change to schema is a new migration.
      >
      > **Exception, comments only.** Prose inside an applied migration may be
      > corrected in place. A comment is not schema: nothing replays it, nothing
      > depends on it, and a stale one that misstates a decision does active harm
      > by looking authoritative. The trade-off to know about is that the ledger's
      > stored `statements` keep the *original* prose, so file and ledger will
      > diverge in comments by design — that is expected, not drift, and
      > `migration list` compares versions rather than text so it stays green.
      > Executable SQL changing by so much as a whitespace character is **not**
      > covered by this exception.

      Hard rule (minus the exception) in `student-onboarding-orchestration`, for
      exactly the reason 1.1 exists.

### 1.2 Supabase CLI — initialized; only `login` actually blocks

`supabase init` is done: `supabase/config.toml` committed with
`major_version = 17` (matching the project's Postgres 17.6), plus a generated
`supabase/.gitignore` covering `.temp`, `.branches` and `.env.local` — which also
clears the untracked `supabase/.temp/` noise.

**Docker is NOT a blocker.** It is needed only for the *local* stack. Everything
Phase 1 actually needs runs against the real project with a login alone:

| Command | Docker |
|---|---|
| `supabase link`, `supabase migration list` | no |
| `supabase db push` — applies pending migrations to the project | **no** |
| `supabase db reset`, `supabase start` — local stack | yes |

- [x] `supabase init`, commit `config.toml`.
- [x] `supabase login` + `supabase link --project-ref wyfceserpwwkxowauyld`.
      **Note for next time: the in-session `!` prefix is non-TTY**, so the browser
      login flow fails there with `LegacyLoginMissingTokenError`. Run it in a real
      terminal, or pass `--token` / `-p` explicitly. Credentials persist to
      `~/.supabase` and the keychain, so this is a one-time cost.
- [x] `supabase migration list` — all 8 aligned, `local == remote` throughout.
- [ ] Pin the CLI version the way SOO does (`SUPABASE_CLI_VERSION`) so local and
      CI cannot drift. Currently 2.115.0.

### 1.2b The from-empty replay test — deferred, needs a container runtime or a branch

`ROADMAP.md` PR 4's own verification step (`supabase db reset` applying cleanly
from empty, twice) **has never been runnable** — there was no `config.toml` until
1.2. It is what catches a migration that only applies to a database already
holding the previous state. It is worth having before a second environment
exists; it is not urgent while there is exactly one.

Three ways to get it, none blocking Phase 1:

- **A container runtime** (`brew install colima docker && colima start`, or Docker
  Desktop) → `supabase db reset` twice. First run pulls several GB.
- **A Supabase branch** — a real ephemeral Postgres with the full auth stack,
  migrations replayed from empty, no Docker. Paid (order of a cent an hour) and
  needs a cost confirmation.
- **Not a bare local Postgres.** The migrations reference `auth.uid()` and grant
  to `anon`/`authenticated`, none of which exist in stock Postgres. Stubbing them
  means the test passes against a fiction, which is worse than no test.

- [ ] Run it, by whichever route.
- [ ] `get_advisors` (security) clean against the accepted baseline below.

**Accepted advisor findings, as of 2026-08-26.** Record these so a future run is
interpretable and does not cause churn — the same reasoning as SOO's
`.a11y-baseline.json`. Five findings, all intentional:

- INFO `rls_enabled_no_policy` on `public.profile_identities`. Deliberate:
  `20260826113847_rls_and_grants.sql:43` says "RLS AND NO POLICIES. Deny-all: the
  only things that may resolve an identity are the SECURITY DEFINER functions. Do
  not add a policy here, however convenient it looks."
- WARN `authenticated_security_definer_function_executable` ×4, for
  `can_read_profile(uuid)`, `current_profile_id()`, `owns_profile(uuid)` and
  `ensure_profile()`. All four are *supposed* to be callable by a signed-in user
  — that is what `grant execute ... to authenticated` is for, and revoking it
  would break both the policies and sign-in. Each returns only the caller's own
  profile id, or a boolean about the caller's own access, so there is nothing to
  leak. `anon` holds none of them.

If a sixth finding appears, it is real. Re-check this list when a new
`SECURITY DEFINER` function or a new table lands.

### 1.3 ~~Close the credentials footgun~~ — DONE (2026-08-26)

The root `.gitignore` was two lines (`.idea`, `.DS_Store`) and did not ignore
`.env*`, while `ROADMAP.md:165` puts `.env.local` at the **repo root** — untracked
but not ignored, one `git add -A` from being committed. 1.4 is the commit that
made that a live risk rather than a theoretical one.

- [x] Root `.gitignore`: `.env` / `.env.*` with a `!.env.example` negation, plus
      `node_modules/`, `dist/`, and per-user agent state
      (`.claude/settings.local.json`, `.claude/worktrees/` — `.claude/` itself is
      deliberately **not** ignored, so project-level agent config stays in
      review). Verified with `git check-ignore`: `.env.local` and
      `.env.production` ignored, `.env.example` still trackable.
- [x] Root `.env.example`, following `eng-mcp-server`'s convention where each
      value is *a sentence saying where to get it* rather than a placeholder. Two
      variables, both `VITE_`-prefixed and neither secret; the file states outright
      that anything added there ships in the JS bundle.
- [x] Only the **publishable** key may be committed (`ROADMAP.md` invariant 12).
      It is documented in `.env.example` rather than hardcoded so a project swap
      is a one-file change.

### 1.4 ~~`ensure_profile()`~~ — DONE (2026-08-26), applied and verified

`supabase/migrations/20260826135045_ensure_profile.sql`. The RLS grants already
referenced this function — `20260826113847_rls_and_grants.sql:66` says profiles
are created by it and there is deliberately **no insert policy** on `profiles`,
and `profile_identities` has RLS with no policies at all — so until now sign-in
had no way to produce a profile row.

- [x] `SECURITY DEFINER`, `set search_path = ''`, returns the profile id.
      Idempotent: the client calls it on every boot, not only the first, so a
      second call for the same auth subject returns the existing id rather than
      minting a second profile.
- [x] Takes **no arguments, and specifically not a grade.** `grade_level`
      defaults to `'K'` with `grade_source = 'self'`, and the picker updates it
      through `profiles_update_own`. Accepting a grade at creation would let a
      client assert one ahead of any platform that actually knows it, which is
      the distinction `grade_source` exists to hold.
- [x] Fails **loudly** on an anonymous caller (`raise exception`, errcode
      `28000`) rather than returning null the way `current_profile_id()` does. A
      policy needs to fail closed silently; an explicit write path called without
      a session is a client bug, and a null profile id would get carried around
      instead of reported.
- [x] Handles the two-tabs race on the `(provider, subject)` primary key:
      `on conflict do nothing`, then `get diagnostics row_count`, and on a loss
      it deletes the profile it just created — otherwise that row is an orphan no
      identity points at and nothing cleans up — and returns the winner's id.
- [x] `revoke all ... from public` then `grant execute ... to authenticated`,
      explicitly rather than trusting `20260826114032`'s
      `alter default privileges` to match, since those apply only to objects
      created by the role that set them.
- [x] **Applied via `supabase db push`** (dry-run first), not through MCP
      `apply_migration` — the path that caused 1.1. Applying cleanly is also what
      validated the SQL.
- [x] Verified in `pg_proc`: `prosecdef = true`, `provolatile = 'v'`,
      `proconfig = {search_path=""}`, returns `uuid`. Grants are
      `postgres, service_role, admin, authenticated` — **no `anon`, no `PUBLIC`**.
- [x] `get_advisors` (security) re-run. Both of `ROADMAP.md` PR 4's stated
      criteria pass: no table with RLS disabled, no `SECURITY DEFINER` function
      with a mutable `search_path`. See the accepted-findings note in 1.2b.

### 1.5 ~~`SupabaseProgressionStore`~~ — DONE (2026-08-26)

`ROADMAP.md` PR 5's store half. **It wraps the localStorage store rather than
replacing it**, which is what keeps every load-bearing property intact.

- [x] `current` still resolves **synchronously** — it is the cache's `current`.
      No loading phase, no `0 banked` flash. Pinned by a test that reads
      `handle.current` with no `await` anywhere above it while a fetch is in
      flight.
- [x] The remote read is a background fetch delivered through `onRemote`, which
      `Game.svelte` already only applies at a safe phase. `progress.onRemote(...)`
      had been wired since PR 1 and had never fired; it fires now.
- [x] **Late subscribers get a replay.** `Game.svelte` constructs the store
      during init and subscribes in `onMount`, so on a fast connection the boot
      fetch resolves before anyone is listening — and that dropped emit would be
      exactly the one that restores a returning player on a new device.
- [x] `revision` optimistic concurrency: the revision goes in the WHERE clause,
      never the payload (the trigger owns bumping it). Zero rows matched is a
      `conflict`, which re-reads and re-merges through the *game's* merge and
      retries with the new revision — never the payload that just conflicted.
- [x] Retry with exponential backoff on `unavailable`, plus an `online`
      listener, which is a better trigger than whatever a timer happened to be
      counting down to.
- [x] Vite `envDir: '..'` and `src/vite-env.d.ts`, so the root `.env.local`
      is actually found and a typo is a type error rather than a silent
      local-only fallback.
- [x] Debounce preserved and a second one added: the cache keeps ~2s/~15s, the
      push is ~5s/~30s. The cache absorbs the per-kill write rate; the network
      only has to stay roughly current.
- [x] `applyPlatformGrade` added to `ProgressionCodec` as an **optional** method.
      The store must not know that Math Blaster keeps its grade on
      `selectedGrade` — that is the same reasoning that put `merge` in the codec.
      `grade_source` decides authority: `'platform'` outranks the local picker,
      `'self'` does not.
- [x] 16 new tests against a fake `RemoteProgression`, so the suite needs no
      network and no `@supabase/*` import. 417 tests total, up from 401.

**`gradeSource.ts` was not touched, and that is the correct outcome** — its own
docstring already said the platform grade is implemented in the store and that
`resolveGrade()` keeps validating. See the correction in 1.6.

Deliberately deferred, each with a reason rather than an omission:

- **`currency_balances` is not written.** It is keyed by `profile_id` alone, so
  it is a *cross-game* aggregate, and whether Math Blaster's currency is shared
  with a second game is a design decision nobody has taken. Nothing is lost
  meanwhile: `earnedTotal`/`spentTotal` already ride inside
  `game_progress.state`. Revisit when game #2 exists or when a platform view
  needs it.
- **No run-level offline queue.** `ROADMAP.md` PR 5 item 4 asks for one keyed by
  `submit_run()`'s idempotency key — but a profile write is a single-row upsert
  guarded by `revision`, so it is already idempotent and "retry the same
  payload" is the right shape. A queue of distinct items belongs to runs, which
  is 1b.2. Half-building it now would mean two mechanisms to reconcile later.
- **The client is a static import.** See the bundle note below.

**The bundle finding, which is worth knowing before 1.6.** Vite inlines
`import.meta.env.*` at build time, so with no credentials the client's guards
constant-fold to an unconditional `return null`, `createClient` becomes dead
code, and `@supabase/supabase-js` is tree-shaken out completely — measured
125.92 kB / 44.51 kB gzip without credentials versus 335.16 kB / 98.65 kB with
them. So the repo's first runtime dependency currently costs its players
nothing. But the moment credentials ship, ~54 kB gzip lands on the critical path
of a children's game. **A dynamic `import()` behind sign-in should happen as
part of 1.6, not later** — and the guards must keep testing
`import.meta.env` values directly, because a check the optimiser cannot see puts
the whole cost back silently. Recorded in `games/math-blaster/CLAUDE.md`.

### 1.6 ~~Dev-only sign-in~~ — DONE (2026-08-26)

- [x] ~~`resolveGrade()` gets a platform answer to read.~~ **Corrected in 1.5:
      `gradeSource.ts` needed no change at all.** Its docstring already said the
      store would put the grade on the profile and that this function would keep
      validating it, which is exactly what `applyPlatformGrade` does.
- [x] **Sign-in is a console command, not a screen** —
      `window.pixelMathBlaster.signIn(email, password)` / `.signOut()` /
      `.session()`, alongside the existing dev helpers. The prototype needs a
      real session so it exercises the actual RLS surface, but a login form
      rendered by the game is a login form that can ship to a six-year-old. The
      whole module is installed behind `import.meta.env.DEV`, so it is
      dead-stripped from production along with everything it imports. A real
      sign-in UI belongs with real VT auth (`ROADMAP.md` PR 14), where there is
      an identity provider to sign in *against*.
- [x] **`ensure_profile()` needs no separate wiring** — `currentProfileId()`
      already calls it, so the first sync after sign-in creates the profile and
      its identity row.
- [x] **Sign-in requires a reload, deliberately.** The store runs its remote read
      once at boot; that has already happened, signed out. Rather than adding a
      re-sync path that real auth will never use (a session will exist before the
      game mounts), the dev flow reloads — the session persists to storage, so
      the next boot syncs for real. The console message says so.
- [x] **`@supabase/supabase-js` moved behind a dynamic `import()`** via a generic
      `createLazyRemote` wrapper, so the store needed no change: every port
      method was already async. Two properties, both measured:

      | build | chunks | main bundle | `supabase-js` |
      |---|---|---|---|
      | no credentials | 1 | 126.42 kB / 44.70 kB gzip | dropped entirely |
      | credentials | 2 | 127.78 kB / 45.35 kB gzip | side chunk, 53.98 kB gzip |
      | *1.5, static import* | 1 | 335.19 kB / 98.70 kB gzip | in main bundle |

      **53.35 kB gzip came off the critical path.** The trap found while doing
      it: a first attempt put the env guard in one function and the `import()` in
      another, and Rollup folds constants within a body but not across a
      boundary — so the 208 kB chunk was emitted on every build even with no
      credentials. Unreachable at runtime, but shipped. Recorded in
      `games/math-blaster/CLAUDE.md`; do not refactor the duplicated guard away.
- [x] **Sign-up policy decided: signups stay disabled.** They already were on the
      project, which is the posture this item was going to recommend anyway — the
      repo and project URL are both public, and `anon` being granted nothing is
      what protects the data. Test users are created from the dashboard
      (Authentication → Users → Add user, **"Auto Confirm User" ticked**); admin
      creation bypasses the `signup_disabled` flag, which only gates the public
      `/auth/v1/signup` endpoint. **Do not re-enable public signup to make
      testing easier.**
- [x] 5 new tests for `createLazyRemote`, including the two properties that
      would otherwise fail silently months later: the load promise is memoized
      (so a boot read and a first push share one fetch) but a *failure* is not
      (so a player who booted offline can still sync when the connection
      returns). 422 tests, up from 417.

Left for whoever runs it: **two junk `auth.users` rows** (`blaster-test-a@`,
`blaster-test-b@`) written directly by SQL rather than minted by GoTrue. They
look confirmed and have password hashes, but their token columns are NULL so
they cannot sign in — delete them from the dashboard before creating real test
users, or you will debug the wrong user.

### 1.7 ~~Prove it~~ — mostly DONE (2026-08-26), verified in Chrome

Run against the real project with two dashboard-created users
(`mathblastertest1@`, `mathblastertest2@`), signed in via
`pixelMathBlaster.signIn(...)`.

- [x] **`ensure_profile()` ran for real.** `profile_identities` 0 → 2, with
      `subject` matching `auth.uid()` on both. That function had never executed
      before.
- [x] **Progression survives a reload.** Both users hold their own
      `game_progress` row: `revision` 6, `furthest` 10, currency 8 / 13,
      3 skills each. The guarded-update path ran five or six times per user
      under real gameplay, not once.
- [x] **The `currency == earnedTotal - spentTotal` invariant survived a round
      trip** on both profiles (115 spent across 3 skills). This is the invariant
      `CLAUDE.md` warns fails silently and locally, then reappears as free money
      on the first merge.
- [x] **RLS proven from the browser**, through the game's own client with a real
      session — not by inspecting rows as the service role, which bypasses RLS
      and proves nothing. Signed in as test2:

      | table | rows in table | visible |
      |---|---|---|
      | `game_progress` | 3 | **1** |
      | `profiles` | 3 | **1** |
      | `profile_identities` | 2 | **`42501` denied** |
      | `games` | 1 | readable ✅ |

      The `profile_identities` denial is the deny-all posture from
      `20260826113847_rls_and_grants.sql:43` confirmed even for the owner.
- [x] **Found and fixed a bug only a live run could surface.** See the
      `stableStringify` note in `games/math-blaster/CLAUDE.md`: the store compared
      state with `JSON.stringify`, the codec emits keys in a different order from
      `parse`, so every signed-in player pushed a redundant write on every boot.
      Observed as `revision` 5 → 6 with byte-identical state. Fixed, with two
      regression tests that genuinely fail without the fix (verified by
      reverting), and the test codec now disagrees with itself on key order the
      way the real one does. 423 tests.
- [ ] **Offline mid-run is still untested.** DevTools → Network → Offline, play
      through, confirm the run is uninterrupted and syncs on reconnect. This is
      the `unavailable` → backoff → `online` listener path, which currently has
      only unit coverage against the fake port. Not drivable from the browser
      tooling available here — it needs the DevTools throttling UI by hand.
- [x] ~~Delete the two junk `auth.users` rows.~~ Done. **The stated reason for
      identifying them was wrong**, which is worth recording: they were supposed
      to be recognisable by NULL GoTrue token columns, but that was true of all
      four users including the two working ones. The real signals were
      `last_sign_in_at IS NULL` and zero `profile_identities` rows, and the
      delete was guarded on both so a mistyped address could not have taken a
      real user. Nothing cascaded - `profiles` 3, `profile_identities` 2,
      `game_progress` 3, `currency_balances` 1, all unchanged - which
      incidentally proves in practice the invariant that **nothing
      foreign-keys to `auth.users`**, the property meant to make the identity
      provider swappable later without a data migration.

      Still present and deliberately kept: one orphan profile (`48eabce6...`)
      with no `profile_identities` row, so nothing can ever sign in as it. It
      owns the `currency_balances` row and is the profile that demonstrated the
      monotone-trigger clamps.

## Phase 1b — the run lands in one write

- [ ] **1b.1** `ROADMAP.md` PR 3 — achievements and a personal best. **Blocked on
      a design decision, not on code:** as of 2026-08-26 what an achievement may
      be based on is deliberately open, with boss outcomes and topic completion
      both ruled out. The plumbing is already done and waiting — `submit_run()`
      accepts an achievement key list, de-duplicates it, drops keys it does not
      recognise, and the `profile_achievements` trigger owns first-unlock-wins;
      the client passes `achievements: []`. When the decision lands, nothing but
      that array changes. The personal-best half (`bestScore`, staying in
      `game_progress.state` and never promoted to a column) is unblocked and can
      land alone.
- [x] **1b.2** ~~`submit_run()`~~ — DONE (2026-08-26).
      `supabase/migrations/20260826171340_submit_run.sql`, `SECURITY DEFINER`,
      `search_path = ''`, granted to `authenticated` only. Sole writer of
      `game_sessions`, `skill_mastery` and `profile_achievements`.
      **The session insert is the idempotency gate**, and the ordering is the
      design: `on conflict (profile_id, idempotency_key) do nothing` returns
      before mastery or achievements are touched. Mastery accumulates in the
      function because the table trigger only takes `greatest` — writing a delta
      raw would leave the counter stuck at the largest single run instead of a
      lifetime total. Two defensive choices worth keeping: the payload is
      aggregated by topic first (a payload naming one topic twice would
      otherwise fail with "ON CONFLICT DO UPDATE cannot affect row a second
      time" and take the whole run down), and `correct` is **clamped** to
      `attempts` rather than rejected (a CHECK violation would abort the
      transaction and cost the player the run over a client arithmetic bug).
      Client side: `runQueue.ts` persists a finished run **before** any network
      call and owns the idempotency key; `RemoteProgression` grew `submitRun`
      with three outcomes so a permanently-refused run drops instead of wedging
      the queue. Wired at `game-over` through the existing `MasteryRecorder`
      callback — **the mastery deltas finally have somewhere to go.**
      12 new queue tests + 5 for the lazy wrapper. 435 tests, up from 423.
- [x] **1b.3** ~~Confirm a replayed key is a no-op~~ — verified against the real
      database, not just the fake port. Two identical `submit_run` calls:

      | check | result |
      |---|---|
      | sessions for the key | **1** — replay inserted nothing |
      | duplicate topic in payload | aggregated 10+2 / 6+1 → **12 / 7**, not doubled by the replay |
      | `correct: 99` vs `attempts: 3` | clamped to **3 / 3**, transaction survived |
      | unknown achievement key | **dropped**, no error |
      | real achievement key | **unlocked** |

      Then the full client path end-to-end: `runQueue` → `submitRun` →
      `submit_run()` landed a session (wave 12 / score 4321 / 2 bosses /
      123456ms), its mastery row, and one achievement.
- [ ] **1b.4** Clean up the probe rows when convenient. `skill_mastery` holds
      `e2e-probe-topic`, `k-add-within-5` and `k-count-to-10` with fabricated
      counts on test2's profile, plus 2 `game_sessions`. Harmless in staging,
      but mastery is described as "a signal a teacher may act on", so fiction in
      it should not outlive the test that made it.

## Phase 2 — Quality gates

The largest gap after the database. There is **no linter and no formatter**, and
`.github/CONTRIBUTING.md:33` currently states that as *policy* — so that file
changes in the same PR as 2.1.

- [ ] **2.1** ESLint + Prettier, mirroring `the-student-experience`.
      `games/math-blaster/eslint.config.js`: flat config with `js`/`ts`/`svelte`
      recommended, `eslint-config-prettier`, `svelte.configs.prettier`, TSE's
      `includeIgnoreFile('.gitignore')` trick, `no-console: error` with commented
      path exemptions, and `parserOptions.projectService: true` on `**/*.svelte`.
      `games/math-blaster/prettier.config.js`: TSE's exact settings — `useTabs: true`,
      `singleQuote: true`, `trailingComma: 'none'`, `printWidth: 100`, plus
      `prettier-plugin-svelte`.
      Skip TSE's `no-restricted-globals: fetch` (no server here) and its
      inline-`<svg>` ban (everything is canvas).
      **Sequencing:** the first `prettier --write` rewrites nearly every file. Keep
      it as its own commit so a rebase can take it wholesale, and land it when no
      long-lived branch is open.
- [ ] **2.2** Adopt TSE's zero-suppressions rule: no `eslint-disable`, no
      `svelte-ignore`, machine-enforced via `no-warning-comments` plus a
      `no-restricted-syntax` selector on `SvelteHTMLComment`. Note
      `src/lib/runtime/balanceReport.test.ts:39,41,56,58` already carries four
      `// eslint-disable-next-line no-console` comments that are inert today and
      become both live *and* forbidden the moment ESLint exists. The correct fix is
      a path-scoped `no-console: off` override for that file plus `tools/**` and
      `runtime/devTools.ts`, each line commented with why.
- [x] **2.3** ~~Fix the CI job that lies.~~ DONE (2026-08-26).
      `.github/workflows/ci.yml` was named "Build, Check & Test" and never ran
      `npm run build`, so a Vite build failure passed CI and surfaced on
      someone's machine instead. Added the build step (first, because it is the
      cheapest way to fail), `--fail-on-warnings` on `svelte-check` to match
      `the-student-experience`'s zero-warning contract, `permissions:
      contents: read`, and `timeout-minutes: 10`.
      **Proved the gate gates** rather than assuming: broke an import, watched
      the build fail, reverted, watched it pass. Worth noting the demonstration
      was imperfect — a bad import is caught by `tsc` too. What the build
      genuinely adds is what type-checking cannot see: a plugin or config
      failure, an unresolvable asset, a Svelte compile error `tsc` is happy
      with. The comment in `ci.yml` says so accurately.
      *This is `ROADMAP.md` PR 8 — tick it there too.*
- [ ] **2.3b** Split into one job per gate (`Lint` / `Build` / `svelte-check` /
      `Unit tests`), so a failure names itself instead of hiding inside one
      combined check. **Deliberately not done here:** `"Build, Check & Test"` is
      the *required status check* on `main`, so renaming or splitting the job
      leaves branch protection waiting forever on a context that no longer
      reports — the PR sits `BLOCKED` with nothing to fix, which is exactly the
      failure mode that cost time on #26 and #30 today. Doing it means updating
      the protection rule in the same change, which is a repo-settings edit
      rather than a code one. Bundle it with 2.1, which adds the `Lint` job
      anyway.
- [x] **2.4** ~~`.github/dependabot.yml`~~ DONE (2026-08-26), modelled on
      `eng-mcp-server`'s: npm weekly grouped by `dependency-type`,
      github-actions monthly, `open-pull-requests-limit: 5`,
      `labels: [dependencies]`.
      `directory` was **`/math-blaster`**, because there was no root manifest and
      `/` would have found nothing — a config that looks correct and never fires.
      `ROADMAP.md` PR 7 has since landed and **inverted that**: `directory` is now
      `/`, where both the `workspaces` field and the only lockfile live.
      This item predicted "a root entry plus a `games/math-blaster` one" and that
      was wrong on both halves. There is no lockfile beside the workspace manifest,
      so a job aimed there bumps a range and leaves the lockfile behind, failing
      `npm ci` on every PR it opens; and two entries would duplicate each bump
      against a 5-PR limit. One entry at `/` covers every workspace.
- [ ] **2.5** A migration-drift guard in CI, once 1.1 is settled — the automated
      version of the rule 1.1 writes down. Both student apps run one
      (`supabase-migration-drift.yml`); a PR-time dry-run plus a check that the
      ledger matches the directory is enough here.
- [ ] **2.6** `.husky/pre-push`, following TSE's stated doctrine: only checks CI
      cannot surface fast enough, with the reasoning in the hook file. For this
      repo that is probably nothing yet, so **add the file when there is a first
      candidate, not before.** Do not add `lint-staged` — TSE deliberately does
      not, and a repo-wide Prettier pass makes staged-file formatting redundant.

---

## Phase 3 — Resilience and structure

- [ ] **3.1** Migrate Jest → Vitest. Enables 3.2, matches both student apps, and
      deletes the `tsconfig.jest.json` workaround plus the constraint recorded in
      `games/math-blaster/CLAUDE.md` that *"an asset import in any `.ts` under `src/`
      breaks `npm test`"* — Vitest runs through the Vite pipeline, so that stops
      being true. It will also **delete `tsconfig.jest.json`
      outright**, which is the config PR #28 just fixed. (An earlier draft of
      this item said Vitest "supersedes" PR #11 and that it should simply be
      closed. That was wrong: #11's fix was still live, because `main`'s version
      of that file inherits `exclude: ["src/**/*.test.ts"]` from
      `tsconfig.app.json` and therefore type-checked **zero** test files. #11 was
      re-landed as #28 rather than discarded. The lesson worth keeping: check
      whether a stale PR is stale before closing it as superseded.) Adopt TSE's two-project config (a `node` server project and a browser
      client project), its `expect: { requireAssertions: true }`, and its pinned
      `TZ`/`LC_ALL`. Keep the `BALANCE_REPORT=1` opt-in gate working.
- [ ] **3.2** Test the three largest files in the repo, which have **zero** tests:
      `Game.svelte` (838 L), `SkillTreeScreen.svelte` (821 L),
      `GameCanvas.svelte` (819 L) — 2,478 lines untested because the test env is
      `node`. Use TSE's approach: `@vitest/browser-playwright` +
      `vitest-browser-svelte` against real headless Chromium, plus its
      `svelte-warnings.ts` setup file that turns Svelte runtime warnings into
      failures. Priority order: the `GamePhase` machine and HUD wiring;
      purchase/affordability/prereq rendering in the shop; and for the canvas,
      assert the `gameEvents` subscriptions fire and overlay geometry comes from
      `spriteSize()` — **not** pixel snapshots, which would break on every art
      change.
- [ ] **3.3** Make a thrown exception visible. There is no `try/catch` around
      `tick(runtime, profile, dt)` at `src/lib/Game.svelte:281` and no
      `window.onerror`. One throw inside the rAF loop freezes the game with no
      message and no signal — the worst possible failure for a seven-year-old, and
      the one `games/math-blaster/CLAUDE.md` already warns is easy to misdiagnose (a
      throttled background tab looks identical). Add an `error` member to the
      `GamePhase` union in `src/lib/types.ts`, catch around the tick, cancel the
      loop, render a plain "something went wrong — play again" panel, and wire the
      same handler to `window.onerror` / `unhandledrejection`.
- [ ] **3.4** Self-host the two fonts. `src/app.css:1` `@import`s Baloo 2 and Press
      Start 2P from Google Fonts — the app's **only** third-party network
      dependency. For a children's product that is a third-party request tied to a
      child's IP, a render-blocking dependency on an origin outside any future
      CSP, and a first-paint stall if it is slow. Vendor the woff2 files into
      `public/fonts/` with local `@font-face` and `font-display: swap`.
- [ ] **3.5** Split `src/lib/runtime/gameFlow.ts` — 1,236 lines, 62 functions, the
      god-module. It is well-commented with 65 test cases, so this is
      maintainability work, not a bug fix, and it runs **after** 3.1/3.2 so the
      tests move first and can prove the split is behaviour-neutral. Seams, along
      the layering `CLAUDE.md` already documents: boss lifecycle
      (`startBossPhase`, `resolveBossShot`, `updateBossPhase`) →
      `runtime/bossFlow.ts`; spawning and reinforcement (`spawnEnemy`,
      `tryReinforce`) → `runtime/spawning.ts`; economy (`awardCurrency`,
      `addRunTime`) → `runtime/economy.ts`. `tick()` and `handleInputAction` stay
      as the orchestrator, and the ~25 named tuning constants stay together —
      they are read as a group when balancing, and `balanceSim.ts` drives the real
      functions. The 65 existing cases must pass **unmodified**; if a test needs
      editing, the split changed behaviour.

---

## Phase 4 — Docs and conventions

- [ ] **4.1** Add a root `CLAUDE.md`. There is only `games/math-blaster/CLAUDE.md` today.
      Follow TSE's progressive disclosure: root holds repo-wide rules only (lint
      policy, zero suppressions, the migration rule from 1.1, commit conventions,
      a pointer to this file), and the nested file keeps owning game architecture.
- [ ] **4.2** Update `.github/CONTRIBUTING.md`. Its Code style section states the
      repo has no linter *by policy*; that must change with 2.1, and gain the local
      commands plus the zero-suppressions rule.
- [ ] **4.3** Settle one genuine conflict between the two baselines and record the
      decision. TSE's CLAUDE.md says **"Don't add docs. Code documents itself"**
      and forbids resurrecting `docs/`; SOO ships 160+ docs and 28 ADRs. This repo
      sits closer to SOO — a 624-line CLAUDE.md and an 862-line ROADMAP — and those
      documents are its best asset, so **do not import TSE's anti-docs rule
      wholesale.** Recommended: keep `ROADMAP.md` and both CLAUDE.md files
      first-class, and adopt TSE's **`PONYTAIL-DEBT.md`** ledger for tracked
      shortcuts, since it is grep-regenerable from `ponytail:` source comments and
      so cannot rot the way a hand-maintained list does. The "Known gaps" section
      of `games/math-blaster/CLAUDE.md` is already that file in everything but name.

---

## Deferred — needs an approval first

Not "later"; **blocked**. Do not start these.

- **Repo transfer to the `varsitytutors` org.** The remote is
  `git@github.com:Reynold-Mario/Math-blaster.git`, a personal account. Shipping
  under `varsitytutors.com` needs it: the org release pattern requires
  `varsitytutors/vt-workflows/.github/actions/generate-app-token@v6.1.1` (classic
  PATs are org-deactivated), CODEOWNERS needs `@varsitytutors/*` teams, and
  Netlify sites are org-provisioned. Blocks CODEOWNERS, the release workflow, and
  the deploy.
- **Netlify site and deploy approval.** `ROADMAP.md` Track C is held on this. When
  it lands: note that org policy blocks connecting a repo to the Netlify GitHub
  App, so the deploy must run from Actions via `netlify-cli` — design for that
  shape from the start. Covers `netlify.toml`, security headers and CSP, the
  `release-YYYY-MM-DD_HH-MM-SS` tag → `deploy-production-on-release` handoff (a
  production deploy must never be a merge side-effect), and a deploy smoke check.
  *= `ROADMAP.md` PR 12.*
- **vt-router path allocation** (`/games/*`) and the asset-origin story. TSE hit
  this hard: the app is served at `varsitytutors.com/learner` while chunks come
  from the Netlify origin, forcing an assets base plus a permissive
  `Access-Control-Allow-Origin` on immutable assets. Vite's knobs are `base` and
  `build.assetsDir`.
- **Observability.** There is no error reporting or telemetry at all. When it comes:
  a typed telemetry registry as the single emission seam (TSE's contract verbatim —
  snake_case names and keys, values limited to `string | number | boolean | null`
  because PostHog freezes a property's type on first ingest, `.strict()` schemas,
  never any PII), a deterministic exception fingerprint, and a **capture rate
  limiter** (SOO uses 5 per 60s) because a throw inside a 60fps loop emits
  thousands of identical events per second. Route through a same-origin relay that
  strips `Cookie` and `Authorization`.
- **Privacy / Legal sign-off on telemetry for under-13 users.** The audience is
  K-3. Analytics, and especially session replay on a child's screen, is a COPPA
  question rather than an engineering one. Needs a written answer before any
  telemetry ships. Default to no replay and no stable per-child identifier.
- **Accessibility.** One item here is a safety issue rather than polish and should
  jump the queue the moment anyone outside the team plays it:
  **honour `prefers-reduced-motion`.** `GameCanvas.svelte` runs hit-flash, screen
  shake, one-shot explosions and three-layer parallax; for a photosensitive child
  that is a hazard. Both student apps force `reducedMotion: 'reduce'` in
  Playwright, which is what the org treats as default. Add an in-game toggle too —
  a child on a school device may not control the OS setting. Then: WCAG AA
  contrast on `Press Start 2P` at small sizes, visible focus rings and no keyboard
  traps across `GamePhase` transitions, a written screen-reader boundary (a
  real-time canvas arcade game is not screen-reader playable; saying so is better
  than an audit that pretends otherwise), and an a11y CI gate scoped to the Svelte
  chrome with the canvas baselined and commented.
- **`LICENSE`.** There is none. `eng-mcp-server` ships MIT, but a VT-owned consumer
  product is probably proprietary — confirm rather than copy.

---

## Out of scope

- **Coverage thresholds.** **None of the four reference repos sets one.** SOO uses
  mutation testing and suppression ratchets; TSE uses `requireAssertions` plus SQL
  contract tests. Adding one here would be a divergence, not an improvement.
- **Retuning any balance number.** `games/math-blaster/CLAUDE.md` documents these as
  measured against `balanceSim.ts` and interacting with each other; the grade-K
  boss-economy regression is a known, deliberately-unpatched decision with a
  stated fix route (a curriculum exception, not a boss-knob retune). Not a
  production-readiness matter.
- **Fixing client-authoritative currency.** Documented and accepted at
  `ROADMAP.md:741` for a single-player kids' game. It has a stated revisit trigger;
  until that trips, leave it.
- **`ROADMAP.md` PRs 7, 9–12, 13–16** (the workspace move, the site, the landing
  page, the catalog). Their own ladder, and most of it waits on the Netlify
  approval above.

---

## Open questions

1. **Does the game ship inside an authenticated shell, or standalone?** Decides
   whether the telemetry relay is load-bearing on day one, and whether
   `resolveGrade()` gets a real grade service in this scope (1.6) or later.
2. ~~**`ROADMAP.md` PR 7 moves the game into an npm workspace under `apps/`.**
   Should Phase 2's tooling be authored at the repo root or inside
   `math-blaster/`?~~ **Answered: root.** PR 7 has landed. It moved the game to
   `games/math-blaster/` — not `apps/`, which this question had wrong — and CI,
   the lockfile and the fan-out scripts all now live at the repo root. Author
   Phase 2's tooling there.
3. **Is the first ship one game or the catalog?** If it is genuinely just Math
   Blaster, `ROADMAP.md` PRs 7, 10, 11 and 16 can all be deferred past launch.
4. **Who owns this in production?** Needed for CODEOWNERS, the Netlify site owner,
   and the on-call path when the game breaks at 8pm.
