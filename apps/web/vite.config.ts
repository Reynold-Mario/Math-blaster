import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
/**
 * The `.ts` extension is REQUIRED, not stylistic. Vite's `configLoader: 'native'`
 * (the planned default) resolves this import with Node's own resolver, which
 * does not do extensionless lookups - it warns today and breaks later.
 * `tsconfig.node.json` already sets `allowImportingTsExtensions`.
 */
import { GAMES, gameHref, type PlayableGame } from './src/games.ts';
import { DEV_PORT as MATH_BLASTER_DEV_PORT } from '../../games/math-blaster/dev-port.ts';

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
 * counterpart in production, so there is nothing for it to match; the games
 * take a `base` and this does not. Never `'./'` - see ROADMAP invariant 4.
 *
 * It does take a `server.port`, and 5173 rather than any other number: `npm
 * run dev` at the repo root starts this server and the games behind it, and
 * Vite's default port belongs to whatever you are meant to open.
 *
 * The sprites are ES-imported from the game's `public/` by relative path (see
 * `src/sprites.ts`). That needs no `server.fs.allow` entry: Vite's default
 * allow-root is the npm workspace root, which the root `package.json`'s
 * `workspaces` field puts at the repo root.
 */

/**
 * Which port each playable game's dev server answers on.
 *
 * ONE ENTRY PER PLAYABLE GAME - but the entry POINTS AT the game's own
 * declaration rather than restating the number, so the game workspace and this
 * proxy cannot drift apart. See ROADMAP invariant 1: the way to satisfy an
 * invariant about keeping copies in step is to delete a copy. The port is a
 * property of how the game's server was launched, so the game's directory is
 * where it belongs; what stays here is only the mapping.
 *
 * Reaching across a workspace boundary by relative path is the same move
 * `src/sprites.ts` already makes for the game's APNGs, and for the same
 * reason: this page is downstream of the games it lists.
 *
 * A second playable game adds a line here and a `dev-port.ts` of its own -
 * ports do not overlap, because 5173 belongs to this server.
 */
const GAME_DEV_PORTS: Record<string, number> = {
	'math-blaster': MATH_BLASTER_DEV_PORT
};

/**
 * Make the catalog's Play links work in local dev.
 *
 * WITHOUT THIS THE PLAY LINK IS A DEAD LINK THAT LOOKS ALIVE. `gameHref()`
 * returns an absolute path - `/learner/games/math-blaster/` - which in
 * production is a sibling of this page on one Netlify origin. In dev the game
 * is a SEPARATE Vite server on another port, so the click stays on this server
 * and its SPA fallback re-serves the catalog: same URL bar, catalog underneath,
 * no error anywhere. Proxying that prefix is what puts the two surfaces back on
 * one origin.
 *
 * NO `rewrite`, AND THAT IS THE DESIGN RATHER THAN AN OMISSION. The game's
 * `base` is the very path being proxied, so the game's dev server already
 * answers on it - request path in, same request path out. ROADMAP's `base`
 * section calls this out as the point of choosing the path up front: the proxy
 * is a no-op on the URL. Adding a `rewrite` here would break it.
 *
 * The prefix is DERIVED from the catalog data via `gameHref()`, not typed out,
 * so it cannot drift from what the links actually point at - the same reason
 * `gameHref` exists at all. See ROADMAP invariant 1: the way to satisfy an
 * invariant about keeping copies in step is to delete a copy.
 *
 * Importing `src/games.ts` from a Vite config is safe precisely because that
 * module imports nothing - see its own header. It is plain data and a pure
 * function, so pulling it into the config's esbuild bundle drags in no Svelte,
 * no DOM and no assets.
 */
const isPlayable = (game: (typeof GAMES)[number]): game is PlayableGame =>
	game.status === 'playable';

const gameProxy = Object.fromEntries(
	GAMES.filter(isPlayable).map((game) => {
		const port = GAME_DEV_PORTS[game.id];
		if (port === undefined) {
			throw new Error(
				`No dev-server port for playable game '${game.id}'. Add it to GAME_DEV_PORTS ` +
					`in apps/web/vite.config.ts, or the catalog's Play link will silently ` +
					`re-serve the catalog instead of the game.`
			);
		}

		/**
		 * A REGEXP KEY, not the bare prefix, so the boundary is exact. Vite treats
		 * a key starting with `^` as a RegExp and a plain key as a `startsWith`
		 * prefix - and a prefix of `/learner/games/math-blaster` would also
		 * swallow a future `/learner/games/math-blaster-advanced/`, proxying it to
		 * the wrong game's server. `(/|$)` pins it to a whole path segment.
		 *
		 * Game ids are kebab-case slugs (they are directory names under `games/`
		 * and a `base` path), so there is nothing here to escape.
		 */
		const prefix = gameHref(game).replace(/\/$/, '');

		return [
			`^${prefix}(/|$)`,
			{
				target: `http://localhost:${port}`,
				/**
				 * The game's HMR socket dials its own origin directly, so it does not
				 * come through here - but a game that ever sets `server.hmr.port` to
				 * match its page would, and a silently dead socket is a bad way to
				 * find that out.
				 */
				ws: true
			}
		];
	})
);

export default defineConfig({
	plugins: [svelte()],
	server: {
		/**
		 * `strictPort` because this is the URL the root `npm run dev` tells you to
		 * open and the one every game's port is numbered relative to. Vite's
		 * default on a busy port is to walk to the next free one - which is 5174,
		 * the game's, so a drifting catalog would take the port out from under the
		 * server it proxies to. Failing on the spot says what is wrong.
		 */
		port: 5173,
		strictPort: true,
		proxy: gameProxy
	}
});
