"use strict";

const automateHatchery = (() => {
  function hatchEggWhenReady(egg, index, subscriptions) {
    subscriptions[index]?.dispose();
    subscriptions[index] = null;

    if (egg.isNone()) {
      return;
    }

    const shouldHatch = ko.pureComputed(() => _and([
      AutomationSettings.getValue("hatchery", "hatchReadyEggs"),
      egg.canHatch(),
      App.game.breeding.hatcheryHelpers.hired().length <= index,
    ]));

    subscriptions[index] = ko.when(shouldHatch, () => App.game.breeding.hatchPokemonEgg(index));
  }

  function hatchEggs() {
    const eggSlots = App.game.breeding.eggList;
    const subscriptions = Array(eggSlots.length);
    eggSlots.forEach((eggSlot, index) => {
      _runAndSubscribe(eggSlot, (egg) => hatchEggWhenReady(egg, index, subscriptions));
    });
  }

  function isQueueEmpty() {
    return App.game.breeding.queueList().length === 0;
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
    const queueIsEmpty = ko.pureComputed(isQueueEmpty);
    const hasFreeEggSlot = ko.pureComputed(() => App.game.breeding.hasFreeEggSlot());
    const shouldFillHatchery = ko.pureComputed(() => _and([
      AutomationSettings.getValue("hatchery", "fillEggSlots"),
      queueIsEmpty(),
      hasFreeEggSlot(),
    ]));

    _whenReady(shouldFillHatchery, () => fillHatchery(queueIsEmpty, hasFreeEggSlot));
  }

  function automate() {
    hatchEggs();
    breedPokemons();
  }

  return function automateHatchery() {
    ko.when(() => App.game.breeding.canAccess(), automate);
  };
})();
