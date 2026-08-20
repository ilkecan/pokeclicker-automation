"use strict";

const hatchery = (() => {
  const SETTINGS_SECTION = "hatchery";

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

  function fillHatchery(queueIsEmpty, hasFreeEggSlot) {
    if (!queueIsEmpty()) {
      // something is queued (manually, by the player), back off and let the
      // game's own queue-consumption fill the slot instead of racing it.
      return;
    }

    for (const p of BreedingController.hatcherySortedFilteredList()) {
      if (!p.isHatchable()) {
        continue;
      }

      if (!hasFreeEggSlot()) {
        break;
      }

      App.game.breeding.addPokemonToHatchery(p);
    }
  }

  function breedPokemons() {
    const queueIsEmpty = ko.pureComputed(() => App.game.breeding.queueList().length === 0);
    const hasFreeEggSlot = ko.pureComputed(() => App.game.breeding.hasFreeEggSlot());
    const shouldFillHatchery = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "fillEggSlots"),
      queueIsEmpty(),
      hasFreeEggSlot(),
    ]));

    const subscription = _whenReady(shouldFillHatchery, () => fillHatchery(queueIsEmpty, hasFreeEggSlot));
    return [subscription];
  }

  function automate() {
    _automate(() => _and([
      App.game.breeding.canAccess(),
      AutomationSettings.isEnabled(SETTINGS_SECTION),
    ]), [
      hatchEggs,
      breedPokemons,
    ]);
  };

  return {
    automate,
  }
})();
