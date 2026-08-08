'use strict';

// Loads this repo's userscript into a running `pokeclicker`/`pokeclicker-desktop`
// Electron process without touching either package's Nix derivation:
//
//   NODE_OPTIONS="--require=$(pwd)/inject.cjs" pokeclicker
//
// This file only knows about "index.user.js": it reads that file's `@require`
// header lines to discover every other file/URL to load, in order. It doesn't
// need to change when the scripts do.

const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.join(__dirname, 'src');
const entryPath = path.join(srcDir, 'index.user.js');

// Re-read fresh on every injection (see did-finish-load below) rather than once
// here, so edits to the scripts are picked up on the next reload without
// restarting the whole Electron process.
function readEntrySource() {
  return fs.readFileSync(entryPath, 'utf8');
}

function matchPatternToRegExp(pattern) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${pattern.split('*').map(escape).join('.*')}$`);
}

function getMatches(entrySource) {
  return [...entrySource.matchAll(/^\/\/\s*@match\s+(\S+)/gm)]
    .map((m) => matchPatternToRegExp(m[1]));
}

const remoteCache = new Map();

async function fetchRemote(url) {
  if (remoteCache.has(url)) {
    return remoteCache.get(url);
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch @require ${url}: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  // Only cache on success: a failed fetch isn't remembered, so the next reload
  // retries instead of staying broken for the rest of this process's lifetime.
  remoteCache.set(url, text);
  return text;
}

async function getRequires(entrySource) {
  const requires = [...entrySource.matchAll(/^\/\/\s*@require\s+(\S+)/gm)].map((m) => m[1]);
  // Fetched/read up front and inlined as text below, the same way for both local
  // and remote requires. This matches how real userscript managers handle @require,
  // removes any local vs remote behavioral difference. Remote fetches are cached
  // in-memory for this process's lifetime, so repeated page reloads don't
  // re-fetch over the network every time.
  return Promise.all(requires.map((req) =>
    /^https?:\/\//.test(req)
      ? fetchRemote(req)
      : fs.readFileSync(path.join(srcDir, req), 'utf8'),
  ));
}

async function buildPayload(entrySource) {
  const parts = await getRequires(entrySource);

  return `(function() {
  async function run() {
    // Guarantees strict mode here regardless of @require order/content, unlike
    // under real userscript managers where it depends on the first-concatenated
    // file/require declaring it. A stricter runtime here is a pure bug catching
    // mechanism, not a behavioral guarantee this environment makes to the other
    // one. Both run the same source, so a mistake strict mode catches here gets
    // fixed at the source and the fix is correct in both regardless of the
    // other's strict-mode status.
    "use strict";

    // Deliberately not wrapped in per-file blocks: real userscript managers
    // concatenate all @require sources into one script, so top-level function
    // declarations across files are mutually hoisted regardless of order.
    ${parts.join('\n')}
    ${entrySource}
    console.log('[pokeclicker-scripts] injected OK');
  }

  // did-finish-load fires after window "load", which is strictly after DOMContentLoaded,
  // which can't fire until every blocking <head> script (where Game/GameLoadState etc.
  // get defined) has already executed. So by the time this handler runs, they're
  // already defined, no readiness poll needed. This relies on the Electron wrapper's
  // main.js navigating directly to the real game page, with no intermediate
  // splash/loading navigation first. If some wrapper does that, did-finish-load would
  // fire early for that intermediate, Game-less page and this assumption would break.
  run().catch((e) => console.error('[pokeclicker-scripts] injection error', e));
})();`;
}

// `require('electron')` isn't resolvable yet this early in NODE_OPTIONS=--require
// preload execution; Electron registers its module shim slightly later in its own
// bootstrap, so defer to the next event loop tick.
setImmediate(() => {
  const { app } = require('electron');

  app.on('browser-window-created', (_event, window) => {
    // Fires on every navigation/reload, not just the first load, so this
    // re-injects the userscript automatically whenever the in-game page reloads.
    window.webContents.on('did-finish-load', async () => {
      const entrySource = readEntrySource();
      const matches = getMatches(entrySource);
      const url = window.webContents.getURL();
      if (matches.length && !matches.some((re) => re.test(url))) {
        console.log('[pokeclicker-scripts] skipping injection, URL does not match @match:', url);
        return;
      }

      try {
        const payload = await buildPayload(entrySource);
        await window.webContents.executeJavaScript(payload);
      } catch (e) {
        console.error('[pokeclicker-scripts] injection failed', e);
      }
    });

    window.webContents.on('console-message', (event) => {
      console.log(event)
      const method = event.level === 'warning' ? 'warn' : event.level;
      console[method](`[page console] ${event.message} (${event.sourceId}:${event.lineNumber})`);
    });
  });
});
