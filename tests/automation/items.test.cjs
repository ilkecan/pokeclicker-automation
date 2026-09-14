"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("../lib/harness.cjs");

const constantsHarness = createHarness();
const { ko } = constantsHarness.game;

function loadItems(t, { stock = 1, canUse = () => true } = {}) {
  const events = [];
  let bag = stock;
  const item = {
    name: "Wonder_Chest",
    canUse: (pokemon) => canUse(pokemon),
  };
  const pokemons = [1, 2].map((id) => {
    const pokemon = {
      id,
      heldItem: ko.observable(null),
      giveHeldItem(heldItem) {
        events.push(["give", id]);
        // Mirrors PartyPokemon.giveHeldItem guards.
        if (heldItem && !heldItem.canUse(pokemon)) {
          events.push(["warn-cannot-use", id]);
          return;
        }
        if (bag < 1) {
          events.push(["warn-empty", id]);
          return;
        }
        bag -= 1;
        pokemon.heldItem(heldItem);
      },
    };
    return pokemon;
  });
  const context = {
    Settings: { getSetting: () => ({ observableValue: () => 0 }) },
    PartyController: { compareBy: () => () => 0 },
    App: { game: { party: { caughtPokemon: pokemons } } },
    player: { amountOfItem: () => bag },
    ItemList: { Wonder_Chest: item },
  };
  const loaded = createHarness(t).loadAutomation("items", context);
  return { items: loaded.automation, events, pokemons, bag: () => bag };
}

test("stops giving held items once stock runs out", (t) => {
  const state = loadItems(t, { stock: 1 });
  state.items.automate();
  assert.deepEqual(state.events, [["give", 1]]);
  assert.equal(state.bag(), 0);
  assert.equal(state.pokemons[0].heldItem().name, "Wonder_Chest");
  assert.equal(state.pokemons[1].heldItem(), null);
});

test("skips pokemon that cannot use the item", (t) => {
  const state = loadItems(t, { stock: 5, canUse: (pokemon) => pokemon.id === 1 });
  state.items.automate();
  assert.deepEqual(state.events, [["give", 1]]);
  assert.equal(state.bag(), 4);
  assert.equal(state.pokemons[1].heldItem(), null);
});
