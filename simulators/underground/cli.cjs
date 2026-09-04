#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntime, defaultAutomationPath, defaultGameDir } = require('./runtime.cjs');
const { summarizeSample } = require('../lib/statistics.cjs');
const { writeReport } = require('../lib/report.cjs');

const REPORT_FILE_ENV = 'POKECLICKER_UNDERGROUND_REPORT_FILE';
const MINE_TYPES = ['Random', 'Diamond', 'GemPlate', 'Shard', 'Fossil', 'EvolutionItem', 'Special'];
const DEFAULT_LEVELS = [0, 10, 20, 30, 40, 50];
const DEFAULT_MINES = 25;

function usage() {
  return `Usage: ./simulators/underground/cli.cjs [options]

Runs underground.js against official PokéClicker mining code.
Successful output is minified JSON; use --pretty for indented JSON.

Options:
  --mines N              Mines per configuration (default: 25)
  --seed N               Deterministic random seed (default: 1)
  --mine-types LIST      Matrix mine types (default: Random,Diamond,GemPlate,Shard,Fossil,EvolutionItem,Special)
  --levels LIST          Matrix Underground levels (default: 0,10,20,30,40,50)
  --single               Run one configuration instead of the matrix
  --mine-type NAME       Single-mode mine type (default: Random)
  --level N              Single-mode Underground level (default: 0)
  --region N             Highest unlocked region, 0 to 9 (default: 7)
  --game-dir PATH        PokéClicker checkout (default: ${defaultGameDir()})
  --automation PATH      underground.js revision to test (default: ${defaultAutomationPath()})
  --max-ticks N          Safety limit per mine (default: 100000)
  --no-battery           Disable battery charging and discharge
  --shared-rng           Use one continuous official SeededRand stream (single mode only)
  --trace-timing         Include detailed virtual-time diagnostics in JSON
  --pretty               Indent JSON with two spaces
  --per-mine             Include individual mine results in JSON
  --help                 Show this help

The game checkout must have its npm dependencies installed because the harness
uses that checkout's own TypeScript and Knockout packages.`;
}

function parseInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`[pokeclicker-automation] underground-cli: ${name} expects an integer, got ${value}`);
  return parsed;
}

function parsePositiveInteger(name, value) {
  const parsed = parseInteger(name, value);
  if (parsed < 1) throw new Error(`[pokeclicker-automation] underground-cli: ${name} expects a positive integer, got ${value}`);
  return parsed;
}

function parseList(name, value, parser) {
  const list = String(value).split(',').map((item) => parser(name, item));
  if (!list.length || new Set(list).size !== list.length) {
    throw new Error(`[pokeclicker-automation] underground-cli: ${name} expects a comma-separated list without duplicates, got ${value}`);
  }
  return list;
}

function parseMineType(name, value) {
  const match = MINE_TYPES.find((type) => type.toLowerCase() === String(value).toLowerCase());
  if (!match) throw new Error(`[pokeclicker-automation] underground-cli: ${name} must be one of ${MINE_TYPES.join(', ')}, got ${value}`);
  return match;
}

function parseArgs(argv) {
  const options = {
    mines: DEFAULT_MINES,
    seed: 1,
    mineTypes: [...MINE_TYPES],
    levels: [...DEFAULT_LEVELS],
    single: false,
    mineType: 'Random',
    level: 0,
    region: 7,
    maxTicks: 100000,
    battery: true,
    pairedBoards: true,
    traceTiming: false,
    pretty: false,
    includeMines: false,
    mineTypesSpecified: false,
    levelsSpecified: false,
    mineTypeSpecified: false,
    levelSpecified: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`[pokeclicker-automation] underground-cli: ${argument} expects a value`);
      return argv[index];
    };
    switch (argument) {
      case '--mines': options.mines = parsePositiveInteger(argument, next()); break;
      case '--seed': options.seed = parseInteger(argument, next()); break;
      case '--mine-types': options.mineTypes = parseList(argument, next(), parseMineType); options.mineTypesSpecified = true; break;
      case '--levels': options.levels = parseList(argument, next(), parseInteger); options.levelsSpecified = true; break;
      case '--single': options.single = true; break;
      case '--mine-type': options.mineType = parseMineType(argument, next()); options.mineTypeSpecified = true; break;
      case '--level': options.level = parseInteger(argument, next()); options.levelSpecified = true; break;
      case '--region': options.region = parseInteger(argument, next()); break;
      case '--game-dir': options.gameDir = next(); break;
      case '--automation': options.automationPath = next(); break;
      case '--max-ticks': options.maxTicks = parsePositiveInteger(argument, next()); break;
      case '--no-battery': options.battery = false; break;
      case '--shared-rng': options.pairedBoards = false; break;
      case '--trace-timing': options.traceTiming = true; break;
      case '--pretty': options.pretty = true; break;
      case '--per-mine': options.includeMines = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`[pokeclicker-automation] underground-cli: unknown option: ${argument}`);
    }
  }
  if (options.single && options.mineTypesSpecified) throw new Error('[pokeclicker-automation] underground-cli: --mine-types cannot be used with --single');
  if (options.single && options.levelsSpecified) throw new Error('[pokeclicker-automation] underground-cli: --levels cannot be used with --single');
  if (!options.single && (options.mineTypeSpecified || options.levelSpecified)) {
    throw new Error('[pokeclicker-automation] underground-cli: --mine-type and --level require --single');
  }
  return options;
}

function summarizeMines(mines) {
  const sum = (field) => mines.reduce((total, mine) => total + mine[field], 0);
  const sumCounters = (field) => mines.reduce((total, mine) => {
    for (const [key, value] of Object.entries(mine[field] || {})) total[key] = (total[key] || 0) + value;
    return total;
  }, {});
  return {
    totals: {
      mines: mines.length,
      ticks: sum('ticks'),
      simulatedSeconds: sum('simulatedSeconds'),
      discoverySeconds: sum('discoverySeconds'),
      itemsBuried: sum('itemsBuried'),
      itemsFound: sum('itemsFound'),
      itemsGained: sum('itemsGained'),
      itemsDestroyed: sum('itemsDestroyed'),
      layersRemoved: sum('layersRemoved'),
      layersLeft: sum('layersLeft'),
      toolsUsed: sumCounters('toolsUsed'),
      batteryDischarges: sumCounters('batteryDischarges'),
    },
    distributions: {
      ticksPerMine: summarizeSample(mines.map((mine) => mine.ticks)),
      simulatedSecondsPerMine: summarizeSample(mines.map((mine) => mine.simulatedSeconds)),
      layersRemovedPerMine: summarizeSample(mines.map((mine) => mine.layersRemoved)),
      itemsPerMine: summarizeSample(mines.map((mine) => mine.itemsFound)),
    },
  };
}

function workerArgs(options, mineType, level, seed) {
  const args = ['--single', '--mines', String(options.mines), '--seed', String(seed), '--mine-type', mineType, '--level', String(level), '--region', String(options.region), '--max-ticks', String(options.maxTicks), '--per-mine'];
  if (options.gameDir) args.push('--game-dir', options.gameDir);
  if (options.automationPath) args.push('--automation', options.automationPath);
  if (!options.battery) args.push('--no-battery');
  if (options.traceTiming) args.push('--trace-timing');
  return args;
}

function runWorker(options, mineType, level, seed, reportFile) {
  const result = spawnSync(process.execPath, [__filename, ...workerArgs(options, mineType, level, seed)], {
    encoding: 'utf8',
    env: { ...process.env, [REPORT_FILE_ENV]: reportFile },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw new Error(`[pokeclicker-automation] underground-cli: worker could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`[pokeclicker-automation] underground-cli: worker failed:\n${result.stderr?.trim() || `exit status ${result.status}`}`);
  try {
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pokeclicker-automation] underground-cli: worker produced an invalid report: ${error.message}`);
  }
}

function runMatrix(options) {
  if (!options.pairedBoards) throw new Error('[pokeclicker-automation] underground-cli: --shared-rng is only supported with --single');
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) throw new Error('[pokeclicker-automation] underground-cli: seed must be a non-negative safe integer');
  const started = process.hrtime.bigint();
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-underground-matrix-'));
  const allMines = [];
  const configurations = [];
  let automationSetupElapsedMs = 0;
  let automationActionElapsedMs = 0;
  let officialSource;
  let automationSource;
  try {
    for (const level of options.levels) {
      for (const mineType of options.mineTypes) {
        const worker = runWorker(options, mineType, level, options.seed, path.join(reportDir, `${configurations.length}.json`));
        const row = worker.configurations[0];
        allMines.push(...row.mines);
        configurations.push({ mineType, level, configurationSeed: row.configurationSeed, totals: row.totals, distributions: row.distributions, ...(options.includeMines ? { mines: row.mines } : {}) });
        automationSetupElapsedMs += worker.performance.automationSetupElapsedMs;
        automationActionElapsedMs += worker.performance.automationActionElapsedMs;
        officialSource ||= worker.officialSource;
        automationSource ||= worker.automationSource;
      }
    }
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const mines = allMines;
  const overall = summarizeMines(mines);
  return {
    simulator: 'underground',
    kind: 'run',
    configuration: {
      mode: 'matrix', seed: options.seed, mines: options.mines,
      mineTypes: [...options.mineTypes], levels: [...options.levels],
      region: options.region, battery: options.battery, pairedBoards: true,
      maxTicks: options.maxTicks,
    },
    performance: {
      elapsedMs,
      automationSetupElapsedMs,
      automationSetupMicrosecondsPerMine: automationSetupElapsedMs * 1000 / (options.mines * configurations.length),
      automationActionElapsedMs,
      automationActionMicrosecondsPerTick: overall.totals.ticks === 0 ? 0 : automationActionElapsedMs * 1000 / overall.totals.ticks,
      automationElapsedMs: automationSetupElapsedMs + automationActionElapsedMs,
      minesPerSecond: configurations.length * options.mines / (elapsedMs / 1000),
    },
    officialSource,
    automationSource,
    overall,
    configurations,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  if (!options.single) {
    writeReport(runMatrix(options), { file: process.env[REPORT_FILE_ENV], pretty: options.pretty });
    return;
  }
  const runtime = createRuntime(options);
  try {
    const report = await runtime.run({ ...options, includeMines: options.includeMines });
    writeReport(report, { file: process.env[REPORT_FILE_ENV], pretty: options.pretty });
  } finally {
    runtime.restore();
  }
}

main().catch((error) => {
  console.error(`[pokeclicker-automation] underground-cli: ${error.stack || error.message}`);
  process.exitCode = 1;
});
