import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

/**
 * Deliberately thinner than `games/math-blaster/vite.config.ts`, and the two
 * absences are the interesting part.
 *
 * NO `envDir`. The game points one at the repo root because it reads
 * `VITE_SUPABASE_*` and `VITE_VT_IDENTITY_BASE`. This page reads no env var at
 * all - no client, no auth, no network - so pointing one here would advertise
 * a capability that does not exist.
 *
 * NO `base`. The catalog stays at `/`. It is the one surface with no proxied
 * counterpart, so there is nothing for it to match; the games take a `base`
 * and this does not. Never `'./'` - see ROADMAP invariant 4.
 *
 * The sprites are ES-imported from the game's `public/` by relative path (see
 * `src/sprites.ts`). That needs no `server.fs.allow` entry: Vite's default
 * allow-root is the npm workspace root, which the root `package.json`'s
 * `workspaces` field puts at the repo root.
 */
export default defineConfig({
  plugins: [svelte()],
})
