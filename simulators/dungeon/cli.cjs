#!/usr/bin/env node
'use strict';

const { createRuntime, defaultAutomationPath, defaultGameDir } = require('./runtime.cjs');
const { writeReport } = require('../lib/report.cjs');

const REPORT_FILE_ENV = 'POKECLICKER_DUNGEON_REPORT_FILE';

function usage() {
  return `Usage: ./simulators/dungeon/cli.cjs [options]

Runs src/dungeon.js against official PokéClicker dungeon map and runner code.
Successful output is minified JSON; use --pretty for indented JSON.

Options:
  --maps N                  Maps per configuration (default: 250)
  --seed N                  Deterministic random seed (default: 1)
  --sizes LIST              Matrix sizes (default: 5,10,14)
  --flash-tiers LIST        Matrix flash tiers (default: 0,1,2,3)
  --single                  Run one policy configuration instead of the matrix
  --size N                  Single-mode map size (default: 5)
  --flash-tier N            Single-mode flash tier, 0 to 3 (default: 0)
  --fight-all-battles       Single-mode policy setting
  --open-accessible-chests  Single-mode policy setting
  --search-all-chests       Single-mode policy setting
  --minimum-chest-tier NAME Minimum chest tier to open (default: common)
  --chest-tier NAME         Generated chest tier (default: common)
  --battle-ticks N          Regular battle duration in battle ticks (default: 1)
  --boss-ticks N            Boss battle duration in battle ticks (default: 1)
  --game-dir PATH           PokéClicker checkout (default: ${defaultGameDir()})
  --automation PATH         dungeon.js revision to test (default: ${defaultAutomationPath()})
  --pretty                  Indent JSON with two spaces
  --per-map                 Include individual map results in JSON
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

function parseList(name, value) {
  const list = String(value).split(',').map((item) => parseInteger(name, item));
  if (!list.length || new Set(list).size !== list.length) {
    throw new Error(`[pokeclicker-automation] dungeon-cli: ${name} expects a comma-separated list without duplicates, got ${value}`);
  }
  return list;
}

function parseArgs(argv) {
  const options = {
    maps: 250,
    seed: 1,
    sizes: [5, 10, 14],
    flashTiers: [0, 1, 2, 3],
    single: false,
    size: 5,
    flashTier: 0,
    settings: { fightAllBattles: false, openAccessibleChests: false, searchAllChests: false },
    chestTier: 'common',
    minimumChestTier: 'common',
    battleTicks: 1,
    bossTicks: 1,
    pretty: false,
    includeMaps: false,
    sizesSpecified: false,
    sizeSpecified: false,
    flashTiersSpecified: false,
    flashTierSpecified: false,
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
      case '--sizes': options.sizes = parseList(argument, next()); options.sizesSpecified = true; break;
      case '--flash-tiers': options.flashTiers = parseList(argument, next()); options.flashTiersSpecified = true; break;
      case '--single': options.single = true; break;
      case '--size': options.size = parseInteger(argument, next()); options.sizeSpecified = true; break;
      case '--flash-tier': options.flashTier = parseInteger(argument, next()); options.flashTierSpecified = true; break;
      case '--fight-all-battles': options.settings.fightAllBattles = true; options.settingSpecified = true; break;
      case '--open-accessible-chests': options.settings.openAccessibleChests = true; options.settingSpecified = true; break;
      case '--search-all-chests': options.settings.searchAllChests = true; options.settingSpecified = true; break;
      case '--minimum-chest-tier': options.minimumChestTier = next(); break;
      case '--chest-tier': options.chestTier = next(); break;
      case '--battle-ticks': options.battleTicks = parsePositiveInteger(argument, next()); break;
      case '--boss-ticks': options.bossTicks = parsePositiveInteger(argument, next()); break;
      case '--game-dir': options.gameDir = next(); break;
      case '--automation': options.automationPath = next(); break;
      case '--pretty': options.pretty = true; break;
      case '--per-map': options.includeMaps = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`[pokeclicker-automation] dungeon-cli: unknown option: ${argument}`);
    }
  }
  if (options.single && options.sizesSpecified) throw new Error('[pokeclicker-automation] dungeon-cli: --sizes cannot be used with --single');
  if (options.single && options.flashTiersSpecified) throw new Error('[pokeclicker-automation] dungeon-cli: --flash-tiers cannot be used with --single');
  if (!options.single && (options.sizeSpecified || options.flashTierSpecified || options.settingSpecified)) {
    throw new Error('[pokeclicker-automation] dungeon-cli: --size, --flash-tier, and policy flags require --single');
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const runtime = createRuntime(options);
  try {
    const report = await runtime.run(options);
    writeReport(report, { file: process.env[REPORT_FILE_ENV], pretty: options.pretty });
  } finally {
    runtime.restore();
  }
}

main().catch((error) => {
  console.error(`[pokeclicker-automation] dungeon-cli: ${error.stack || error.message}`);
  process.exitCode = 1;
});
