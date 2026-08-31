import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
/** The `.ts` extension is REQUIRED, not stylistic - see the identical import
 *  in `apps/web/vite.config.ts` for why. */
import { DEV_PORT } from './dev-port.ts';

// https://vite.dev/config/
export default defineConfig({
	plugins: [svelte()],
	/**
	 * THE GAME IS SERVED FROM A PATH, NOT AN ORIGIN, AND THIS IS WHERE THAT IS
	 * DECIDED. It is a build-time literal, so it moves every published URL the
	 * day it changes - which is why ROADMAP.md settles the shape once and never
	 * again, and why this landed before the deploy link was circulated.
	 *
	 * Nothing in `src/` needs to know. `spriteAtlas.ts` composes its
	 * `ASSET_BASE` from `import.meta.env.BASE_URL`, which Vite substitutes as a
	 * literal, and Vite copies `public/` to the root of `outDir` - so the
	 * sprites resolve here on their own.
	 *
	 * Never `'./'` - a relative base resolves against the CURRENT DOCUMENT URL,
	 * so it breaks the moment a path gains a segment. See ROADMAP invariant 4.
	 *
	 * The dev server moves with it: the game is served at
	 * `/learner/games/math-blaster/`, not at `/`.
	 */
	base: '/learner/games/math-blaster/',
	/**
	 * WHY A PINNED PORT AT ALL: `apps/web`'s dev server proxies this game's path
	 * prefix here, so this port is something another process depends on rather
	 * than a detail of one terminal. `dev-port.ts` holds the number and the
	 * reasoning; `strictPort` is what keeps a busy port from silently moving the
	 * game out from under that proxy.
	 *
	 * This is what `npm run dev -w games/math-blaster` gives you: the game on
	 * its own, at `localhost:5174/learner/games/math-blaster/`. Plain
	 * `npm run dev` at the root runs the catalog alongside it and is the way in
	 * you normally want - the game is one click from the card.
	 */
	server: {
		port: DEV_PORT,
		strictPort: true
	},
	/**
	 * Env files live at the REPO ROOT, two levels up, not in this workspace.
	 *
	 * ROADMAP.md puts `.env.local` there because `supabase/` is platform-level
	 * and the credentials are shared by anything that talks to it, not owned by
	 * this game. Vite otherwise looks in its own root, finds nothing, and every
	 * `import.meta.env.VITE_*` reads as `undefined` - which the Supabase client
	 * treats as "not configured" and falls back to local-only. That failure
	 * looks exactly like working software, so it is worth a comment.
	 *
	 * THE DEPTH IS LOAD-BEARING AND HAS MOVED ONCE. It was `'..'` while the game
	 * sat at the repo root; the workspace move made that resolve to `games/`,
	 * which holds no env file. A future move has to count again.
	 */
	envDir: '../..'
});
