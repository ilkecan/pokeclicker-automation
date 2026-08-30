# Test harness

This directory contains the shared test harness for loading official game dependencies and evaluating automation scripts in isolated VM contexts.

## Usage

Pass the Node.js test context to `createHarness`. The harness registers cleanup with `t.after()` so it runs when the test finishes, including after a failure:

```js
const test = require('node:test');
const { createHarness } = require('./lib/harness.cjs');

test('loads an automation script', (t) => {
  const harness = createHarness(t);
  const loaded = harness.loadAutomation('name');
  // use loaded.automation and loaded.context
});
```

`createHarness(t)` provides:

- `loadAutomation(name, globals, exportName)`: evaluates the common runtime source and the named automation source.
- `loadScripts(paths, globals, resultExpression)`: evaluates repository scripts in a fresh VM context.
- `addCleanup(callback)`: registers an additional cleanup callback.
- `dispose()`: runs cleanup immediately and is safe to call more than once.
- `gameDir`, `projectDir`: resolved repository paths.

Use `dispose()` only when a caller needs cleanup before the test ends.
