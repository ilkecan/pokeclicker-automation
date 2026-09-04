#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { summarizeSample } = require('../lib/statistics.cjs');
const { writeReport } = require('../lib/report.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const REPORT_FILE_ENV = 'POKECLICKER_DUNGEON_REPORT_FILE';
const METRICS = [
  ['completionSeconds', 'simulatedSeconds'],
  ['regularBattles', 'regularBattles'],
  ['bossBattles', 'bossBattles'],
  ['chestsOpened', 'chestsOpened'],
];

function usage() {
  return 'Usage: ./simulators/dungeon/compare.cjs BASELINE CANDIDATE [simulator options]\n\nRuns both dungeon.js revisions with identical generated maps. Successful output is minified JSON; use --pretty.';
}

function parseArgs(argv) {
  if (argv.includes('--help')) return { help: true };
  if (argv.length < 2) throw new Error('[pokeclicker-automation] dungeon-compare: baseline and candidate paths are required');
  if (argv.includes('--automation')) throw new Error('[pokeclicker-automation] dungeon-compare: --automation is controlled by baseline and candidate paths');
  const pretty = argv.includes('--pretty');
  const includeMaps = argv.includes('--per-map');
  const simulatorArgs = argv.slice(2).filter((argument) => argument !== '--pretty');
  return { baseline: argv[0], candidate: argv[1], simulatorArgs, pretty, includeMaps };
}

function run(label, automationPath, simulatorArgs, reportFile) {
  const result = spawnSync(process.execPath, [
    cli,
    '--automation', automationPath,
    '--per-map',
    ...simulatorArgs.filter((argument) => argument !== '--per-map'),
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

function summarizeResults(results) {
  const completed = results.filter((result) => result.status === 'completed');
  const sum = (field) => results.reduce((total, result) => total + result[field], 0);
  return {
    totals: {
      maps: results.length,
      completed: completed.length,
      timedOut: results.length - completed.length,
      ticks: sum('ticks'),
      simulatedSeconds: sum('simulatedSeconds'),
      regularBattles: sum('regularBattles'),
      bossBattles: sum('bossBattles'),
      chestsOpened: sum('chestsOpened'),
    },
    distributions: {
      completionSeconds: summarizeSample(completed.map((result) => result.simulatedSeconds)),
      regularBattles: summarizeSample(results.map((result) => result.regularBattles)),
      bossBattles: summarizeSample(results.map((result) => result.bossBattles)),
      chestsOpened: summarizeSample(results.map((result) => result.chestsOpened)),
    },
  };
}

function ratio(candidate, baseline) {
  return typeof candidate !== 'number' || typeof baseline !== 'number' || baseline === 0 ? null : candidate / baseline;
}

function compareResults(baselineResults, candidateResults) {
  if (baselineResults.length !== candidateResults.length) throw new Error('[pokeclicker-automation] dungeon-compare: scenario map counts differ');
  const pairs = baselineResults.map((left, index) => ({ left, right: candidateResults[index] }));
  for (const { left, right } of pairs) {
    if (left.mapHash !== right.mapHash || left.mapSeed !== right.mapSeed) {
      throw new Error('[pokeclicker-automation] dungeon-compare: generated maps were not paired; compare the JSON configuration and game revision');
    }
  }
  const bothCompleted = pairs.filter(({ left, right }) => left.status === 'completed' && right.status === 'completed');
  const outcomes = {
    bothCompleted: bothCompleted.length,
    bothTimedOut: pairs.filter(({ left, right }) => left.status === 'timedOut' && right.status === 'timedOut').length,
    completedToTimedOut: pairs.filter(({ left, right }) => left.status === 'completed' && right.status === 'timedOut').length,
    timedOutToCompleted: pairs.filter(({ left, right }) => left.status === 'timedOut' && right.status === 'completed').length,
  };
  const pairedDelta = {};
  const ratios = {};
  const baselineSummary = summarizeResults(baselineResults);
  const candidateSummary = summarizeResults(candidateResults);
  for (const [name, field] of METRICS) {
    const population = name === 'completionSeconds' ? bothCompleted : pairs;
    pairedDelta[name] = summarizeSample(population.map(({ left, right }) => right[field] - left[field]));
    ratios[name] = ratio(candidateSummary.distributions[name].mean, baselineSummary.distributions[name].mean);
  }
  return { baseline: baselineSummary, candidate: candidateSummary, pairedDelta, ratios, outcomes };
}

function configurationReport(baseline, candidate, includeMaps) {
  if (baseline.size !== candidate.size || baseline.flashTier !== candidate.flashTier || baseline.configurationSeed !== candidate.configurationSeed || JSON.stringify(baseline.settings) !== JSON.stringify(candidate.settings)) {
    throw new Error('[pokeclicker-automation] dungeon-compare: configuration rows were not paired');
  }
  const comparison = compareResults(baseline.maps, candidate.maps);
  return {
    size: baseline.size,
    flashTier: baseline.flashTier,
    configurationSeed: baseline.configurationSeed,
    settings: baseline.settings,
    ...comparison,
    ...(includeMaps ? {
      maps: baseline.maps.map((left, index) => ({
        mapIndex: left.mapIndex,
        mapSeed: left.mapSeed,
        mapHash: left.mapHash,
        baseline: left,
        candidate: candidate.maps[index],
      })),
    } : {}),
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
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
  if (baseline.configurations.length !== candidate.configurations.length) throw new Error('[pokeclicker-automation] dungeon-compare: configuration counts differ');
  const configurations = baseline.configurations.map((row, index) => configurationReport(row, candidate.configurations[index], options.includeMaps));
  const allBaseline = baseline.configurations.flatMap((row) => row.maps);
  const allCandidate = candidate.configurations.flatMap((row) => row.maps);
  const overall = compareResults(allBaseline, allCandidate);
  const performance = {
    baseline: baseline.performance,
    candidate: candidate.performance,
    ratios: Object.fromEntries(Object.entries(baseline.performance)
      .filter(([, value]) => typeof value === 'number')
      .map(([key, value]) => [key, value === 0 ? null : candidate.performance[key] / value])),
  };
  writeReport({
    simulator: 'dungeon',
    kind: 'comparison',
    configuration: baseline.configuration,
    officialSource: { baseline: baseline.officialSource, candidate: candidate.officialSource },
    baseline: { automationSource: baseline.automationSource },
    candidate: { automationSource: candidate.automationSource },
    performance,
    overall,
    configurations,
  }, { pretty: options.pretty });
}

try {
  main();
} catch (error) {
  console.error(`[pokeclicker-automation] dungeon-compare: ${error.stack || error.message}`);
  process.exitCode = 1;
}
