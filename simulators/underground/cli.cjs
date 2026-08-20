#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { createRuntime, defaultAutomationPath, defaultGameDir } = require('./runtime.cjs');

const REPORT_FILE_ENV = 'POKECLICKER_UNDERGROUND_REPORT_FILE';

function usage() {
  return `Usage: ./simulators/underground/cli.cjs [options]

Runs src/underground.js against the official PokéClicker TypeScript mining code.

Options:
  --mines N              Number of sequential mines (default: 100)
  --seed N               Deterministic random seed (default: 1)
  --level N              Fixed Underground level (default: 0)
  --region N             Highest unlocked region, 0 to 9 (default: 7)
  --mine-type NAME       Random, Diamond, GemPlate, Shard, Fossil,
                         EvolutionItem, or Special (default: Random)
  --game-dir PATH        PokéClicker checkout (default: ${defaultGameDir()})
  --automation PATH      underground.js revision to test
                         (default: ${defaultAutomationPath()})
  --max-ticks N          Safety limit per mine (default: 100000)
  --no-battery           Disable battery charging and discharge
  --shared-rng           Use one continuous official SeededRand stream
  --trace-timing         Include detailed virtual-time diagnostics in JSON
  --json                 Print machine-readable JSON
  --per-mine             Include one summary line per mine
  --help                 Show this help

The game checkout must have its npm dependencies installed because the harness
uses that checkout's own TypeScript and Knockout packages.`;
}

function parseInteger(name, value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${name} expects an integer, got ${value}`);
  return parsed;
}

function parsePositiveInteger(name, value) {
  const parsed = parseInteger(name, value);
  if (parsed < 1) throw new Error(`${name} expects a positive integer, got ${value}`);
  return parsed;
}

function parseArgs(argv) {
  const options = {
    mines: 100,
    seed: 1,
    level: 0,
    region: 7,
    mineType: 'Random',
    maxTicks: 100000,
    battery: true,
    pairedBoards: true,
    json: false,
    perMine: false,
  };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${argument} expects a value`);
      return argv[index];
    };
    switch (argument) {
      case '--mines': options.mines = parsePositiveInteger(argument, next()); break;
      case '--seed': options.seed = parseInteger(argument, next()); break;
      case '--level': options.level = parseInteger(argument, next()); break;
      case '--region': options.region = parseInteger(argument, next()); break;
      case '--mine-type': options.mineType = next(); break;
      case '--game-dir': options.gameDir = next(); break;
      case '--automation': options.automationPath = next(); break;
      case '--max-ticks': options.maxTicks = parsePositiveInteger(argument, next()); break;
      case '--no-battery': options.battery = false; break;
      case '--shared-rng': options.pairedBoards = false; break;
      case '--trace-timing': options.traceTiming = true; break;
      case '--json': options.json = true; break;
      case '--per-mine': options.perMine = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`unknown option: ${argument}`);
    }
  }
  return options;
}

function formatCounter(counter, names) {
  const entries = Object.entries(counter).map(([key, value]) => [names?.[key] || key, value]);
  return entries.length ? entries.map(([key, value]) => `${key}=${value}`).join(', ') : 'none';
}

function printReport(report, perMine) {
  const { configuration, totals, averages, performance, officialSource, automationSource } = report;
  const toolNames = { 0: 'chisel', 1: 'hammer', 2: 'bomb', 3: 'survey' };
  console.log(`Simulated ${configuration.mines} ${configuration.mineType} mine(s) at level ${configuration.level}`);
  const dirtyMarker = officialSource.dirty === true ? ' (dirty worktree)' : '';
  console.log(`Official game: ${officialSource.revision || 'unknown revision'}${dirtyMarker} at ${officialSource.gameDir}`);
  console.log(`Automation: ${automationSource.path}`);
  console.log(`Completed: ${totals.itemsFound}/${totals.itemsBuried} items in ${totals.ticks} ticks`);
  console.log(`Virtual time: ${totals.simulatedSeconds.toFixed(3)} seconds (${totals.discoverySeconds.toFixed(3)} discovering mines)`);
  console.log(`Average: ${averages.ticksPerMine.toFixed(3)} ticks/mine, ${averages.layersRemovedPerMine.toFixed(3)} layers/mine`);
  console.log(`Rewards: gained=${totals.itemsGained}, destroyed=${totals.itemsDestroyed}`);
  console.log(`Tools: ${formatCounter(totals.toolsUsed, toolNames)}`);
  console.log(`Battery: ${formatCounter(totals.batteryDischarges)}`);
  console.log(`Policy setup: ${performance.automationSetupElapsedMs.toFixed(2)} ms, ${performance.automationSetupMicrosecondsPerMine.toFixed(2)} microseconds/mine`);
  console.log(`Policy actions: ${performance.automationActionElapsedMs.toFixed(2)} ms, ${performance.automationActionMicrosecondsPerTick.toFixed(2)} microseconds/tick`);
  console.log(`Policy total: ${performance.automationElapsedMs.toFixed(2)} ms`);
  console.log(`Total runtime: ${performance.elapsedMs.toFixed(2)} ms, ${performance.minesPerSecond.toFixed(2)} mines/s`);
  console.log(`Official TypeScript modules loaded: ${officialSource.modulesLoaded.length}`);
  if (perMine) {
    report.mines.forEach((mine, index) => {
      console.log(`#${index + 1} ${mine.mineType}: ticks=${mine.ticks}, items=${mine.itemsFound}, layers=${mine.layersRemoved}, tools=[${formatCounter(mine.toolsUsed, toolNames)}]`);
    });
  }
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
    if (options.json) {
      const json = JSON.stringify(report, null, 2);
      const reportFile = process.env[REPORT_FILE_ENV];
      if (reportFile) {
        fs.writeFileSync(reportFile, json);
      } else {
        console.log(json);
      }
    } else {
      printReport(report, options.perMine);
    }
  } finally {
    runtime.restore();
  }
}

main().catch((error) => {
  console.error(`simulator: ${error.stack || error.message}`);
  process.exitCode = 1;
});
