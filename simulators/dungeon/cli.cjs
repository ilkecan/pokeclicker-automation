#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createRuntime, defaultAutomationPath, defaultGameDir } = require('./runtime.cjs');

const REPORT_FILE_ENV = 'POKECLICKER_DUNGEON_REPORT_FILE';

function usage() {
  return `Usage: ./simulators/dungeon/cli.cjs [options]

Runs src/dungeon.js against official PokéClicker dungeon map and runner code.

Options:
  --maps N                  Maps per scenario (default: 1000)
  --seed N                  Deterministic random seed (default: 1)
  --sizes LIST              Matrix sizes (default: 5,10,14)
  --single                  Run one policy configuration instead of the matrix
  --size N                  Single-mode map size (default: 5)
  --fight-all-battles       Single-mode policy setting
  --open-accessible-chests  Single-mode policy setting
  --search-all-chests       Single-mode policy setting
  --minimum-chest-tier NAME Minimum chest tier to open (default: common)
  --chest-tier NAME         Generated chest tier (default: common)
  --battle-ticks N          Regular battle duration in battle ticks (default: 1)
  --boss-ticks N            Boss battle duration in battle ticks (default: 1)
  --game-dir PATH           PokéClicker checkout (default: ${defaultGameDir()})
  --automation PATH         dungeon.js revision to test (default: ${defaultAutomationPath()})
  --json                    Print machine-readable JSON
  --per-map                 Include one summary line per map
  --help                    Show this help

The game checkout must have its npm dependencies installed because the harness
uses that checkout's own TypeScript and Knockout packages.`;
}

function parseInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`[pokeclicker-automation] dungeon-cli: ${name} expects an integer, got ${value}`);
  return parsed;
}

function parsePositiveInteger(name, value) {
  const parsed = parseInteger(name, value);
  if (parsed < 1) throw new Error(`[pokeclicker-automation] dungeon-cli: ${name} expects a positive integer, got ${value}`);
  return parsed;
}

function parseSizes(value) {
  const sizes = String(value).split(',').map((item) => parseInteger('--sizes', item));
  if (!sizes.length || sizes.some((size) => size < 1)) throw new Error(`[pokeclicker-automation] dungeon-cli: --sizes expects a comma-separated list of positive integers, got ${value}`);
  return sizes;
}

function parseArgs(argv) {
  const options = {
    maps: 1000,
    seed: 1,
    sizes: [5, 10, 14],
    single: false,
    size: 5,
    settings: { fightAllBattles: false, openAccessibleChests: false, searchAllChests: false },
    chestTier: 'common',
    minimumChestTier: 'common',
    battleTicks: 1,
    bossTicks: 1,
    json: false,
    perMap: false,
    sizesSpecified: false,
    sizeSpecified: false,
    settingSpecified: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`[pokeclicker-automation] dungeon-cli: ${argument} expects a value`);
      return argv[index];
    };
    switch (argument) {
      case '--maps': options.maps = parsePositiveInteger(argument, next()); break;
      case '--seed': options.seed = parseInteger(argument, next()); break;
      case '--sizes': options.sizes = parseSizes(next()); options.sizesSpecified = true; break;
      case '--single': options.single = true; break;
      case '--size': options.size = parseInteger(argument, next()); options.sizeSpecified = true; break;
      case '--fight-all-battles': options.settings.fightAllBattles = true; options.settingSpecified = true; break;
      case '--open-accessible-chests': options.settings.openAccessibleChests = true; options.settingSpecified = true; break;
      case '--search-all-chests': options.settings.searchAllChests = true; options.settingSpecified = true; break;
      case '--minimum-chest-tier': options.minimumChestTier = next(); break;
      case '--chest-tier': options.chestTier = next(); break;
      case '--battle-ticks': options.battleTicks = parsePositiveInteger(argument, next()); break;
      case '--boss-ticks': options.bossTicks = parsePositiveInteger(argument, next()); break;
      case '--game-dir': options.gameDir = next(); break;
      case '--automation': options.automationPath = next(); break;
      case '--json': options.json = true; break;
      case '--per-map': options.perMap = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`[pokeclicker-automation] dungeon-cli: unknown option: ${argument}`);
    }
  }
  if (options.single && options.sizesSpecified) throw new Error('[pokeclicker-automation] dungeon-cli: --sizes cannot be used with --single');
  if (!options.single && (options.sizeSpecified || options.settingSpecified)) {
    throw new Error('[pokeclicker-automation] dungeon-cli: --size and policy flags require --single');
  }
  return options;
}

function formatStat(stat, digits = 3) {
  const format = (value) => value === null ? 'n/a' : value.toFixed(digits);
  return `mean=${format(stat.mean)}, median=${format(stat.median)}, p95=${format(stat.p95)}`;
}

function printReport(report, perMap) {
  const { configuration, performance, officialSource, automationSource } = report;
  console.log(`[pokeclicker-automation] dungeon-cli: Simulated ${configuration.maps} map(s) per ${configuration.mode === 'matrix' ? 'scenario' : 'configuration'} (${report.scenarios.length} scenario(s))`);
  const dirtyMarker = officialSource.dirty === true ? ' (dirty worktree)' : '';
  console.log(`[pokeclicker-automation] dungeon-cli: Official game: ${officialSource.revision || 'unknown revision'}${dirtyMarker} at ${officialSource.gameDir}`);
  console.log(`[pokeclicker-automation] dungeon-cli: Automation: ${automationSource.path}`);
  for (const scenario of report.scenarios) {
    const { totals, distributions } = scenario;
    console.log(`[pokeclicker-automation] dungeon-cli: Size ${scenario.size}, ${scenario.label}: completed=${totals.completed}/${totals.maps} (${(totals.completed * 100 / totals.maps).toFixed(2)}%), timed out=${totals.timedOut}`);
    console.log(`[pokeclicker-automation] dungeon-cli:   Completion seconds: ${formatStat(distributions.completionSeconds)}`);
    console.log(`[pokeclicker-automation] dungeon-cli:   Regular battles: ${formatStat(distributions.regularBattles)}`);
    console.log(`[pokeclicker-automation] dungeon-cli:   Boss battles: ${formatStat(distributions.bossBattles)}`);
    console.log(`[pokeclicker-automation] dungeon-cli:   Chests opened: ${formatStat(distributions.chestsOpened)}`);
    if (perMap) {
      for (const result of scenario.maps) {
        console.log(`[pokeclicker-automation] dungeon-cli:   #${result.mapIndex + 1} ${result.status}: seconds=${result.simulatedSeconds.toFixed(3)}, battles=${result.regularBattles}, boss=${result.bossBattles}, chests=${result.chestsOpened}, hash=${result.mapHash}`);
      }
    }
  }
  console.log(`[pokeclicker-automation] dungeon-cli: Policy setup: ${performance.automationSetupElapsedMs.toFixed(2)} ms, ${performance.automationSetupMicrosecondsPerMap.toFixed(2)} microseconds/map`);
  console.log(`[pokeclicker-automation] dungeon-cli: Policy actions: ${performance.automationActionElapsedMs.toFixed(2)} ms, ${performance.automationActionMicrosecondsPerCallback.toFixed(2)} microseconds/callback`);
  console.log(`[pokeclicker-automation] dungeon-cli: Policy total: ${performance.automationElapsedMs.toFixed(2)} ms`);
  console.log(`[pokeclicker-automation] dungeon-cli: Total runtime: ${performance.elapsedMs.toFixed(2)} ms, ${performance.mapsPerSecond.toFixed(2)} maps/s`);
  console.log(`[pokeclicker-automation] dungeon-cli: Official TypeScript sources loaded: ${officialSource.modulesLoaded.length}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`[pokeclicker-automation] dungeon-cli: ${usage()}`);
    return;
  }
  const runtime = createRuntime(options);
  try {
    const report = await runtime.run(options);
    if (options.json) {
      const json = JSON.stringify(report, null, 2);
      const reportFile = process.env[REPORT_FILE_ENV];
      if (reportFile) fs.writeFileSync(reportFile, json);
      else console.log(json);
    } else {
      printReport(report, options.perMap);
    }
  } finally {
    runtime.restore();
  }
}

main().catch((error) => {
  console.error(`[pokeclicker-automation] dungeon-cli: ${error.stack || error.message}`);
  process.exitCode = 1;
});
