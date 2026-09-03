#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { summarizeSample } = require('../lib/statistics.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const REPORT_FILE_ENV = 'POKECLICKER_DUNGEON_REPORT_FILE';

function usage() {
  return 'Usage: ./simulators/dungeon/compare.cjs BASELINE CANDIDATE [simulator options]\n\nRuns both dungeon.js revisions with identical generated maps.';
}

function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  if (argv.length < 2) throw new Error('[pokeclicker-automation] dungeon-compare: baseline and candidate paths are required');
  if (argv.includes('--automation')) throw new Error('[pokeclicker-automation] dungeon-compare: --automation is controlled by baseline and candidate paths');
  return { baseline: argv[0], candidate: argv[1], simulatorArgs: argv.slice(2) };
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
  if (result.error) throw new Error(`[pokeclicker-automation] dungeon-compare: ${label} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || `exit status ${result.status}${result.signal ? `, signal ${result.signal}` : ''}`;
    throw new Error(`[pokeclicker-automation] dungeon-compare: ${label} failed:\n${detail}`);
  }
  if (!fs.existsSync(reportFile)) throw new Error(`[pokeclicker-automation] dungeon-compare: ${label} completed without producing its report file`);
  try {
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pokeclicker-automation] dungeon-compare: ${label} produced an invalid report: ${error.message}`);
  }
}

function formatStat(stat) {
  const format = (value) => value === null ? 'n/a' : value.toFixed(3);
  return `mean=${format(stat.mean)}, median=${format(stat.median)}, p95=${format(stat.p95)}`;
}

function compareScenario(baseline, candidate) {
  if (baseline.size !== candidate.size || baseline.label !== candidate.label || JSON.stringify(baseline.settings) !== JSON.stringify(candidate.settings)) {
    throw new Error('[pokeclicker-automation] dungeon-compare: scenario configurations were not paired');
  }
  if (baseline.maps.length !== candidate.maps.length) throw new Error('[pokeclicker-automation] dungeon-compare: scenario map counts differ');
  for (let index = 0; index < baseline.maps.length; index++) {
    if (baseline.maps[index].mapHash !== candidate.maps[index].mapHash) {
      throw new Error('[pokeclicker-automation] dungeon-compare: generated maps were not paired; compare the JSON configuration and game revision');
    }
  }
  const pairs = baseline.maps.map((left, index) => ({ left, right: candidate.maps[index] }));
  const bothCompleted = pairs.filter(({ left, right }) => left.status === 'completed' && right.status === 'completed');
  const transitions = {
    bothCompleted: bothCompleted.length,
    bothTimedOut: pairs.filter(({ left, right }) => left.status === 'timedOut' && right.status === 'timedOut').length,
    completedToTimedOut: pairs.filter(({ left, right }) => left.status === 'completed' && right.status === 'timedOut').length,
    timedOutToCompleted: pairs.filter(({ left, right }) => left.status === 'timedOut' && right.status === 'completed').length,
  };
  const paired = {};
  for (const [label, field] of [
    ['completionSeconds', 'simulatedSeconds'],
    ['regularBattles', 'regularBattles'],
    ['bossBattles', 'bossBattles'],
    ['chestsOpened', 'chestsOpened'],
  ]) {
    paired[label] = summarizeSample(bothCompleted.map(({ left, right }) => right[field] - left[field]));
  }
  return { transitions, paired };
}

function printReport(baseline, candidate, comparisons) {
  console.log(`[pokeclicker-automation] dungeon-compare: Baseline:  ${baseline.automationSource.path}`);
  console.log(`[pokeclicker-automation] dungeon-compare: Candidate: ${candidate.automationSource.path}`);
  console.log(`[pokeclicker-automation] dungeon-compare: Maps per scenario: ${baseline.configuration.maps}, seed: ${baseline.configuration.seed}`);
  console.log('[pokeclicker-automation] dungeon-compare: Boards: identical official generation in every scenario');
  baseline.scenarios.forEach((scenario, index) => {
    const other = candidate.scenarios[index];
    const comparison = comparisons[index];
    console.log(`[pokeclicker-automation] dungeon-compare: Size ${scenario.size}, ${scenario.label}`);
    for (const [label, key] of [
      ['Completion seconds', 'completionSeconds'],
      ['Regular battles', 'regularBattles'],
      ['Boss battles', 'bossBattles'],
      ['Chests opened', 'chestsOpened'],
    ]) {
      console.log(`[pokeclicker-automation] dungeon-compare:   ${label}: baseline ${formatStat(scenario.distributions[key])}; candidate ${formatStat(other.distributions[key])}; paired candidate-baseline ${formatStat(comparison.paired[key])}`);
    }
    console.log(`[pokeclicker-automation] dungeon-compare:   Outcomes: both completed=${comparison.transitions.bothCompleted}, both timed out=${comparison.transitions.bothTimedOut}, completed->timed out=${comparison.transitions.completedToTimedOut}, timed out->completed=${comparison.transitions.timedOutToCompleted}`);
  });
  console.log(`[pokeclicker-automation] dungeon-compare: Policy total: ${baseline.performance.automationElapsedMs.toFixed(2)} ms -> ${candidate.performance.automationElapsedMs.toFixed(2)} ms`);
  console.log(`[pokeclicker-automation] dungeon-compare: Total runtime: ${baseline.performance.elapsedMs.toFixed(2)} ms -> ${candidate.performance.elapsedMs.toFixed(2)} ms`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(`[pokeclicker-automation] dungeon-compare: ${usage()}`);
    return;
  }
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-dungeon-compare-'));
  let baseline;
  let candidate;
  try {
    baseline = run('baseline', path.resolve(options.baseline), options.simulatorArgs, path.join(reportDir, 'baseline.json'));
    candidate = run('candidate', path.resolve(options.candidate), options.simulatorArgs, path.join(reportDir, 'candidate.json'));
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  if (JSON.stringify(baseline.configuration) !== JSON.stringify(candidate.configuration)) {
    throw new Error('[pokeclicker-automation] dungeon-compare: simulator configurations differ');
  }
  if (baseline.scenarios.length !== candidate.scenarios.length) throw new Error('[pokeclicker-automation] dungeon-compare: scenario counts differ');
  const comparisons = baseline.scenarios.map((scenario, index) => compareScenario(scenario, candidate.scenarios[index]));
  printReport(baseline, candidate, comparisons);
}

try {
  main();
} catch (error) {
  console.error(`[pokeclicker-automation] dungeon-compare: ${error.stack || error.message}`);
  process.exitCode = 1;
}
