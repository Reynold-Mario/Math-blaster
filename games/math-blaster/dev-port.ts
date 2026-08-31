/**
 * The port this game's Vite dev server binds, declared ONCE and imported by
 * two configs that must agree about it.
 *
 * It is a separate file rather than an export from `vite.config.ts` because
 * `apps/web/vite.config.ts` is the other reader: it proxies this game's path
 * prefix through to this port, and importing a whole Vite config to read one
 * number would drag the svelte plugin into the catalog config's bundle for
 * nothing. This module imports nothing, for the same reason `apps/web`'s
 * `src/games.ts` does - see its header.
 *
 * NOT 5173, AND THAT IS THE CHANGE THIS FILE EXISTS TO RECORD. Vite's default
 * belongs to whatever you are meant to open, and `npm run dev` at the repo
 * root now opens the catalog. The catalog takes 5173; each game sits behind it
 * on its own port and is reached by clicking through. A second playable game
 * takes 5175, and so on.
 *
 * Both readers set `strictPort` alongside it. Vite's default on a busy port is
 * to walk to the next free one, which here would move the game out from under
 * the proxy target and leave the catalog's Play link answering ECONNREFUSED -
 * a failure a good deal more confusing than "port 5174 is already in use".
 */
export const DEV_PORT = 5174;
