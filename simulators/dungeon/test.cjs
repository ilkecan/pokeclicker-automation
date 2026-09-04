#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRuntime, defaultGameDir } = require('./runtime.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const compare = path.join(__dirname, 'compare.cjs');
const automation = path.resolve(__dirname, '..', '..', 'src', 'dungeon.js');

function run(extra = []) {
  const result = spawnSync(process.execPath, [cli, '--per-map', ...extra], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function expectRejected(extra, pattern) {
  const result = spawnSync(process.execPath, [cli, ...extra], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'CLI unexpectedly accepted invalid arguments');
  assert.match(result.stderr, pattern);
}

const first = run(['--single', '--maps', '2', '--size', '5', '--flash-tier', '0', '--seed', '42']);
const second = run(['--single', '--maps', '2', '--size', '5', '--flash-tier', '0', '--seed', '42']);
assert.deepEqual(first.configuration, second.configuration);
assert.deepEqual(first.configurations, second.configurations);
assert.equal(first.configurations[0].settings.fightAllBattles, false);
assert.equal(first.configurations[0].settings.openAccessibleChests, false);
assert.equal(first.configurations[0].settings.searchAllChests, false);
assert.equal(first.configurations[0].maps.length, 2);
assert.ok(first.configurations[0].maps.every((map) => /^[0-9a-f]{64}$/.test(map.mapHash)));
assert.ok(first.configurations[0].totals.completed > 0);
assert.ok(first.configurations[0].distributions.completionSeconds.median > 0);
assert.equal(first.configurations[0].distributions.regularBattles.mean, first.overall.distributions.regularBattles.mean);
assert.match(first.officialSource.moduleHashes['src/scripts/dungeons/DungeonMap.ts'], /^[0-9a-f]{64}$/);
assert.match(first.officialSource.timingSourceHashes['src/scripts/Game.ts'], /^[0-9a-f]{64}$/);

const matrix = run(['--maps', '1', '--sizes', '5,10,14', '--flash-tiers', '0,1,2,3', '--seed', '42']);
assert.equal(matrix.configurations.length, 96);
for (const size of [5, 10, 14]) {
  for (const flashTier of [0, 1, 2, 3]) {
    const rows = matrix.configurations.filter((configuration) => configuration.size === size && configuration.flashTier === flashTier);
    assert.equal(rows.length, 8);
    assert.equal(new Set(rows.map((configuration) => configuration.maps[0].mapHash)).size, 8);
  }
}
const opened = run(['--single', '--maps', '1', '--size', '10', '--open-accessible-chests', '--seed', '7']);
assert.equal(opened.configurations[0].settings.openAccessibleChests, true);

const noFlash = run(['--single', '--maps', '1', '--size', '5', '--seed', '42', '--flash-tier', '0']);
const firstFlash = run(['--single', '--maps', '1', '--size', '5', '--seed', '42', '--flash-tier', '1']);
assert.deepEqual(noFlash.configuration.flashTiers, [0]);
assert.deepEqual(firstFlash.configuration.flashTiers, [1]);
assert.equal(firstFlash.configurations[0].flashTier, 1);
assert.ok(firstFlash.officialSource.modulesLoaded.includes('src/scripts/dungeons/DungeonFlash.ts'));
assert.notEqual(noFlash.configurations[0].maps[0].simulatedSeconds, firstFlash.configurations[0].maps[0].simulatedSeconds);

expectRejected(['--single', '--flash-tier', '-1'], /flashTier must be an integer from 0 to 3/);

const timedOut = run(['--single', '--maps', '1', '--size', '5', '--battle-ticks', '100', '--boss-ticks', '100', '--seed', '42']);
assert.equal(timedOut.configurations[0].totals.timedOut, 1);
assert.equal(timedOut.configurations[0].distributions.completionSeconds.count, 0);
assert.equal(timedOut.configurations[0].distributions.completionSeconds.mean, null);

expectRejected(['--sizes', '5', '--size', '5'], /--size, --flash-tier, and policy flags require --single/);
expectRejected(['--single', '--sizes', '5'], /--sizes cannot be used with --single/);
expectRejected(['--single', '--battle-ticks', '0'], /expects a positive integer/);
expectRejected(['--single', '--size', '4'], /size must be an integer from 5 to 14/);

const comparison = spawnSync(process.execPath, [
  compare, automation, automation, '--maps', '1', '--sizes', '5', '--flash-tiers', '0,1', '--seed', '42',
], { encoding: 'utf8' });
assert.equal(comparison.status, 0, comparison.stderr || comparison.stdout);
const comparisonReport = JSON.parse(comparison.stdout);
assert.equal(comparisonReport.configurations.length, 16);
assert.equal(comparisonReport.overall.pairedDelta.completionSeconds.mean, 0);


async function testRuntimeSettings() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-dungeon-settings-'));
  const automationPath = path.join(directory, 'automation.js');
  fs.writeFileSync(automationPath, `"use strict";
const dungeon = (() => {
  function completeDungeonMap() {
    if (!AutomationSettings.getValue("dungeon", "openAccessibleChests")) {
      throw new Error("openAccessibleChests was not applied");
    }
    if (AutomationSettings.getValue("dungeon", "minimumChestTier") !== "rare") {
      throw new Error("minimumChestTier was not applied");
    }
    DungeonRunner.dungeonFinished(true);
    return [];
  }
  return { completeDungeonMap };
})();
`);
  const runtime = createRuntime({ automationPath, gameDir: defaultGameDir(), seed: 99 });
  try {
    const report = await runtime.run({
      single: true,
      maps: 1,
      size: 5,
      settings: { fightAllBattles: false, openAccessibleChests: true, searchAllChests: false },
      minimumChestTier: 'rare',
    });
    assert.equal(report.configurations[0].settings.openAccessibleChests, true);
    assert.equal(report.configurations[0].settings.minimumChestTier, 'rare');
  } finally {
    runtime.restore();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function testRuntimeLifecycle() {
  const runtime = createRuntime({ gameDir: defaultGameDir(), seed: 99 });
  try {
    const report = await runtime.run({ single: true, maps: 1, size: 5 });
    assert.equal(report.configurations.length, 1);
    await assert.rejects(runtime.run({ single: true, maps: 1, size: 5 }), /runtime can only be run once/);
  } finally {
    runtime.restore();
  }
  await assert.rejects(runtime.run({ single: true, maps: 1, size: 5 }), /runtime has been restored/);
}

testRuntimeSettings().then(() => testRuntimeLifecycle()).then(() => {
  console.log('[pokeclicker-automation] tests: dungeon simulator tests passed');
}).catch((error) => {
  console.error('[pokeclicker-automation] tests: dungeon simulator tests failed', error.stack || error);
  process.exitCode = 1;
});
