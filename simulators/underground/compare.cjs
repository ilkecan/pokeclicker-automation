#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cli = path.join(__dirname, 'cli.cjs');
const REPORT_FILE_ENV = 'POKECLICKER_UNDERGROUND_REPORT_FILE';

function usage() {
  return `Usage: ./simulators/underground/compare.cjs --baseline PATH --candidate PATH [simulator options]

Runs both underground.js revisions with identical per-mine generation seeds.
Simulator options are forwarded except --automation and --shared-rng.`;
}

function parseArgs(argv) {
  let baseline;
  let candidate;
  const simulatorArgs = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--baseline' || argument === '--candidate') {
      index += 1;
      if (index >= argv.length) throw new Error(`[pokeclicker-automation] compare: ${argument} expects a path`);
      if (argument === '--baseline') {
        if (baseline !== undefined) throw new Error('[pokeclicker-automation] compare: --baseline may only be specified once');
        baseline = argv[index];
      } else {
        if (candidate !== undefined) throw new Error('[pokeclicker-automation] compare: --candidate may only be specified once');
        candidate = argv[index];
      }
    } else if (argument === '--help') {
      return { help: true };
    } else if (argument === '--shared-rng') {
      throw new Error('[pokeclicker-automation] compare: --shared-rng cannot provide paired boards for comparison');
    } else if (argument === '--automation') {
      throw new Error('[pokeclicker-automation] compare: --automation is controlled by --baseline and --candidate');
    } else {
      simulatorArgs.push(argument);
    }
  }
  if (!baseline || !candidate) throw new Error('[pokeclicker-automation] compare: --baseline and --candidate are required');
  return { baseline, candidate, simulatorArgs };
}

function run(label, automationPath, simulatorArgs, reportFile) {
  const result = spawnSync(process.execPath, [
    cli,
    '--json',
    '--automation', automationPath,
    ...simulatorArgs.filter((argument) => argument !== '--json'),
  ], {
    encoding: 'utf8',
    env: { ...process.env, [REPORT_FILE_ENV]: reportFile },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) {
    throw new Error(`[pokeclicker-automation] compare: ${label} could not start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || `exit status ${result.status}${result.signal ? `, signal ${result.signal}` : ''}`;
    throw new Error(`[pokeclicker-automation] compare: ${label} failed:\n${detail}`);
  }
  if (!fs.existsSync(reportFile)) {
    throw new Error(`[pokeclicker-automation] compare: ${label} completed without producing its report file`);
  }
  try {
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pokeclicker-automation] compare: ${label} produced an invalid report: ${error.message}`);
  }
}

function ratio(candidate, baseline) {
  return baseline === 0 ? null : candidate / baseline;
}

function formatRatio(value) {
  return value === null ? 'n/a' : `${value.toFixed(4)}x`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`[pokeclicker-automation] compare: ${usage()}`);
    return;
  }

  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-underground-compare-'));
  let baseline;
  let candidate;
  try {
    baseline = run('baseline', options.baseline, options.simulatorArgs, path.join(reportDir, 'baseline.json'));
    candidate = run('candidate', options.candidate, options.simulatorArgs, path.join(reportDir, 'candidate.json'));
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  const baselineBoards = baseline.mines.map((mine) => mine.boardHash);
  const candidateBoards = candidate.mines.map((mine) => mine.boardHash);
  if (JSON.stringify(baselineBoards) !== JSON.stringify(candidateBoards)) {
    throw new Error('[pokeclicker-automation] compare: generated boards were not paired; compare the JSON configuration and game revision');
  }
  const comparisons = {
    ticks: ratio(candidate.totals.ticks, baseline.totals.ticks),
    layersRemoved: ratio(candidate.totals.layersRemoved, baseline.totals.layersRemoved),
    itemsDestroyed: ratio(candidate.totals.itemsDestroyed, baseline.totals.itemsDestroyed),
    automationSetupTime: ratio(candidate.performance.automationSetupElapsedMs, baseline.performance.automationSetupElapsedMs),
    automationActionTime: ratio(candidate.performance.automationActionElapsedMs, baseline.performance.automationActionElapsedMs),
    automationActionTimePerTick: ratio(candidate.performance.automationActionMicrosecondsPerTick, baseline.performance.automationActionMicrosecondsPerTick),
    automationTime: ratio(candidate.performance.automationElapsedMs, baseline.performance.automationElapsedMs),
    wallTime: ratio(candidate.performance.elapsedMs, baseline.performance.elapsedMs),
  };

  console.log(`[pokeclicker-automation] compare: Baseline:  ${baseline.automationSource.path}`);
  console.log(`[pokeclicker-automation] compare: Candidate: ${candidate.automationSource.path}`);
  console.log(`[pokeclicker-automation] compare: Mines: ${baseline.configuration.mines}, seed: ${baseline.configuration.seed}, level: ${baseline.configuration.level}`);
  console.log('[pokeclicker-automation] compare: Boards: identical official generation in both runs');
  console.log(`[pokeclicker-automation] compare: Ticks: ${baseline.totals.ticks} -> ${candidate.totals.ticks} (${formatRatio(comparisons.ticks)}, lower is better)`);
  console.log(`[pokeclicker-automation] compare: Layers removed: ${baseline.totals.layersRemoved} -> ${candidate.totals.layersRemoved} (${formatRatio(comparisons.layersRemoved)})`);
  console.log(`[pokeclicker-automation] compare: Items destroyed: ${baseline.totals.itemsDestroyed} -> ${candidate.totals.itemsDestroyed} (${formatRatio(comparisons.itemsDestroyed)}, lower is better)`);
  console.log(`[pokeclicker-automation] compare: Policy setup: ${baseline.performance.automationSetupElapsedMs.toFixed(2)} ms -> ${candidate.performance.automationSetupElapsedMs.toFixed(2)} ms (${formatRatio(comparisons.automationSetupTime)}, lower is better)`);
  console.log(`[pokeclicker-automation] compare: Policy actions: ${baseline.performance.automationActionElapsedMs.toFixed(2)} ms -> ${candidate.performance.automationActionElapsedMs.toFixed(2)} ms (${formatRatio(comparisons.automationActionTime)}, lower is better)`);
  console.log(`[pokeclicker-automation] compare: Policy action time/tick: ${baseline.performance.automationActionMicrosecondsPerTick.toFixed(2)} us -> ${candidate.performance.automationActionMicrosecondsPerTick.toFixed(2)} us (${formatRatio(comparisons.automationActionTimePerTick)}, lower is better)`);
  console.log(`[pokeclicker-automation] compare: Policy total: ${baseline.performance.automationElapsedMs.toFixed(2)} ms -> ${candidate.performance.automationElapsedMs.toFixed(2)} ms (${formatRatio(comparisons.automationTime)})`);
  console.log(`[pokeclicker-automation] compare: Total runtime: ${baseline.performance.elapsedMs.toFixed(2)} ms -> ${candidate.performance.elapsedMs.toFixed(2)} ms (${formatRatio(comparisons.wallTime)})`);
}

try {
  main();
} catch (error) {
  console.error(`[pokeclicker-automation] compare: ${error.stack || error.message}`);
  process.exitCode = 1;
}
