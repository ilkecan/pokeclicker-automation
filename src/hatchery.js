"use strict";

const hatchery = (() => {
  const SETTINGS_SECTION = "hatchery";
  const POKERUS_SPREADER_STATES = new Set([
    GameConstants.Pokerus.Contagious,
    GameConstants.Pokerus.Resistant,
  ]);

  function hatchEggWhenReady(egg, index, subscriptions) {
    subscriptions[index]?.dispose();
    subscriptions[index] = null;

    if (egg.isNone()) {
      return;
    }

    const shouldHatch = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "hatchReadyEggs"),
      egg.canHatch(),
      App.game.breeding.hatcheryHelpers.hired().length <= index,
    ]));

    subscriptions[index] = ko.when(shouldHatch, () => App.game.breeding.hatchPokemonEgg(index));
  }

  function hatchEggs() {
    const eggSlots = App.game.breeding.eggList;
    const eggSubscriptions = Array(eggSlots.length);
    const slotSubscriptions = eggSlots.map((eggSlot, index) => {
      return _runAndSubscribe(eggSlot, (egg) => hatchEggWhenReady(egg, index, eggSubscriptions));
    })
    return [
      // `eggSubscriptions` change dynamically, so we need a closure instead of a copied array
      { dispose() { _disposeAll(eggSubscriptions); } },
      ...slotSubscriptions,
    ];
  }

  function getPokemonTypes(pokemon) {
    const dataPokemon = PokemonHelper.getPokemonById(pokemon.id);
    return [dataPokemon.type1, dataPokemon.type2].filter((type) => type !== PokemonType.None);
  }

  function getPokerusEligiblePokemonsInHatchery({ includeHelperSlots = false } = {}) {
    const eggSlots = App.game.breeding.eggList;
    const helperCount = App.game.breeding.hatcheryHelpers.hired().length;
    const pokemons = [];

    for (let i = includeHelperSlots ? 0 : helperCount; i < App.game.breeding.eggSlots; i++) {
      const egg = eggSlots[i]();
      if (egg.isNone() || egg.canHatch()) {
        continue;
      }

      const pokemon = egg.partyPokemon();
      if (pokemon) {
        pokemons.push(pokemon);
      }
    }

    return pokemons;
  }

  function hasSharedType(first, second) {
    const secondTypes = new Set(getPokemonTypes(second));
    return getPokemonTypes(first).some((type) => secondTypes.has(type));
  }

  function hasSpreadingType(pokemon, spreadingTypes) {
    return getPokemonTypes(pokemon).some((type) => spreadingTypes.has(type));
  }

  function isPokerusSpreader(pokemon) {
    return POKERUS_SPREADER_STATES.has(pokemon.pokerus);
  }

  function selectPokemon(hatchables, pokemon) {
    hatchables.delete(pokemon.id);
    return pokemon;
  }

  function selectPokerusSpreader(hatchables, spreadingTypes, pokemon) {
    getPokemonTypes(pokemon).forEach((type) => spreadingTypes.add(type));
    return selectPokemon(hatchables, pokemon);
  }

  function* selectPokerusTargets(hatchables, spreadingTypes) {
    for (const pokemon of hatchables.values()) {
      if (pokemon.pokerus !== GameConstants.Pokerus.Uninfected || !hasSpreadingType(pokemon, spreadingTypes)) {
        continue;
      }

      yield selectPokemon(hatchables, pokemon);
    }
  }

  function findMostProductiveSpreader(hatchables, spreadingTypes, targets) {
    let bestSpreader;
    let bestScore = 0;

    for (const pokemon of hatchables.values()) {
      if (!isPokerusSpreader(pokemon)) {
        continue;
      }

      let score = 0;
      for (const target of targets) {
        if (_and([
          !hasSpreadingType(target, spreadingTypes),
          hasSharedType(pokemon, target),
        ])) {
          score++;
        }
      }

      if (score > bestScore) {
        bestSpreader = pokemon;
        bestScore = score;
      }
    }

    return { pokemon: bestSpreader, score: bestScore };
  }

  function getHatchablePokemons() {
    const hatchables = new Map();
    for (const pokemon of App.game.party.caughtPokemon) {
      if (pokemon.isHatchable()) {
        hatchables.set(pokemon.id, pokemon);
      }
    }
    return hatchables;
  }

  function getSpreadingTypes(pokemons) {
    const types = new Set();
    for (const pokemon of pokemons) {
      if (isPokerusSpreader(pokemon)) {
        getPokemonTypes(pokemon).forEach((type) => types.add(type));
      }
    }
    return types;
  }

  function* pokerusCandidates(hatchables, uninfectedCandidates) {
    const inHatchery = getPokerusEligiblePokemonsInHatchery();
    const uninfectedsInHatchery = inHatchery.filter((pokemon) => pokemon.pokerus === GameConstants.Pokerus.Uninfected);
    const spreadingTypes = getSpreadingTypes(inHatchery);

    while (true) {
      const productiveSpreader = findMostProductiveSpreader(hatchables, spreadingTypes, uninfectedsInHatchery);
      if (productiveSpreader.score > 1) {
        yield selectPokerusSpreader(hatchables, spreadingTypes, productiveSpreader.pokemon);
        continue;
      }

      for (const target of selectPokerusTargets(hatchables, spreadingTypes)) {
        yield target;
      }

      if (productiveSpreader.pokemon) {
        yield selectPokerusSpreader(hatchables, spreadingTypes, productiveSpreader.pokemon);
        continue;
      }

      const seedSpreader = findMostProductiveSpreader(hatchables, spreadingTypes, uninfectedCandidates);
      if (seedSpreader.score === 0) {
        break;
      }

      yield selectPokerusSpreader(hatchables, spreadingTypes, seedSpreader.pokemon);
    }
  }

  function* candidatesToBreed(spreadPokerus) {
    if (spreadPokerus) {
      const hatchables = getHatchablePokemons();
      const uninfectedCandidates = Array.from(hatchables.values().filter((pokemon) => pokemon.pokerus === GameConstants.Pokerus.Uninfected));
      yield* pokerusCandidates(hatchables, uninfectedCandidates);
    }

    for (const pokemon of BreedingController.hatcherySortedFilteredList()) {
      if (pokemon.isHatchable()) {
        yield pokemon;
      }
    }

    for (const pokemon of App.game.party.caughtPokemon) {
      if (pokemon.isHatchable()) {
        yield pokemon;
      }
    }
  }

  function fillHatchery(hasFreeEggSlot, spreadPokerus) {
    const candidates = candidatesToBreed(spreadPokerus);

    while (hasFreeEggSlot()) {
      const { done, value } = candidates.next();
      if (done) {
        break;
      }

      App.game.breeding.addPokemonToHatchery(value);
    }
  }

  function restoreHelpers(autoFiredHelpers) {
    for (const helper of autoFiredHelpers) {
      if (helper.hired()) {
        continue;
      }

      // the user must have already hired other helper(s)
      if (!App.game.breeding.hatcheryHelpers.canHire()) {
        break;
      }

      helper.hire();
    }

    autoFiredHelpers.clear();
  }

  function managePokerusHelpers(spreadPokerus, autoFiredHelpers) {
    if (spreadPokerus) {
      for (const helper of App.game.breeding.hatcheryHelpers.hired()) {
        if (autoFiredHelpers.has(helper)) {
          continue;
        }

        autoFiredHelpers.add(helper);
        helper.fire();
      }
    } else {
      restoreHelpers(autoFiredHelpers);
    }
  }

  function manageHelpers(shouldSpreadPokerus) {
    const autoFiredHelpers = new Set();
    let pokerusSubscription;

    const disposePokerus = {
      dispose() {
        pokerusSubscription?.dispose();
        restoreHelpers(autoFiredHelpers);
      }
    }

    const subscription = _runAndSubscribe(AutomationSettings.value(SETTINGS_SECTION, "manageHelpers"), (manage) => {
      if (manage) {
        pokerusSubscription = _runAndSubscribe(shouldSpreadPokerus, (spreadPokerus) => managePokerusHelpers(spreadPokerus, autoFiredHelpers));
      } else {
        disposePokerus.dispose();
      }
    });

    return [
      subscription,
      disposePokerus,
    ];
  }

  function breedPokemons(shouldSpreadPokerus) {
    const queueIsEmpty = ko.pureComputed(() => App.game.breeding.queueList().length === 0);
    const hasFreeEggSlot = ko.pureComputed(() => App.game.breeding.hasFreeEggSlot());
    const shouldFillHatchery = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "fillEggSlots"),
      hasFreeEggSlot(),
      queueIsEmpty(),
    ]));

    const subscription = _whenReady(shouldFillHatchery, () => fillHatchery(hasFreeEggSlot, shouldSpreadPokerus()));
    return [subscription];
  }

  function hasUninfectedEgg() {
    return getPokerusEligiblePokemonsInHatchery({ includeHelperSlots: true })
      .some((pokemon) => pokemon.pokerus === GameConstants.Pokerus.Uninfected);
  }

  function automate() {
    const shouldSpreadPokerus = ko.pureComputed(() => _and([
      App.game.keyItems.hasKeyItem(KeyItemType.Pokerus_virus),
      AutomationSettings.getValue(SETTINGS_SECTION, "spreadPokerus"),
      App.game.party.caughtPokemon.some((pokemon) => _and([
        pokemon.isHatchable(),
        pokemon.pokerus === GameConstants.Pokerus.Uninfected,
      ])) || hasUninfectedEgg(),
    ]));
    _automate(() => _and([
      App.game.breeding.canAccess(),
      AutomationSettings.isEnabled(SETTINGS_SECTION),
    ]), [
      () => breedPokemons(shouldSpreadPokerus),
      () => manageHelpers(shouldSpreadPokerus),
      hatchEggs,
    ]);
  };

  return {
    automate,
    candidatesToBreed,
  }
})();
