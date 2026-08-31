#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createVirtualClock } = require('../lib/virtual-clock.cjs');
const { createRuntime, defaultGameDir } = require('./runtime.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const compare = path.join(__dirname, 'compare.cjs');
const automation = path.resolve(__dirname, '..', '..', 'src', 'underground.js');

function run(seed, extra = []) {
  const result = spawnSync(process.execPath, [cli, '--json', '--mines', '4', '--seed', String(seed), ...extra], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function expectComparisonRejection(extra, pattern) {
  const result = spawnSync(process.execPath, [
    compare,
    '--baseline', automation,
    '--candidate', automation,
    ...extra,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'comparison unexpectedly accepted an option override');
  assert.match(result.stderr, pattern);
}

function expectCliRejection(extra, pattern) {
  const result = spawnSync(process.execPath, [cli, ...extra], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'simulator unexpectedly accepted invalid arguments');
  assert.match(result.stderr, pattern);
}

function testSuccessfulComparison() {
  const result = spawnSync(process.execPath, [
    compare,
    '--baseline', automation,
    '--candidate', automation,
    '--mines', '1',
    '--seed', '42',
    '--no-battery',
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Boards: identical official generation in both runs/);
  assert.match(result.stdout, /Policy setup:/);
  assert.match(result.stdout, /Policy actions:/);
}

async function testVirtualClock() {
  const originalSetTimeout = () => 'original timeout';
  const originalClearTimeout = () => 'original clear';
  const target = { setTimeout: originalSetTimeout, clearTimeout: originalClearTimeout };
  const clock = createVirtualClock();
  const events = [];
  clock.installGlobalTimers(target);

  const cancelled = target.setTimeout(() => events.push('cancelled'), 50);
  target.clearTimeout(cancelled);
  target.setTimeout(() => events.push('timer-at-100'), 100);

  let event = clock.advanceToNext(100, () => events.push('game-tick-at-100'));
  assert.equal(event.type, 'external');
  assert.deepEqual(events, ['game-tick-at-100']);

  event = clock.advanceToNext(200, () => events.push('unexpected-game-tick'));
  assert.equal(event.type, 'timer');
  await event.pendingMicrotasks;
  assert.deepEqual(events, ['game-tick-at-100', 'timer-at-100']);

  target.setTimeout(() => events.push('first-same-time-timer'), 10);
  target.setTimeout(() => events.push('second-same-time-timer'), 10);
  for (const expected of ['first-same-time-timer', 'second-same-time-timer']) {
    event = clock.advanceToNext(200, () => events.push('unexpected-game-tick'));
    assert.equal(event.type, 'timer');
    await event.pendingMicrotasks;
    assert.equal(events.at(-1), expected);
  }
  assert.equal(clock.timerCallbackCount, 3);
  assert.equal(clock.hasPendingTimers, false);

  clock.restoreGlobalTimers();
  assert.equal(target.setTimeout, originalSetTimeout);
  assert.equal(target.clearTimeout, originalClearTimeout);
}

async function testRuntimeLifecycle() {
  const gameDir = defaultGameDir();
  const ko = require(path.join(gameDir, 'node_modules', 'knockout'));
  const originalDeferUpdates = ko.options.deferUpdates;
  const runtime = createRuntime({
    level: 0,
    maxDischargeFrames: 1,
    seed: 99,
  });
  assert.equal(ko.options.deferUpdates, true);
  try {
    await assert.rejects(runtime.run({ mines: 1, maxTicks: 0 }), /maxTicks must be a positive integer/);
    await assert.rejects(runtime.run({ mines: 4 }), /battery discharge exceeded 1 frames/);
    await assert.rejects(runtime.run({ mines: 1 }), /runtime can only be run once/);
  } finally {
    runtime.restore();
  }
  assert.equal(ko.options.deferUpdates, originalDeferUpdates);
  await assert.rejects(runtime.run({ mines: 1 }), /runtime has been restored/);
  let taskRanAfterRestore = false;
  ko.tasks.schedule(() => { taskRanAfterRestore = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(taskRanAfterRestore, true);
}

const first = run(314159);
const second = run(314159);

assert.deepEqual(first.configuration, second.configuration);
assert.deepEqual(first.totals, second.totals);
assert.deepEqual(first.averages, second.averages);
assert.deepEqual(first.mines, second.mines);
assert.equal(first.totals.itemsFound, first.totals.itemsBuried);
assert.equal(first.mines.length, 4);
assert.equal(first.configuration.pairedBoards, true);
assert.ok(first.mines.every((mine) => /^[0-9a-f]{64}$/.test(mine.boardHash)));
assert.ok(first.totals.ticks > 0);
assert.ok(first.totals.layersRemoved > 0);
assert.ok(first.performance.automationElapsedMs > 0);
assert.ok(first.performance.automationSetupElapsedMs > 0);
assert.ok(first.performance.automationSetupMicrosecondsPerMine > 0);
assert.ok(first.performance.automationActionElapsedMs > 0);
assert.ok(first.performance.automationActionMicrosecondsPerTick > 0);
assert.equal(
  first.performance.automationElapsedMs,
  first.performance.automationSetupElapsedMs + first.performance.automationActionElapsedMs,
);
assert.match(first.officialSource.timingSourceHashes['src/scripts/App.ts'], /^[0-9a-f]{64}$/);
assert.match(first.officialSource.timingSourceHashes['src/scripts/Game.ts'], /^[0-9a-f]{64}$/);
assert.ok(first.officialSource.dirty === true || first.officialSource.dirty === false);
assert.deepEqual(Object.keys(first.officialSource.moduleHashes), first.officialSource.modulesLoaded);
assert.ok(Object.values(first.officialSource.moduleHashes).every((hash) => /^[0-9a-f]{64}$/.test(hash)));

for (const required of [
  'src/modules/underground/mine/Mine.ts',
  'src/modules/underground/UndergroundItems.ts',
  'src/modules/underground/tools/UndergroundTools.ts',
  'src/modules/underground/UndergroundController.ts',
  'src/modules/underground/UndergroundBattery.ts',
  'src/modules/utilities/SeededRand.ts',
]) {
  assert.ok(first.officialSource.modulesLoaded.includes(required), `official module was not executed: ${required}`);
  assert.match(first.officialSource.moduleHashes[required], /^[0-9a-f]{64}$/);
}

const noBattery = run(271828, ['--trace-timing', '--no-battery', '--mine-type', 'Fossil', '--level', '0']);
assert.equal(noBattery.configuration.battery, false);
assert.equal(noBattery.totals.itemsFound, noBattery.totals.itemsBuried);
assert.deepEqual(noBattery.totals.batteryDischarges, {});
assert.ok(noBattery.mines.every((mine) => mine.discoverySeconds === 900));
assert.equal(
  noBattery.totals.discoverySeconds,
  noBattery.mines.reduce((total, mine) => total + mine.discoverySeconds, 0),
);
assert.ok(noBattery.mines.slice(1).some((mine) => Object.keys(mine.timingTrace.toolDurabilityBeforeDiscovery)
  .some((tool) => mine.timingTrace.toolDurabilityBeforeDiscovery[tool] < 1 &&
    mine.timingTrace.toolDurabilityAfterDiscovery[tool] === 1)));

const timedBattery = run(314159, ['--trace-timing', '--mine-type', 'Fossil', '--level', '30']);
assert.ok(timedBattery.mines.every((mine) => mine.discoverySeconds === 600));
const dischargeTraces = timedBattery.mines.flatMap((mine) => mine.timingTrace.batteryDischarges);
const chargedFirstFrames = dischargeTraces.filter((trace) => trace.chargesAfterFirstFrame > 0);
assert.ok(chargedFirstFrames.length > 0);
assert.ok(chargedFirstFrames.every((trace) => trace.cooldownAfterFirstFrame === 1));
assert.ok(dischargeTraces.some((trace) =>
  trace.completedAtMilliseconds - trace.startedAtMilliseconds > 1000 &&
  trace.chargesAfterCompletion > trace.chargesAfterFirstFrame));

const sharedRandom = run(161803, ['--shared-rng', '--no-battery']);
assert.equal(sharedRandom.configuration.pairedBoards, false);
assert.equal(sharedRandom.totals.itemsFound, sharedRandom.totals.itemsBuried);

expectComparisonRejection(['--automation', automation], /--automation is controlled/);
expectComparisonRejection(['--baseline', automation], /--baseline may only be specified once/);
expectComparisonRejection(['--candidate', automation], /--candidate may only be specified once/);
expectCliRejection(['--max-ticks', '0'], /--max-ticks expects a positive integer/);
expectCliRejection(['--max-ticks', '-1'], /--max-ticks expects a positive integer/);
testSuccessfulComparison();

Promise.all([testVirtualClock(), testRuntimeLifecycle()]).then(() => {
  console.log('[pokeclicker-automation] tests: simulator tests passed');
}).catch((error) => {
  console.error('[pokeclicker-automation] tests: simulator tests failed', error.stack || error);
  process.exitCode = 1;
});
