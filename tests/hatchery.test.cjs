"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { GameConstants, PokemonType, ko } = constantsHarness.game;
const { Pokerus } = GameConstants;

function createPokemon(id, type1, type2 = PokemonType.None, pokerus = Pokerus.Uninfected, breeding = false) {
  const pokemon = {
    id,
    pokerus,
    breeding,
    type1,
    type2,
  };
  pokemon.isHatchable = () => !pokemon.breeding;
  return pokemon;
}

function createEgg(pokemon, { none = false, ready = false } = {}) {
  return {
    isNone: () => none,
    canHatch: () => ready,
    partyPokemon: () => pokemon,
  };
}

function createObservable(value) {
  return ko.observable(value);
}

function loadHatchery(t, {
  caughtPokemon,
  filteredCandidates,
  eggs,
  eggSlots,
  helpers = [],
  spreadPokerus = true,
  manageHelpers = true,
  fillEggSlots = true,
  pokerusUnlocked = true,
  automationEnabled = true,
  returnContext = false,
}) {
  const harness = createHarness(t);
  const pokemonsById = new Map(caughtPokemon.map((pokemon) => [pokemon.id, pokemon]));
  const enabled = ko.observable(automationEnabled);
  const addedPokemon = [];
  const context = {
    App: {
      game: {
        breeding: {
          eggList: eggs.map((egg) => createObservable(egg)),
          eggSlots,
          queueList: createObservable([]),
          canAccess: () => true,
          hasFreeEggSlot: () => addedPokemon.length < eggSlots,
          addPokemonToHatchery: (pokemon) => {
            pokemon.breeding = true;
            addedPokemon.push(pokemon);
            return true;
          },
          hatcheryHelpers: {
            hired: () => helpers,
            canHire: () => helpers.length < Math.min(3, eggSlots),
          },
        },
        party: { caughtPokemon },
        keyItems: { hasKeyItem: () => pokerusUnlocked },
      },
    },
    AutomationSettings: {
      getValue: (_section, option) => option === "spreadPokerus" ? spreadPokerus : option === "manageHelpers" ? manageHelpers : option === "fillEggSlots" ? fillEggSlots : true,
      value: (_section, option) => createObservable(option === "manageHelpers" ? manageHelpers : true),
      isEnabled: () => enabled(),
    },
    BreedingController: { hatcherySortedFilteredList: () => filteredCandidates },
    KeyItemType: { Pokerus_virus: "Pokerus_virus" },
    PokemonHelper: { getPokemonById: (id) => pokemonsById.get(id) },
  };
  const loaded = harness.loadAutomation("hatchery", context);
  loaded.context.disableAutomation = (t) => {
    enabled(false);
    ko.tasks.runEarly();
  };
  return returnContext ? {
    hatchery: loaded.automation,
    context: loaded.context,
    addedPokemon,
    dispose: () => harness.dispose(),
  } : loaded.automation;
}

function collectCandidateIds(hatchery, limit, spreadPokerus = true) {
  const ids = [];
  for (const pokemon of hatchery.candidatesToBreed(spreadPokerus)) {
    pokemon.breeding = true;
    ids.push(pokemon.id);
    if (ids.length === limit) {
      break;
    }
  }
  return ids;
}
test("returns normal candidates in filtered order", (t) => {
  const first = createPokemon(1, PokemonType.Fire);
  const second = createPokemon(2, PokemonType.Water);
  const third = createPokemon(3, PokemonType.Grass);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [first, second, third],
    filteredCandidates: [second, first, third],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
    spreadPokerus: false,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2, false), [2, 1]);
});

test("uses normal ordering when Pokerus is locked", (t) => {
  const spreader = createPokemon(1, PokemonType.Rock, PokemonType.None, Pokerus.Contagious);
  const target = createPokemon(2, PokemonType.Rock);
  const loaded = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [target, spreader],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
    pokerusUnlocked: false,
    returnContext: true,
  });

  loaded.hatchery.automate();
  assert.deepEqual(loaded.addedPokemon.map((pokemon) => pokemon.id), [2, 1]);
  return loaded.dispose();
});

test("selects one spreader and three compatible targets", (t) => {
  const spreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious);
  const targets = [2, 3, 4].map((id) => createPokemon(id, PokemonType.Fire));
  const hatchery = loadHatchery(t, {
    caughtPokemon: [...targets, spreader],
    filteredCandidates: [...targets, spreader],
    eggs: Array.from({ length: 4 }, () => createEgg(null, { none: true })),
    eggSlots: 4,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 4), [1, 2, 3, 4]);
});

test("uses a manual contagious egg to prioritize compatible targets", (t) => {
  const spreader = createPokemon(1, PokemonType.Water, PokemonType.None, Pokerus.Contagious, true);
  const target = createPokemon(2, PokemonType.Water);
  const unrelated = createPokemon(3, PokemonType.Fire);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target, unrelated],
    filteredCandidates: [unrelated, target],
    eggs: [createEgg(spreader), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [2]);
});

test("selects a new spreader before targets covered by an existing spreader", (t) => {
  const existingSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const existingTarget = createPokemon(2, PokemonType.Fire);
  const newSpreader = createPokemon(3, PokemonType.Water, PokemonType.None, Pokerus.Contagious);
  const newTarget = createPokemon(4, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [existingSpreader, existingTarget, newSpreader, newTarget],
    filteredCandidates: [existingTarget, newSpreader, newTarget],
    eggs: [createEgg(existingSpreader), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [2]);
});

test("prefers a spreader covering multiple existing targets", (t) => {
  const existingSpreader = createPokemon(1, PokemonType.Water, PokemonType.None, Pokerus.Contagious, true);
  const firstTarget = createPokemon(2, PokemonType.Fire, PokemonType.None, Pokerus.Uninfected, true);
  const secondTarget = createPokemon(3, PokemonType.Fire, PokemonType.None, Pokerus.Uninfected, true);
  const productiveSpreader = createPokemon(4, PokemonType.Fire, PokemonType.None, Pokerus.Contagious);
  const coveredTarget = createPokemon(5, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [existingSpreader, firstTarget, secondTarget, productiveSpreader, coveredTarget],
    filteredCandidates: [coveredTarget, productiveSpreader],
    eggs: [createEgg(existingSpreader), createEgg(firstTarget), createEgg(secondTarget), createEgg(null, { none: true })],
    eggSlots: 4,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [4]);
});

test("normal selection accounts for helper-managed slots", (t) => {
  const helperSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const target = createPokemon(2, PokemonType.Fire);
  const fallback = createPokemon(3, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [helperSpreader, target, fallback],
    filteredCandidates: [fallback, target],
    eggs: [createEgg(helperSpreader), createEgg(null, { none: true })],
    eggSlots: 2,
    helpers: [{}],
    spreadPokerus: false,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [3]);
});

test("fires and restores existing helpers around Pokerus spreading", (t) => {
  const helperSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const target = createPokemon(2, PokemonType.Fire);
  const helpers = [];
  const helper = {
    fired: 0,
    fire() {
      this.fired++;
      helpers.splice(helpers.indexOf(this), 1);
    },
    hire() {
      helpers.push(this);
    },
    hired: () => false,
  };
  helpers.push(helper);

  const loaded = loadHatchery(t, {
    caughtPokemon: [helperSpreader, target],
    filteredCandidates: [target],
    eggs: [createEgg(helperSpreader), createEgg(null, { none: true })],
    eggSlots: 2,
    helpers,
    fillEggSlots: false,
    returnContext: true,
  });

  loaded.hatchery.automate();

  assert.equal(helper.fired, 1);
  assert.deepEqual(helpers, []);

  loaded.context.disableAutomation();

  assert.deepEqual(helpers, [helper]);
  return loaded.dispose();
});

test("does not manage helpers when helper management is disabled", (t) => {
  const spreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const target = createPokemon(2, PokemonType.Fire);
  const helpers = [];
  const helper = {
    fired: 0,
    fire() {
      this.fired++;
      helpers.splice(helpers.indexOf(this), 1);
    },
    hire() {
      helpers.push(this);
    },
    hired: () => false,
  };
  helpers.push(helper);

  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [target],
    eggs: [createEgg(spreader), createEgg(null, { none: true })],
    eggSlots: 2,
    helpers,
    manageHelpers: false,
  });

  hatchery.automate();

  assert.equal(helper.fired, 0);
  assert.deepEqual(helpers, [helper]);
});

test("does not use helper eggs as Pokerus spreaders", (t) => {
  const helperSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const fireTarget = createPokemon(2, PokemonType.Fire);
  const waterSpreader = createPokemon(3, PokemonType.Water, PokemonType.None, Pokerus.Contagious);
  const waterTarget = createPokemon(4, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [fireTarget, helperSpreader, waterTarget, waterSpreader],
    filteredCandidates: [fireTarget, waterSpreader, waterTarget],
    eggs: [createEgg(helperSpreader), createEgg(null, { none: true })],
    eggSlots: 2,
    helpers: [{}],
  });

  assert.deepEqual(collectCandidateIds(hatchery, 3), [3, 4, 2]);
});

test("chooses a covered target when only one slot is free", (t) => {
  const existingSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious, true);
  const coveredTarget = createPokemon(2, PokemonType.Fire);
  const unrelatedSpreader = createPokemon(3, PokemonType.Water, PokemonType.None, Pokerus.Contagious);
  const unrelatedTarget = createPokemon(4, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [existingSpreader, coveredTarget, unrelatedSpreader, unrelatedTarget],
    filteredCandidates: [unrelatedSpreader, unrelatedTarget, coveredTarget],
    eggs: [createEgg(existingSpreader), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [2]);
});

test("uses one spreader cohort before opening another", (t) => {
  const fireSpreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious);
  const fireTarget = createPokemon(2, PokemonType.Fire);
  const waterSpreader = createPokemon(3, PokemonType.Water, PokemonType.None, Pokerus.Contagious);
  const waterTarget = createPokemon(4, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [fireSpreader, fireTarget, waterSpreader, waterTarget],
    filteredCandidates: [fireTarget, waterSpreader, waterTarget, fireSpreader],
    eggs: Array.from({ length: 4 }, () => createEgg(null, { none: true })),
    eggSlots: 4,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 4), [1, 2, 3, 4]);
});

test("treats Resistant Pokemon as spreaders", (t) => {
  const spreader = createPokemon(1, PokemonType.Electric, PokemonType.None, Pokerus.Resistant);
  const target = createPokemon(2, PokemonType.Electric);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [target, spreader],
    eggs: Array.from({ length: 2 }, () => createEgg(null, { none: true })),
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2), [1, 2]);
});

test("uses both types from a dual-type spreader", (t) => {
  const spreader = createPokemon(1, PokemonType.Fire, PokemonType.Water, Pokerus.Contagious);
  const target = createPokemon(2, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [target, spreader],
    eggs: Array.from({ length: 2 }, () => createEgg(null, { none: true })),
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2), [1, 2]);
});

test("uses normal order for dual-type covered targets", (t) => {
  const spreader = createPokemon(1, PokemonType.Fire, PokemonType.Water, Pokerus.Contagious, true);
  const fireTarget = createPokemon(2, PokemonType.Fire);
  const waterTargets = [3, 4, 5].map((id) => createPokemon(id, PokemonType.Water));
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, fireTarget, ...waterTargets],
    filteredCandidates: [fireTarget, ...waterTargets],
    eggs: [createEgg(spreader), createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 3,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2), [2, 3]);
});

test("yields a spreader before its target with one slot", (t) => {
  const spreader = createPokemon(1, PokemonType.Grass, PokemonType.None, Pokerus.Contagious);
  const target = createPokemon(2, PokemonType.Grass);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [spreader, target],
    eggs: [createEgg(null, { none: true })],
    eggSlots: 1,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [1]);
});

test("seeds a new pair when two slots are available", (t) => {
  const spreader = createPokemon(1, PokemonType.Grass, PokemonType.None, Pokerus.Contagious);
  const target = createPokemon(2, PokemonType.Grass);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [target, spreader],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2), [1, 2]);
});

test("ignores Infected Pokemon for Pokerus allocation", (t) => {
  const infected = createPokemon(1, PokemonType.Grass, PokemonType.None, Pokerus.Infected, true);
  const target = createPokemon(2, PokemonType.Grass);
  const fallback = createPokemon(3, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [infected, target, fallback],
    filteredCandidates: [fallback, target],
    eggs: [createEgg(infected), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [3]);
});

test("does not use a ready egg as a Pokerus spreader", (t) => {
  const readySpreader = createPokemon(1, PokemonType.Psychic, PokemonType.None, Pokerus.Contagious, true);
  const target = createPokemon(2, PokemonType.Psychic);
  const fallback = createPokemon(3, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [readySpreader, target, fallback],
    filteredCandidates: [fallback, target],
    eggs: [createEgg(readySpreader, { ready: true }), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 1), [3]);
});

test("uses all hatchable pokemons for Pokerus even when filtered fallback excludes them", (t) => {
  const spreader = createPokemon(1, PokemonType.Rock, PokemonType.None, Pokerus.Contagious);
  const target = createPokemon(2, PokemonType.Rock);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, target],
    filteredCandidates: [spreader],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2), [1, 2]);
});

test("falls back to all hatchable Pokemon when filtered candidates are empty", (t) => {
  const first = createPokemon(1, PokemonType.Fire);
  const second = createPokemon(2, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [first, second],
    filteredCandidates: [],
    eggs: [createEgg(null, { none: true })],
    eggSlots: 1,
    spreadPokerus: false,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 2, false), [1, 2]);
});

test("keeps Pokerus, filtered, then fallback candidate order", (t) => {
  const spreader = createPokemon(1, PokemonType.Fire, PokemonType.None, Pokerus.Contagious);
  const filtered = createPokemon(2, PokemonType.Water);
  const fallback = createPokemon(3, PokemonType.Grass);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [spreader, filtered, fallback],
    filteredCandidates: [filtered],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
    spreadPokerus: false,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 3, false), [2, 1, 3]);
});

test("successful fallback additions exclude the same Pokemon later", (t) => {
  const first = createPokemon(1, PokemonType.Fire);
  const second = createPokemon(2, PokemonType.Water);
  const hatchery = loadHatchery(t, {
    caughtPokemon: [first, second],
    filteredCandidates: [first],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
    spreadPokerus: false,
  });

  assert.deepEqual(collectCandidateIds(hatchery, 3, false), [1, 2]);
});

test("readiness follows hatchable inventory as slots fill", (t) => {
  const first = createPokemon(1, PokemonType.Fire);
  const later = createPokemon(2, PokemonType.Water, PokemonType.None, Pokerus.Uninfected, true);
  const laterHatchable = ko.observable(false);
  later.isHatchable = () => laterHatchable();
  const loaded = loadHatchery(t, {
    caughtPokemon: [first, later],
    filteredCandidates: [],
    eggs: [createEgg(null, { none: true }), createEgg(null, { none: true })],
    eggSlots: 2,
    spreadPokerus: false,
    returnContext: true,
  });

  loaded.hatchery.automate();
  assert.deepEqual(loaded.addedPokemon.map((pokemon) => pokemon.id), [1]);
  later.breeding = false;
  laterHatchable(true);
  loaded.context.App.game.breeding.queueList([{}]);
  ko.tasks.runEarly();
  loaded.context.App.game.breeding.queueList([]);
  ko.tasks.runEarly();
  assert.deepEqual(loaded.addedPokemon.map((pokemon) => pokemon.id), [1, 2]);
});
