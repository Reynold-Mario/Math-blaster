import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  /**
   * Env files live at the REPO ROOT, one level up, not in this workspace.
   *
   * ROADMAP.md puts `.env.local` there because `supabase/` is platform-level
   * and the credentials are shared by anything that talks to it, not owned by
   * this game. Vite otherwise looks in its own root, finds nothing, and every
   * `import.meta.env.VITE_*` reads as `undefined` - which the Supabase client
   * treats as "not configured" and falls back to local-only. That failure
   * looks exactly like working software, so it is worth a comment.
   */
  envDir: '..',
})
