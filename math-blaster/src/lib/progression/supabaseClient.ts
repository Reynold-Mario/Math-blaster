import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The client, or `null` when the game has not been given any credentials.
 *
 * `null` is the normal state, not an error: with no `.env.local` the game runs
 * exactly as it always has, on localStorage alone. That is what makes it safe
 * to wire the remote store in before sign-in exists.
 *
 * Both values are read from `import.meta.env`, so both are inlined into the
 * bundle at build time and are readable from devtools. That is fine for these
 * two and only these two - the publishable key is designed to be public, and
 * RLS plus the grants in `supabase/migrations` are what actually protect the
 * data. Do not reach for this file to pass a secret.
 *
 * NOTE: `.env.local` lives at the REPO ROOT, not in this workspace, so Vite
 * needs `envDir` pointed there. Without it both reads are `undefined` and this
 * returns `null` - a silent fall back to local-only, which looks exactly like
 * working software. See `vite.config.ts`.
 */
export function createSupabaseClientFromEnv(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  if (typeof url !== 'string' || url === '') return null;
  if (typeof publishableKey !== 'string' || publishableKey === '') return null;

  return createClient(url, publishableKey, {
    auth: {
      // The session belongs in storage so a reload does not sign the player
      // out, and refresh has to be automatic because a run can easily outlast
      // an access token.
      persistSession: true,
      autoRefreshToken: true,
      // The game is not an OAuth callback handler; there is no redirect flow
      // to parse out of the URL, and leaving this on makes every boot inspect
      // the address bar.
      detectSessionInUrl: false,
    },
  });
}
