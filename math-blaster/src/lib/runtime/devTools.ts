import { BASE_SKILL_NODES } from '../skills/baseSkillTree';
import { createEmptyProfile, type PlayerProfile } from './PlayerProfile';
import type { TopicDelta } from '../progression/MasteryRecorder';

declare global {
  interface Window {
    pixelMathBlaster?: {
      resetProfile: () => void;
      addCurrency: (amount?: number) => void;
      unlockAll: () => void;
      mastery: () => void;
    };
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
  };
  console.log(
    '[pixelMathBlaster] debug tools ready - pixelMathBlaster.resetProfile() / .addCurrency(1000) / .unlockAll() / .mastery()'
  );
}
