#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRuntime, defaultGameDir } = require('./runtime.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const compare = path.join(__dirname, 'compare.cjs');
const automation = path.resolve(__dirname, '..', '..', 'src', 'dungeon.js');

function run(extra = []) {
  const result = spawnSync(process.execPath, [cli, '--json', ...extra], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function expectRejected(extra, pattern) {
  const result = spawnSync(process.execPath, [cli, ...extra], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'CLI unexpectedly accepted invalid arguments');
  assert.match(result.stderr, pattern);
}

const first = run(['--single', '--maps', '2', '--size', '5', '--seed', '42']);
const second = run(['--single', '--maps', '2', '--size', '5', '--seed', '42']);
assert.deepEqual(first.configuration, second.configuration);
assert.deepEqual(first.scenarios, second.scenarios);
assert.equal(first.scenarios[0].settings.fightAllBattles, false);
assert.equal(first.scenarios[0].settings.openAccessibleChests, false);
assert.equal(first.scenarios[0].settings.searchAllChests, false);
assert.equal(first.scenarios[0].maps.length, 2);
assert.ok(first.scenarios[0].maps.every((map) => /^[0-9a-f]{64}$/.test(map.mapHash)));
assert.ok(first.scenarios[0].totals.completed > 0);
assert.ok(first.scenarios[0].distributions.completionSeconds.median > 0);
assert.equal(first.scenarios[0].distributions.regularBattles.mean, first.scenarios[0].averages.regularBattles);
assert.match(first.officialSource.moduleHashes['src/scripts/dungeons/DungeonMap.ts'], /^[0-9a-f]{64}$/);
assert.match(first.officialSource.timingSourceHashes['src/scripts/Game.ts'], /^[0-9a-f]{64}$/);

const matrix = run(['--maps', '1', '--sizes', '5,10,14', '--seed', '42']);
assert.equal(matrix.scenarios.length, 24);
assert.deepEqual(matrix.scenarios.slice(0, 8).map((scenario) => scenario.label), [
  'basic', 'fight', 'open', 'fight+open', 'search', 'fight+search', 'open+search', 'fight+open+search',
]);
for (const size of [5, 10, 14]) {
  const rows = matrix.scenarios.filter((scenario) => scenario.size === size);
  assert.equal(rows.length, 8);
  assert.equal(new Set(rows.map((scenario) => scenario.maps[0].mapHash)).size, 1);
}

const opened = run(['--single', '--maps', '1', '--size', '10', '--open-accessible-chests', '--seed', '7']);
assert.ok(opened.scenarios[0].maps[0].chestsOpened > 0);

const noFlash = run(['--single', '--maps', '1', '--size', '5', '--seed', '42', '--dungeon-clears', '0']);
const firstFlash = run(['--single', '--maps', '1', '--size', '5', '--seed', '42', '--dungeon-clears', '100']);
assert.equal(noFlash.configuration.dungeonClears, 0);
assert.equal(firstFlash.configuration.dungeonClears, 100);
assert.ok(firstFlash.officialSource.modulesLoaded.includes('src/scripts/dungeons/DungeonFlash.ts'));
assert.notEqual(noFlash.scenarios[0].maps[0].simulatedSeconds, firstFlash.scenarios[0].maps[0].simulatedSeconds);

expectRejected(['--single', '--dungeon-clears', '-1'], /dungeonClears must be a non-negative integer/);

const timedOut = run(['--single', '--maps', '1', '--size', '5', '--battle-ticks', '100', '--boss-ticks', '100', '--seed', '42']);
assert.equal(timedOut.scenarios[0].totals.timedOut, 1);
assert.equal(timedOut.scenarios[0].distributions.completionSeconds.count, 0);
assert.equal(timedOut.scenarios[0].distributions.completionSeconds.mean, null);

expectRejected(['--sizes', '5', '--size', '5'], /--size and policy flags require --single/);
expectRejected(['--single', '--sizes', '5'], /--sizes cannot be used with --single/);
expectRejected(['--single', '--battle-ticks', '0'], /expects a positive integer/);
expectRejected(['--single', '--size', '4'], /size must be an integer from 5 to 14/);

const comparison = spawnSync(process.execPath, [
  compare, automation, automation, '--maps', '1', '--sizes', '5', '--seed', '42',
], { encoding: 'utf8' });
assert.equal(comparison.status, 0, comparison.stderr || comparison.stdout);
assert.match(comparison.stdout, /Boards: identical official generation/);
assert.match(comparison.stdout, /paired candidate-baseline mean=0\.000/);

async function testRuntimeLifecycle() {
  const runtime = createRuntime({ gameDir: defaultGameDir(), seed: 99 });
  try {
    const report = await runtime.run({ single: true, maps: 1, size: 5 });
    assert.equal(report.scenarios.length, 1);
    await assert.rejects(runtime.run({ single: true, maps: 1, size: 5 }), /runtime can only be run once/);
  } finally {
    runtime.restore();
  }
  await assert.rejects(runtime.run({ single: true, maps: 1, size: 5 }), /runtime has been restored/);
}

testRuntimeLifecycle().then(() => {
  console.log('[pokeclicker-automation] tests: dungeon simulator tests passed');
}).catch((error) => {
  console.error('[pokeclicker-automation] tests: dungeon simulator tests failed', error.stack || error);
  process.exitCode = 1;
});
