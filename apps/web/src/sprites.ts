import type { SpriteKey } from './games'

import playerUrl from '../../../games/math-blaster/public/sprites/player.apng'
import droneUrl from '../../../games/math-blaster/public/sprites/drone.apng'
import swarmerUrl from '../../../games/math-blaster/public/sprites/swarmer.apng'
import hulkUrl from '../../../games/math-blaster/public/sprites/hulk.apng'

/**
 * The card art, IMPORTED FROM THE GAME RATHER THAN COPIED INTO THIS WORKSPACE.
 *
 * The obvious alternative - copy the `.apng` files into `apps/web/public/` -
 * is the one to avoid. `npm run sprites` regenerates the originals IN PLACE,
 * under their authored filenames; that is the same fact that forces PR 12's
 * rule about not serving `/learner/games/*&#47;sprites/*` with `immutable` cache
 * headers. A copy diverges the first time the art is regenerated, and the
 * failure reads as "the landing page shows last month's drone" - which nobody
 * notices. Importing reads the real file at build time, so staleness is not
 * possible rather than merely unlikely.
 *
 * Every sprite is under Vite's 4096-byte `assetsInlineLimit`, so these land in
 * the JS bundle as base64 data URIs and `dist/` contains no `sprites/`
 * directory at all. The page therefore has ZERO runtime asset dependency on
 * the game's deploy. If a future sprite ever exceeds that limit, append
 * `?no-inline` to its specifier and it becomes a hashed file in `dist/assets/`.
 *
 * No `*.apng` type declaration is needed: `vite/client.d.ts` already ships one,
 * and `tsconfig.app.json` already has `vite/client` in `types`.
 */

/**
 * Native pixel dimensions. These duplicate `SPRITE_META` in the game's
 * `render/spriteAtlas.ts` and MUST NOT be extracted into a shared package:
 * invariant 3 wants a second real consumer, and the game's copy also carries a
 * `scale` tuned to the 400x320 canvas HUD, which is not the scale a catalog
 * card wants. Two independent tables that happen to agree on width and height.
 */
export const SPRITE_ART: Record<SpriteKey, { url: string; w: number; h: number }> = {
  player: { url: playerUrl, w: 36, h: 19 },
  drone: { url: droneUrl, w: 32, h: 24 },
  swarmer: { url: swarmerUrl, w: 36, h: 28 },
  hulk: { url: hulkUrl, w: 32, h: 32 },
}

/**
 * Integer, and it has to be. `spriteAtlas.ts` makes the same point: a bitmap
 * upscaled by a fraction with smoothing off gets uneven pixel widths, and the
 * whole pixel-art premise dies. 5x fits every sprite inside a 16:9 hero.
 */
export const SPRITE_SCALE = 5
