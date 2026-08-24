import { BASE_SKILL_NODES } from '../skills/baseSkillTree';
import { createEmptyProfile, savePlayerProfile, type PlayerProfile } from './PlayerProfile';

declare global {
  interface Window {
    pixelMathBlaster?: {
      resetProfile: () => void;
      addCurrency: (amount?: number) => void;
      unlockAll: () => void;
    };
  }
}

/**
 * Dev-only console helpers for testing the skill tree without grinding -
 * only attached in dev builds (see Game.svelte's onMount, gated on
 * import.meta.env.DEV so this never ships in a production bundle).
 * Mutates the live profile object in place so Svelte's reactivity picks
 * it up immediately - no reload needed.
 */
export function installSkillTreeDebugTools(profile: PlayerProfile): void {
  window.pixelMathBlaster = {
    resetProfile(): void {
      const empty = createEmptyProfile();
      profile.currency = empty.currency;
      profile.skillProgress = empty.skillProgress;
      profile.skillSubProgress = empty.skillSubProgress;
      savePlayerProfile(profile);
      console.log('[pixelMathBlaster] profile reset - currency and every skill back to 0.');
    },
    addCurrency(amount = 1000): void {
      profile.currency += amount;
      savePlayerProfile(profile);
      console.log(`[pixelMathBlaster] +${amount} currency - now ${profile.currency}.`);
    },
    unlockAll(): void {
      const progress: Record<string, number> = {};
      for (const node of BASE_SKILL_NODES) progress[node.id] = node.maxLevel;
      profile.skillProgress = progress;
      profile.skillSubProgress = {};
      savePlayerProfile(profile);
      console.log('[pixelMathBlaster] every skill maxed out.');
    },
  };
  console.log(
    '[pixelMathBlaster] debug tools ready - pixelMathBlaster.resetProfile() / .addCurrency(1000) / .unlockAll()'
  );
}
