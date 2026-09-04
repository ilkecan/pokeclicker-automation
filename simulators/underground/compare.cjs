#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { summarizeSample } = require('../lib/statistics.cjs');
const { writeReport } = require('../lib/report.cjs');

const cli = path.join(__dirname, 'cli.cjs');
const REPORT_FILE_ENV = 'POKECLICKER_UNDERGROUND_REPORT_FILE';
const METRICS = [
  ['ticksPerMine', 'ticks'],
  ['simulatedSecondsPerMine', 'simulatedSeconds'],
  ['layersRemovedPerMine', 'layersRemoved'],
  ['itemsPerMine', 'itemsFound'],
];

function usage() {
  return 'Usage: ./simulators/underground/compare.cjs --baseline PATH --candidate PATH [simulator options]\n\nRuns both underground.js revisions with identical generated per-mine boards. Successful output is minified JSON; use --pretty.';
}

function parseArgs(argv) {
  let baseline;
  let candidate;
  const simulatorArgs = [];
  let pretty = false;
  let includeMines = false;
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
    } else if (argument === '--pretty') {
      pretty = true;
    } else if (argument === '--per-mine') {
      includeMines = true;
    } else {
      simulatorArgs.push(argument);
    }
  }
  if (!baseline || !candidate) throw new Error('[pokeclicker-automation] compare: --baseline and --candidate are required');
  return { baseline, candidate, simulatorArgs, pretty, includeMines };
}

function run(label, automationPath, simulatorArgs, reportFile) {
  const result = spawnSync(process.execPath, [
    cli,
    '--automation', automationPath,
    '--per-mine',
    ...simulatorArgs,
  ], {
    encoding: 'utf8',
    env: { ...process.env, [REPORT_FILE_ENV]: reportFile },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  if (result.error) throw new Error(`[pokeclicker-automation] compare: ${label} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`[pokeclicker-automation] compare: ${label} failed:\n${result.stderr?.trim() || `exit status ${result.status}`}`);
  try {
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  } catch (error) {
    throw new Error(`[pokeclicker-automation] compare: ${label} produced an invalid report: ${error.message}`);
  }
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

function ratio(candidate, baseline) {
  return typeof candidate !== 'number' || typeof baseline !== 'number' || baseline === 0 ? null : candidate / baseline;
}

function compareMines(baselineMines, candidateMines) {
  if (baselineMines.length !== candidateMines.length) throw new Error('[pokeclicker-automation] compare: mine counts differ');
  const pairs = baselineMines.map((left, index) => ({ left, right: candidateMines[index] }));
  for (const { left, right } of pairs) {
    if (left.boardHash !== right.boardHash || left.mineIndex !== right.mineIndex) {
      throw new Error('[pokeclicker-automation] compare: generated boards were not paired; compare the JSON configuration and game revision');
    }
  }
  const baseline = summarizeMines(baselineMines);
  const candidate = summarizeMines(candidateMines);
  const pairedDelta = {};
  const ratios = {};
  for (const [name, field] of METRICS) {
    pairedDelta[name] = summarizeSample(pairs.map(({ left, right }) => right[field] - left[field]));
    ratios[name] = ratio(candidate.distributions[name].mean, baseline.distributions[name].mean);
  }
  return { baseline, candidate, pairedDelta, ratios, outcomes: { pairedMines: pairs.length } };
}

function rowReport(baseline, candidate, includeMines) {
  if (baseline.mineType !== candidate.mineType || baseline.level !== candidate.level || baseline.configurationSeed !== candidate.configurationSeed) {
    throw new Error('[pokeclicker-automation] compare: configuration rows were not paired');
  }
  const comparison = compareMines(baseline.mines, candidate.mines);
  return {
    mineType: baseline.mineType,
    level: baseline.level,
    configurationSeed: baseline.configurationSeed,
    ...comparison,
    ...(includeMines ? {
      mines: baseline.mines.map((left, index) => ({
        mineIndex: left.mineIndex,
        boardHash: left.boardHash,
        baseline: left,
        candidate: candidate.mines[index],
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
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pokeclicker-underground-compare-'));
  let baseline;
  let candidate;
  try {
    baseline = run('baseline', options.baseline, options.simulatorArgs, path.join(reportDir, 'baseline.json'));
    candidate = run('candidate', options.candidate, options.simulatorArgs, path.join(reportDir, 'candidate.json'));
  } finally {
    fs.rmSync(reportDir, { recursive: true, force: true });
  }
  if (JSON.stringify(baseline.configuration) !== JSON.stringify(candidate.configuration)) {
    throw new Error('[pokeclicker-automation] compare: simulator configurations differ');
  }
  if (baseline.configurations.length !== candidate.configurations.length) throw new Error('[pokeclicker-automation] compare: configuration counts differ');
  const configurations = baseline.configurations.map((row, index) => rowReport(row, candidate.configurations[index], options.includeMines));
  const overall = compareMines(baseline.configurations.flatMap((row) => row.mines), candidate.configurations.flatMap((row) => row.mines));
  const performance = {
    baseline: baseline.performance,
    candidate: candidate.performance,
    ratios: Object.fromEntries(Object.entries(baseline.performance).filter(([key, value]) => typeof value === 'number').map(([key, value]) => [key, ratio(candidate.performance[key], value)])),
  };
  writeReport({
    simulator: 'underground',
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
  console.error(`[pokeclicker-automation] compare: ${error.stack || error.message}`);
  process.exitCode = 1;
}
