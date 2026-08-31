"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { GameConstants, ko } = constantsHarness.game;

const BerryType = { None: "none" };
const PlotStage = { Berry: "berry" };
const MulchType = { None: "none", Gooey_Mulch: "gooey" };

function loadFarm(t, {
  wanderer = { name: "Pikachu", shiny: true },
  caught = false,
  pokerus = GameConstants.Pokerus.Uninfected,
  mulch = MulchType.None,
  inventory = true,
  useGooey = true,
  apply = true,
  catching = false,
  fleeing = false,
} = {}) {
  const events = [];
  const plotWanderer = ko.observable(wanderer);
  const plot = {
    index: 3,
    mulch,
    berry: BerryType.None,
    isSafeLocked: false,
    _wanderer: plotWanderer,
    get wanderer() {
      return plotWanderer();
    },
    canCatchWanderer: () => Boolean(plotWanderer()) && !catching && !fleeing,
  };
  const values = {
    catchWanderers: true,
    useGooeyMulch: useGooey,
    harvestWitheringBerries: false,
  };
  const context = {
    AutomationSettings: {
      getValue: (_section, id) => values[id],
      isEnabled: () => true,
    },
    App: {
      game: {
        farming: {
          plotList: [plot],
          canAccess: () => true,
          hasMulch: () => inventory,
          addMulch: (_index, type) => {
            events.push(["mulch", type]);
            if (apply) plot.mulch = type;
          },
          handleWanderer: (target) => events.push(["catch", target.index]),
        },
        party: {
          alreadyCaughtPokemonByName: () => caught,
          getPokemonByName: () => caught ? { pokerus } : undefined,
        },
      },
    },
    BerryType,
    PlotStage,
    MulchType,
    console: { error: (...args) => events.push(["error", ...args]) },
  };
  const loaded = createHarness(t).loadAutomation("farm", context);
  return { ...context, farm: loaded.automation, events, plot };
}

function run(t, options) {
  const state = loadFarm(t, options);
  state.farm.automate();
  return state.events;
}

test("priority wanderers receive Gooey Mulch before catch handling", (t) => {
  assert.deepEqual(run(t), [["mulch", "gooey"], ["catch", 3]]);
  assert.deepEqual(run(t, { wanderer: { name: "Pikachu", shiny: false } }), [["mulch", "gooey"], ["catch", 3]]);
});

test("caught wanderers only receive Gooey Mulch while contagious", (t) => {
  assert.deepEqual(run(t, {
    wanderer: { name: "Pikachu", shiny: false },
    caught: true,
    pokerus: GameConstants.Pokerus.Infected,
  }), [["catch", 3]]);
  assert.deepEqual(run(t, {
    wanderer: { name: "Pikachu", shiny: false },
    caught: true,
    pokerus: GameConstants.Pokerus.Contagious,
  }), [["mulch", "gooey"], ["catch", 3]]);
  assert.deepEqual(run(t, {
    wanderer: { name: "Pikachu", shiny: false },
    caught: true,
    pokerus: GameConstants.Pokerus.Resistant,
  }), [["catch", 3]]);
});

test("non-priority, already mulched, empty-inventory, and disabled cases catch immediately", (t) => {
  assert.deepEqual(run(t, { wanderer: { name: "Pikachu", shiny: false }, caught: true }), [["catch", 3]]);
  assert.deepEqual(run(t, { wanderer: { name: "Pikachu", shiny: true }, mulch: "other" }), [["catch", 3]]);
  assert.deepEqual(run(t, { wanderer: { name: "Pikachu", shiny: true }, inventory: false }), [["catch", 3]]);
  assert.deepEqual(run(t, { wanderer: { name: "Pikachu", shiny: true }, useGooey: false }), [["catch", 3]]);
});

test("failed mulch application logs once and still catches", (t) => {
  const events = run(t, { apply: false });
  assert.equal(events[0][0], "mulch");
  assert.equal(events[1][0], "error");
  assert.deepEqual(events[1][1], "[pokeclicker-automation] farm: failed to apply Gooey Mulch before catching wanderer");
  assert.deepEqual(events[2], ["catch", 3]);
});

test("catching and fleeing wanderers are suppressed", (t) => {
  assert.deepEqual(run(t, { catching: true }), []);
  assert.deepEqual(run(t, { fleeing: true }), []);
});

test("observable changes do not duplicate handling", (t) => {
  const state = loadFarm(t);
  state.farm.automate();
  assert.deepEqual(state.events, [["mulch", "gooey"], ["catch", 3]]);
  state.plot._wanderer({ name: "Eevee", shiny: true });
  assert.deepEqual(state.events, [["mulch", "gooey"], ["catch", 3]]);
});
