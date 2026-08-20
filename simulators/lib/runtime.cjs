'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

function assertFile(filename, description) {
  if (!fs.existsSync(filename)) {
    throw new Error(`${description} not found: ${filename}`);
  }
}

function defaultImport(value) {
  return { __esModule: true, default: value };
}

function canonicalModulePath(filename) {
  return path.normalize(filename).replace(/\.ts$/, '');
}

function installTypeScriptLoader(gameDir, mocks) {
  const typescriptPath = path.join(gameDir, 'node_modules', 'typescript');
  assertFile(path.join(typescriptPath, 'package.json'), 'The game TypeScript dependency');
  const ts = require(typescriptPath);
  const loaded = new Set();
  const oldTsLoader = Module._extensions['.ts'];
  const oldLoad = Module._load;

  Module._extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        target: ts.ScriptTarget.ES2020,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
    });
    loaded.add(path.relative(gameDir, filename));
    module._compile(output.outputText, filename);
  };

  Module._load = function loadWithSimulatorMocks(request, parent, isMain) {
    if (parent && request.startsWith('.')) {
      const requestedPath = canonicalModulePath(path.resolve(path.dirname(parent.filename), request));
      if (mocks.has(requestedPath)) {
        return mocks.get(requestedPath);
      }
    }
    return oldLoad.call(this, request, parent, isMain);
  };

  return {
    loaded,
    restore() {
      Module._load = oldLoad;
      if (oldTsLoader) {
        Module._extensions['.ts'] = oldTsLoader;
      } else {
        delete Module._extensions['.ts'];
      }
    },
  };
}

function evaluateScope(filename, exportedNames) {
  assertFile(filename, 'JavaScript source');
  const source = fs.readFileSync(filename, 'utf8');
  const exports = exportedNames.join(', ');
  return vm.runInThisContext(`(() => {\n${source}\nreturn { ${exports} };\n})()`, { filename });
}

function createOfficialRandom(Rand, SeededRand, initialSeed) {
  const originalNext = Rand.next;
  Rand.next = () => SeededRand.next();
  SeededRand.seed(initialSeed);

  return {
    seed(value) {
      SeededRand.seed(value);
    },
    restore() {
      Rand.next = originalNext;
    },
  };
}

function createDeepConstant() {
  const proxy = new Proxy(() => {}, {
    get: () => proxy,
    apply: () => undefined,
  });
  return proxy;
}

function sha256(filename) {
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}

function gitRevision(repositoryDir) {
  try {
    return execFileSync('git', ['-C', repositoryDir, 'rev-parse', '--short=12', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (_error) {
    return null;
  }
}

function gitWorktreeDirty(repositoryDir) {
  try {
    return execFileSync('git', ['-C', repositoryDir, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).length > 0;
  } catch (_error) {
    return null;
  }
}

module.exports = {
  assertFile,
  canonicalModulePath,
  createDeepConstant,
  createOfficialRandom,
  defaultImport,
  evaluateScope,
  gitRevision,
  gitWorktreeDirty,
  installTypeScriptLoader,
  sha256,
};
