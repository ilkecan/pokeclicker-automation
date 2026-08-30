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
    loadScripts(relativePaths, globals = {}, resultExpression) {
      const filenames = relativePaths.map((relativePath) => path.resolve(projectDir, relativePath));
      const result = evaluateScripts(
        filenames,
        {
          ...game,
          ...globals,
        },
        resultExpression,
      );
      return {
        ...result,
        sourcePaths: filenames,
      };
    },
    loadAutomation(name, globals = {}, exportName = name) {
      const result = harness.loadScripts(
        ['src/common.js', `src/${name}.js`],
        globals,
        exportName,
      );
      return {
        automation: result.value,
        context: result.context,
        sourcePath: result.sourcePaths.at(-1),
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
