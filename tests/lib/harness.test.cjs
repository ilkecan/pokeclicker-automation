'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createHarness } = require('./harness.cjs');
const { installTypeScriptLoader } = require('../../lib/runtime.cjs');

test('loads official game dependencies', (t) => {
  const harness = createHarness(t);
  assert.equal(typeof harness.game.GameConstants, 'object');
  assert.equal(typeof harness.game.PokemonType, 'object');
  assert.equal(typeof harness.game.ko.observable, 'function');
});

test('creates isolated script contexts', (t) => {
  const harness = createHarness(t);
  const first = harness.loadScripts(['src/common.js'], {}, '_and');
  const second = harness.loadScripts(['src/common.js'], {}, '_and');
  first.context.marker = true;
  assert.equal(second.context.marker, undefined);
  assert.equal(typeof first.value, 'function');
  assert.notEqual(first.context, second.context);
});

test('runs registered cleanup through the Node test context', async (t) => {
  let cleaned = false;
  await t.test('fixture cleanup', (t) => {
    const harness = createHarness(t);
    harness.addCleanup(() => {
      cleaned = true;
    });
  });
  assert.equal(cleaned, true);
});

test('restores the TypeScript loader', (t) => {
  const harness = createHarness(t);
  const originalLoader = require('node:module')._extensions['.ts'];
  const loader = installTypeScriptLoader(harness.gameDir, new Map());
  loader.restore();
  assert.equal(require('node:module')._extensions['.ts'], originalLoader);
});
