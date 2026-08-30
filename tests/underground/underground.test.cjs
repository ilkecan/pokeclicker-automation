"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  canonicalModulePath,
  defaultImport,
  installTypeScriptLoader,
  resolveGameDir,
} = require("../../lib/runtime.cjs");

const projectDir = path.resolve(__dirname, "../..");
const gameDir = resolveGameDir(projectDir);
const modulesDir = path.join(gameDir, "src", "modules");
const sourcePath = path.join(projectDir, "src/underground.js");
const commonSource = fs.readFileSync(path.join(projectDir, "src/common.js"), "utf8");
const source = fs.readFileSync(sourcePath, "utf8");
const exposedSource = source.replace("    dig, // for simulation", "    dig,\n    sellUndergroundTreasures,");
if (exposedSource === source) throw new Error("Could not expose underground seller");

function loadOfficialMetadata() {
  const mocks = new Map([
    [
      canonicalModulePath(path.join(modulesDir, "notifications/NotificationConstants")),
      defaultImport({}),
    ],
    [
      canonicalModulePath(path.join(modulesDir, "notifications/Notifier")),
      defaultImport({ notify() {} }),
    ],
  ]);
  const loader = installTypeScriptLoader(gameDir, mocks);
  const previousKo = globalThis.ko;
  const previousPlayer = globalThis.player;
  try {
    globalThis.ko = require(path.join(gameDir, "node_modules/knockout"));
    globalThis.player = { highestRegion: () => 9 };
    const { ItemList } = require(path.join(modulesDir, "items/ItemList.ts"));
    const { HeldItem } = require(path.join(modulesDir, "items/HeldItem.ts"));
    const UndergroundItems = require(path.join(modulesDir, "underground/UndergroundItems.ts")).default;
    const UndergroundItemValueType = require(path.join(modulesDir, "enums/UndergroundItemValueType.ts")).default;
    const dealItemList = new Proxy(ItemList, {
      get(target, name) {
        return target[name] || { basePrice: 1, name: String(name), isSoldOut: () => false };
      },
    });
    mocks.set(
      canonicalModulePath(path.join(modulesDir, "items/ItemList")),
      { ItemList: dealItemList },
    );
    const { ShardDeal } = require(path.join(modulesDir, "underground/ShardDeal.ts"));
    ShardDeal.generateDeals();
    return { ItemList, HeldItem, UndergroundItems, UndergroundItemValueType, ShardDeal };
  } finally {
    loader.restore();
    if (previousKo === undefined) delete globalThis.ko;
    else globalThis.ko = previousKo;
    if (previousPlayer === undefined) delete globalThis.player;
    else globalThis.player = previousPlayer;
  }
}

const official = loadOfficialMetadata();
const names = official.UndergroundItems.list
  .filter((item) => item.valueType === official.UndergroundItemValueType.Diamond)
  .map((item) => item.itemName);

function observable(initial) {
  let value = initial;
  const fn = function(next) {
    if (arguments.length) value = next;
    return value;
  };
  fn.subscribe = () => ({ dispose() {} });
  return fn;
}

function loadUnderground({ sell = true, unlocked = true, locked = false, inventory = 1, extraDeal = null } = {}) {
  const quickSold = [];
  const { Diamond, Gem } = official.UndergroundItemValueType;
  const items = official.UndergroundItems.list
    .filter((item) => item.valueType === Diamond)
    .map((item) => ({
      itemName: item.itemName,
      valueType: item.valueType,
      isUnlocked: () => unlocked,
      sellLocked: () => locked,
    }));
  items.push({ itemName: "non_diamond", valueType: Gem, isUnlocked: () => true, sellLocked: () => false });
  const inventoryList = Object.fromEntries(names.map((name) => [name, observable(inventory)]));
  const deal = (itemName) => ({ shards: [{ shardType: { itemName } }] });
  const shardDealList = Object.fromEntries(Object.entries(official.ShardDeal.list));
  if (extraDeal) {
    shardDealList.test = observable([deal(extraDeal)]);
  }
  const context = {
    UndergroundItems: { list: items },
    UndergroundItemValueType: official.UndergroundItemValueType,
    ItemList: official.ItemList,
    HeldItem: official.HeldItem,
    ShardDeal: { list: shardDealList },
    AutomationSettings: { getValue: () => sell },
    UndergroundTrading: { quickSell: (treasure) => quickSold.push(treasure.itemName) },
    player: { itemList: inventoryList },
    ko: { observable, pureComputed: (read) => Object.assign(() => read(), { subscribe: () => ({ dispose() {} }) }) },
    module: { exports: {} },
  };
  vm.runInNewContext(`${commonSource}\n${exposedSource}\nmodule.exports = underground;`, context, { filename: sourcePath });
  return { ...context, underground: context.module.exports, quickSold };
}

function sell(options) {
  const state = loadUnderground(options);
  state.underground.sellUndergroundTreasures();
  return state.quickSold;
}

test("retains held and trade-cost Diamond treasures", () => {
  const state = loadUnderground();
  state.underground.sellUndergroundTreasures();
  const heldTreasureNames = new Set(
    names.filter((name) => official.ItemList[name] instanceof official.HeldItem)
  );
  const tradeCostTreasureNames = new Set(
    Object.values(state.ShardDeal.list)
      .flatMap((deals) => deals().flatMap((deal) => deal.shards.map((shard) => shard.shardType.itemName)))
  );
  assert.equal(tradeCostTreasureNames.has("Odd_keystone"), true);
  const retainedTreasureNames = new Set([...heldTreasureNames, ...tradeCostTreasureNames]);
  for (const name of retainedTreasureNames) {
    assert.equal(state.quickSold.includes(name), false);
  }
  for (const name of names.filter((name) => !retainedTreasureNames.has(name))) {
    assert.equal(state.quickSold.includes(name), true);
  }
  assert.equal(state.quickSold.includes("non_diamond"), false);
});

test("retains treasures used by every shard deal", () => {
  const state = loadUnderground({ extraDeal: "Light_clay" });
  state.underground.sellUndergroundTreasures();
  assert.equal(state.quickSold.includes("Light_clay"), false);
  assert.equal(state.quickSold.includes("Rare_bone"), true);
});

test("preserved gates fail closed", () => {
  assert.equal(sell({ sell: false }).length, 0);
  assert.equal(sell({ unlocked: false }).length, 0);
  assert.equal(sell({ locked: true }).length, 0);
  assert.equal(sell({ inventory: 0 }).length, 0);
});
