'use strict';

const crypto = require('node:crypto');

function deriveConfigurationSeed(rootSeed, simulator, configuration) {
  if (!Number.isSafeInteger(rootSeed)) {
    throw new TypeError(`[pokeclicker-automation] seeding: root seed must be a safe integer, got ${rootSeed}`);
  }
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify({ rootSeed, simulator, configuration }))
    .digest();
  return digest.readUInt32BE(0);
}

module.exports = { deriveConfigurationSeed };
