"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("../lib/harness.cjs");

const testLootTierWeights = Object.freeze({
  common: 0.75,
  rare: 0.2,
  epic: 0.04,
  legendary: 0.0099,
  mythic: 0.0001,
});

function createDungeonGlobals() {
  return {};
}

function loadSettings(t, stored = null) {
  const storage = { value: stored, setCalls: 0 };
  const context = {
    Save: { key: "test" },
    localStorage: {
      getItem: () => storage.value,
      setItem: (_key, value) => {
        storage.value = value;
        storage.setCalls++;
      },
    },
    ...createDungeonGlobals(),
    console: { warn() {}, error() {} },
  };
  const loaded = createHarness(t).loadScripts(
    ["src/common.js", "src/dungeon.js", "src/settings/definitions.js", "src/settings/store.js"],
    context,
    "AutomationSettings",
  );
  loaded.value.initialize();
  return { settings: loaded.value, storage, runtime: loaded.context };
}

test("settings initialize defaults and chest tier choices", (t) => {
  const { settings } = loadSettings(t);
  const shop = settings.sections.find((section) => section.id === "shop");
  const dungeon = settings.sections.find((section) => section.id === "dungeon");
  const chestTier = dungeon.options.find((option) => option.id === "minimumChestTier");
  assert.equal(settings.getValue("shop", "targetPokeball"), 0);
  assert.equal(settings.getValue("shop", "targetGreatball"), 0);
  assert.equal(settings.getValue("shop", "targetUltraball"), 0);
  assert.equal(settings.getValue("dungeon", "minimumChestTier"), "common");
  assert.deepEqual([...chestTier.values], Object.keys(testLootTierWeights));
  assert.equal(shop.options.length, 3);
});

test("invalid persisted number and enum values fail closed", (t) => {
  const invalid = loadSettings(t, JSON.stringify({
    version: 1,
    settings: {
      shop: { enabled: true, targetPokeball: "10" },
      dungeon: { enabled: true, minimumChestTier: "invalid" },
    },
  }));
  assert.equal(invalid.settings.getValue("shop", "targetPokeball"), 0);
  assert.equal(invalid.settings.getValue("dungeon", "minimumChestTier"), "common");

  const missing = loadSettings(t, JSON.stringify({
    version: 1,
    settings: { shop: { enabled: true } },
  }));
  assert.equal(missing.settings.getValue("shop", "targetGreatball"), 0);
});

test("numeric writes persist", (t) => {
  const loaded = loadSettings(t);
  const target = loaded.settings.value("shop", "targetPokeball");
  target(12);
  assert.equal(loaded.settings.getValue("shop", "targetPokeball"), 12);
  assert.match(loaded.storage.value, /"targetPokeball":12/);
});
