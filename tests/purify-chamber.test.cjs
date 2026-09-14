"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { ko, GameConstants } = constantsHarness.game;

function loadPurifyChamber(t, {
  enabled = true,
  flow = 0,
  flowNeeded = 100,
  purifyPokemon = true,
  pokemons = [],
  shortcutVisible = true,
} = {}) {
  const sectionEnabled = ko.observable(enabled);
  const optionEnabled = ko.observable(purifyPokemon);
  const visible = ko.observable(shortcutVisible);
  const currentFlow = ko.observable(flow);
  const requiredFlow = ko.observable(flowNeeded);
  const selectedPokemon = ko.observable();
  const purified = [];
  const chamber = {
    currentFlow,
    flowNeeded: requiredFlow,
    selectedPokemon,
    purify() {
      const pokemon = selectedPokemon();
      if (!pokemon || pokemon.shadow !== GameConstants.ShadowStatus.Shadow || currentFlow() < requiredFlow()) {
        return;
      }
      pokemon.shadow = GameConstants.ShadowStatus.Purified;
      purified.push(pokemon.id);
      currentFlow(0);
    },
  };
  const loaded = createHarness(t).loadAutomation("purify-chamber", {
    App: { game: { party: { caughtPokemon: pokemons }, purifyChamber: chamber } },
    AutomationSettings: {
      getValue: () => optionEnabled(),
      isEnabled: () => sectionEnabled(),
      value: () => optionEnabled,
    },
    PurifyChamber: { shortcutVisible: () => visible() },
  }, "purifyChamber");
  return {
    automation: loaded.automation,
    currentFlow,
    purified,
    optionEnabled,
    sectionEnabled,
    visible,
  };
}

function shadowPokemon(id, attack) {
  return { id, attack, shadow: GameConstants.ShadowStatus.Shadow };
}

test("purifies the highest-attack Shadow Pokemon when enough flow accumulates", (t) => {
  const lowAttack = shadowPokemon(1, 80);
  const highAttack = shadowPokemon(2, 240);
  const state = loadPurifyChamber(t, {
    flow: 99,
    pokemons: [lowAttack, highAttack],
  });

  state.automation.automate();
  assert.deepEqual(state.purified, []);

  state.currentFlow(100);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, [highAttack.id]);
  assert.equal(highAttack.shadow, GameConstants.ShadowStatus.Purified);
  assert.equal(lowAttack.shadow, GameConstants.ShadowStatus.Shadow);
  assert.equal(state.currentFlow(), 0);
});

test("purifyPokemon option disposes and restores purification readiness", (t) => {
  const pokemon = shadowPokemon(1, 100);
  const state = loadPurifyChamber(t, {
    flow: 99,
    pokemons: [pokemon],
  });

  state.automation.automate();
  state.optionEnabled(false);
  ko.tasks.runEarly();
  state.currentFlow(100);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, []);

  state.optionEnabled(true);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, [pokemon.id]);
});

test("requires both the shortcut and Purify Chamber setting", (t) => {
  const pokemon = shadowPokemon(1, 100);
  const state = loadPurifyChamber(t, {
    enabled: false,
    flow: 100,
    pokemons: [pokemon],
    shortcutVisible: false,
  });

  state.automation.automate();
  state.visible(true);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, []);

  state.sectionEnabled(true);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, [pokemon.id]);
});

test("disabling the section disposes purification readiness", (t) => {
  const pokemon = shadowPokemon(1, 100);
  const state = loadPurifyChamber(t, {
    flow: 99,
    pokemons: [pokemon],
  });

  state.automation.automate();
  state.sectionEnabled(false);
  ko.tasks.runEarly();
  state.currentFlow(100);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, []);

  state.sectionEnabled(true);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, [pokemon.id]);
});
