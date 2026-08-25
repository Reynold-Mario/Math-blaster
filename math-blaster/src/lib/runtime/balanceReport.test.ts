/**
 * Not an assertion suite - a report. It prints where runs currently end for
 * each modelled player; you read the numbers, not a pass/fail.
 *
 *   BALANCE_REPORT=1 npx jest balanceReport
 *
 * Opt-in because it always passes and would otherwise dump a wall of tables
 * into every ordinary test run. The properties worth *failing* on live in
 * gameFlow.test.ts and waveProgression.test.ts instead.
 */

import { SIM_PLAYERS, simulateRun, summarize, waveProfile, type RunResult } from './balanceSim';

const RUNS = 60;
const enabled = process.env.BALANCE_REPORT === '1';

(enabled ? describe : describe.skip)('balance report', () => {
  it('prints run outcomes and the per-wave shape of a run', () => {
    const summaryRows: Record<string, string | number>[] = [];

    for (const player of SIM_PLAYERS) {
      const runs: RunResult[] = Array.from({ length: RUNS }, (_, i) =>
        simulateRun(player, 1000 + i * 7919)
      );
      const s = summarize(player, runs);
      summaryRows.push({
        player: s.player,
        p10: s.p10Wave,
        median: s.medianWave,
        p90: s.p90Wave,
        mean: Number(s.meanWave.toFixed(1)),
        'past w5': `${Math.round(s.pastFirstBoss * 100)}%`,
        'past w10': `${Math.round(s.pastSecondBoss * 100)}%`,
        'boss win': `${Math.round(s.bossWinRate * 100)}%`,
        'boss kill': `${Math.round(s.bossMasteryRate * 100)}%`,
        'run sec': Math.round(s.meanRunSec),
      });

      // eslint-disable-next-line no-console
      console.log(`\n--- ${player.name}: per-wave averages ---`);
      // eslint-disable-next-line no-console
      console.table(
        waveProfile(runs, 14).map((w) => ({
          wave: `${w.waveNumber}${w.isBoss ? ' B' : ''}`,
          sent: Number(w.released.toFixed(1)),
          killed: Number(w.defeated.toFixed(1)),
          leaked: Number(w.leaked.toFixed(1)),
          sec: Number(w.elapsedSec.toFixed(1)),
          'paid s': Number((w.bonusMs / 1000).toFixed(1)),
          'clock in': Number(w.clockAtStartSec.toFixed(1)),
          'clock out': Number(w.clockAtEndSec.toFixed(1)),
        }))
      );
    }

    // eslint-disable-next-line no-console
    console.log('\n=== WHERE RUNS END ===');
    // eslint-disable-next-line no-console
    console.table(summaryRows);
    expect(summaryRows).toHaveLength(SIM_PLAYERS.length);
  });
});
