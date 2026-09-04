'use strict';

const fs = require('node:fs');

function serializeReport(report, pretty = false) {
  const json = JSON.stringify(report, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError(`[pokeclicker-automation] report: cannot serialize non-finite number ${value}`);
    }
    return value;
  }, pretty ? 2 : undefined);
  if (json === undefined) {
    throw new TypeError('[pokeclicker-automation] report: report must be JSON-serializable');
  }
  return `${json}\n`;
}

function writeReport(report, { file, pretty = false } = {}) {
  const json = serializeReport(report, pretty);
  if (file) {
    fs.writeFileSync(file, json);
  } else {
    process.stdout.write(json);
  }
}

module.exports = { serializeReport, writeReport };
