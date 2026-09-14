"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("../lib/harness.cjs");

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
    PurifyChamber: { shortcutVisible: () => visible() },
  }, "purifyChamber");
  const settings = loaded.settings;
  settings.value("purifyChamber", "purifyPokemon")(purifyPokemon);
  settings.enabled("purifyChamber")(enabled);
  return {
    automation: loaded.automation,
    settings,
    currentFlow,
    purified,
    visible,
  };
}

function shadowPokemon(id, attack) {
  return { id, attack, shadow: GameConstants.ShadowStatus.Shadow };
}

function setPurifyPokemon(state, value) {
  state.settings.value("purifyChamber", "purifyPokemon")(value);
}

function setSectionEnabled(state, value) {
  state.settings.enabled("purifyChamber")(value);
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
  setPurifyPokemon(state, false);
  ko.tasks.runEarly();
  state.currentFlow(100);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, []);

  setPurifyPokemon(state, true);
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

  setSectionEnabled(state, true);
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
  setSectionEnabled(state, false);
  ko.tasks.runEarly();
  state.currentFlow(100);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, []);

  setSectionEnabled(state, true);
  ko.tasks.runEarly();
  assert.deepEqual(state.purified, [pokemon.id]);
});
