'use strict';

function summarizeSample(values) {
  if (!Array.isArray(values)) {
    throw new TypeError('[pokeclicker-automation] statistics: sample must be an array');
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('[pokeclicker-automation] statistics: sample values must be finite numbers');
  }

  const count = values.length;
  if (count === 0) {
    return { count: 0, mean: null, median: null, p95: null };
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(count / 2);
  const median = count % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
  const p95 = sorted[Math.ceil(count * 0.95) - 1];
  const mean = sorted.reduce((sum, value) => sum + value, 0) / count;

  return { count, mean, median, p95 };
}

module.exports = { summarizeSample };
