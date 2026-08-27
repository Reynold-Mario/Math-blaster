import { BASE_SKILL_NODES } from '../skills/baseSkillTree';
import { createEmptyProfile, type PlayerProfile } from './PlayerProfile';
import type { TopicDelta } from '../progression/MasteryRecorder';
import { getSupabaseClient, isSupabaseConfigured } from '../progression/supabaseClient';

declare global {
  interface Window {
    pixelMathBlaster?: {
      resetProfile: () => void;
      addCurrency: (amount?: number) => void;
      unlockAll: () => void;
      mastery: () => void;
      signIn: (email: string, password: string) => Promise<void>;
      signOut: () => Promise<void>;
      session: () => Promise<void>;
    };
  }
}

/**
 * SIGN-IN IS A CONSOLE COMMAND, NOT A SCREEN, and that is the point.
 *
 * The prototype needs a real session so it exercises the actual RLS surface
 * rather than reaching around it, but a login form rendered by the game is a
 * login form that can ship to a six-year-old. A dev-console API cannot: this
 * whole module is only installed behind `import.meta.env.DEV`, so it is
 * dead-stripped from production builds along with everything it imports.
 *
 * A real sign-in UI belongs with real VT auth (ROADMAP.md PR 14), where there
 * is an identity provider to sign in AGAINST. Building one here would mean
 * throwing it away then.
 *
 * Sign-ups are disabled on the project on purpose - the repo and the project
 * URL are both public, and `anon` being granted nothing is what protects the
 * data. Create test users from the dashboard (Authentication -> Users -> Add
 * user, with "Auto Confirm User" ticked); do not re-enable public signup to
 * make testing easier.
 */
async function withClient(what: string, fn: (client: Awaited<ReturnType<typeof getSupabaseClient>>) => Promise<void>): Promise<void> {
  if (!isSupabaseConfigured()) {
    console.error(
      `[pixelMathBlaster] ${what} needs Supabase credentials. Put VITE_SUPABASE_URL and ` +
        'VITE_SUPABASE_PUBLISHABLE_KEY in .env.local AT THE REPO ROOT (not in games/math-blaster/), ' +
        'then restart the dev server.'
    );
    return;
  }
  try {
    await fn(await getSupabaseClient());
  } catch (error) {
    console.error(`[pixelMathBlaster] ${what} failed.`, error);
  }
}

/**
 * Dev-only console helpers for testing the skill tree without grinding -
 * only attached in dev builds (see Game.svelte's onMount, gated on
 * import.meta.env.DEV so this never ships in a production bundle).
 * Mutates the live profile object in place so Svelte's reactivity picks
 * it up immediately - no reload needed. That in-place rule is why `save`
 * arrives as a callback rather than this file reaching for a store: the
 * caller owns the profile object, and handing back a fresh one here would
 * detach it from the component holding the same reference.
 */
export function installSkillTreeDebugTools(
  profile: PlayerProfile,
  save: () => void,
  liveTally: () => TopicDelta[],
  lastRunTally: () => TopicDelta[]
): void {
  window.pixelMathBlaster = {
    resetProfile(): void {
      const empty = createEmptyProfile();
      profile.currency = empty.currency;
      profile.earnedTotal = empty.earnedTotal;
      profile.spentTotal = empty.spentTotal;
      profile.skillProgress = empty.skillProgress;
      profile.skillSubProgress = empty.skillSubProgress;
      save();
      console.log('[pixelMathBlaster] profile reset - currency and every skill back to 0.');
    },
    addCurrency(amount = 1000): void {
      profile.currency += amount;
      // Granted money is still earned money as far as the totals are
      // concerned - skipping this would make the balance disagree with
      // `earnedTotal - spentTotal` and the next merge would undo the grant.
      profile.earnedTotal += amount;
      save();
      console.log(`[pixelMathBlaster] +${amount} currency - now ${profile.currency}.`);
    },
    unlockAll(): void {
      const progress: Record<string, number> = {};
      for (const node of BASE_SKILL_NODES) progress[node.id] = node.maxLevel;
      profile.skillProgress = progress;
      profile.skillSubProgress = {};
      save();
      console.log('[pixelMathBlaster] every skill maxed out.');
    },
    /** What this run has practised so far, and what the last finished run
     * did. The only way to see the mastery tally until it has somewhere
     * to be written. */
    mastery(): void {
      console.log('[pixelMathBlaster] this run so far:');
      console.table(liveTally());
      console.log('[pixelMathBlaster] last finished run:');
      console.table(lastRunTally());
    },
    async signIn(email: string, password: string): Promise<void> {
      await withClient('signIn', async (client) => {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        if (error !== null) {
          console.error('[pixelMathBlaster] sign-in refused:', error.message);
          return;
        }
        // No reload any more: the store subscribes to the auth state and
        // re-reads on a change, adopting the new identity's row rather than
        // merging this browser's state into it.
        console.log(
          `[pixelMathBlaster] signed in as ${data.user?.email ?? '(unknown)'}. ` +
            'Syncing now - no reload needed.'
        );
      });
    },
    async signOut(): Promise<void> {
      await withClient('signOut', async (client) => {
        const { error } = await client.auth.signOut();
        if (error !== null) {
          console.error('[pixelMathBlaster] sign-out failed:', error.message);
          return;
        }
        // Signing out deliberately changes nothing on screen. The store leaves
        // the state in hand alone, because a signed-out player is meant to get
        // exactly the local game rather than an emptied one.
        console.log('[pixelMathBlaster] signed out. The local game carries on unchanged.');
      });
    },
    async session(): Promise<void> {
      await withClient('session', async (client) => {
        const { data } = await client.auth.getSession();
        const user = data.session?.user;
        if (user === undefined) {
          console.log('[pixelMathBlaster] signed out. Local-only, which is the default state.');
          return;
        }
        console.log(`[pixelMathBlaster] signed in as ${user.email ?? '(no email)'} (auth uid ${user.id}).`);
      });
    },
  };
  console.log(
    '[pixelMathBlaster] debug tools ready - .resetProfile() / .addCurrency(1000) / .unlockAll() / ' +
      '.mastery() / .signIn(email, password) / .signOut() / .session()'
  );
}
