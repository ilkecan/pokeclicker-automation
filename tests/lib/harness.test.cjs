'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
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
  const first = harness.loadScripts(['src/lib.js'], {}, '_and');
  const second = harness.loadScripts(['src/lib.js'], {}, '_and');
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

test('loadAutomation provides the real settings store with no mock', (t) => {
  const harness = createHarness(t);
  const loaded = harness.loadAutomation('gym', {});
  assert.equal(loaded.sourcePath, path.join(harness.projectDir, 'src', 'automation', 'gym.js'));
  const settings = loaded.settings;
  assert.deepEqual(
    [...settings.sections.map((section) => section.id)],
    ['dungeon', 'farm', 'gym', 'hatchery', 'items', 'quests', 'purifyChamber', 'safari', 'shop', 'underground'],
  );
  assert.equal(settings.getValue('gym', 'autoRestart'), true);
  settings.value('gym', 'autoRestart')(false);
  assert.equal(settings.getValue('gym', 'autoRestart'), false);
  assert.equal(settings.isEnabled('gym'), true);
  settings.enabled('gym')(false);
  assert.equal(settings.isEnabled('gym'), false);
  assert.throws(() => settings.getValue('gym', 'noSuchOption'), /unknown gym automation option/);
});
