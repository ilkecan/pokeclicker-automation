'use strict';

const path = require('node:path');
const {
  assertFile,
  evaluateScripts,
  installTypeScriptLoader,
  resolveGameDir,
} = require('../../lib/runtime.cjs');

const projectDir = path.resolve(__dirname, '..', '..');
const gameDir = resolveGameDir(projectDir);
const modulesDir = path.join(gameDir, 'src', 'modules');
const loader = installTypeScriptLoader(gameDir);
let game;
try {
  const knockoutPath = path.join(gameDir, 'node_modules', 'knockout');
  assertFile(path.join(knockoutPath, 'package.json'), 'The game Knockout dependency');
  game = {
    ko: require(knockoutPath),
    GameConstants: require(path.join(modulesDir, 'GameConstants.ts')),
    PokemonType: require(path.join(modulesDir, 'enums', 'PokemonType.ts')).default,
  };
} finally {
  loader.restore();
}

function createSettingsDefaults() {
  const storage = { value: null };
  return {
    Save: { key: 'test' },
    localStorage: {
      getItem: () => storage.value,
      setItem: (_key, value) => {
        storage.value = String(value);
      },
    },
    ItemList: new Proxy({}, {
      get: (_target, itemName) => ({ displayName: String(itemName).replaceAll('_', ' ') }),
    }),
  };
}

function withItemDisplayNames(itemList) {
  // settings/definitions.js reads ItemList[<shop item>].displayName at load. A test
  // that provides its own ItemList keeps it; missing entries fall back to a display
  // name so definitions load regardless of the fixture's coverage.
  const target = itemList ?? {};
  return new Proxy(target, {
    get: (inner, name) => {
      if (typeof name !== 'string' || name in Object(inner)) return inner[name];
      return { displayName: name.replaceAll('_', ' ') };
    },
  });
}

function createHarness(t) {
  const cleanups = [];
  let disposed = false;

  const harness = {
    game,
    gameDir,
    projectDir,
    addCleanup(cleanup) {
      if (typeof cleanup !== 'function') throw new TypeError('cleanup must be a function');
      cleanups.push(cleanup);
      return cleanup;
    },
    loadScripts(relativePaths, globals = {}, resultExpression, scriptName) {
      const filenames = relativePaths.map((relativePath) => path.resolve(projectDir, relativePath));
      const result = evaluateScripts(
        filenames,
        {
          ...game,
          ...globals,
        },
        resultExpression,
        scriptName,
      );
      return {
        ...result,
        sourcePaths: filenames,
      };
    },
    loadAutomation(name, globals = {}, exportName = name) {
      // Automation runs against the real settings store, not a hand-rolled mock, so
      // any AutomationSettings method works in a fresh file with no per-test setup.
      // settings/definitions.js reads dungeon.ChestTier, shop.ITEM_NAMES, and
      // ItemList display names at load, hence the real dungeon/shop sources below.
      // The target is already among them when it is dungeon or shop.
      const target = `src/automation/${name}.js`;
      const filenames = ['src/lib.js', 'src/automation/dungeon.js', 'src/automation/shop.js'];
      if (!filenames.includes(target)) filenames.push(target);
      filenames.push('src/settings/definitions.js', 'src/settings/store.js');
      const defaults = createSettingsDefaults();
      const result = harness.loadScripts(
        filenames,
        {
          ...defaults,
          ...game,
          ...globals,
          ItemList: withItemDisplayNames(globals.ItemList ?? defaults.ItemList),
        },
        `({ automation: ${exportName}, settings: AutomationSettings })`,
        path.resolve(projectDir, target),
      );
      result.value.settings.initialize();
      return {
        automation: result.value.automation,
        settings: result.value.settings,
        context: result.context,
        sourcePath: result.sourcePaths[filenames.indexOf(target)],
      };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      let firstError;
      for (const cleanup of cleanups.reverse()) {
        try {
          await cleanup();
        } catch (error) {
          firstError ||= error;
        }
      }
      if (firstError) throw firstError;
    },
  };

  t?.after(() => harness.dispose());
  return harness;
}

module.exports = { createHarness };
