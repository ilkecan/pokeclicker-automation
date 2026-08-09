"use strict";

function _hatchEggWhenReady(egg, index, subscriptions) {
  subscriptions[index]?.dispose();
  subscriptions[index] = null;

  if (egg.isNone()) {
    return;
  }

  const canHatch = ko.pureComputed(() => egg.canHatch());

  if (canHatch()) {
    App.game.breeding.hatchPokemonEgg(index);
    return;
  }

  subscriptions[index] = canHatch.subscribe((ready) => {
    if (ready) {
      App.game.breeding.hatchPokemonEgg(index);
    }
  });
}

function _hatchEggs() {
  const eggSlots = App.game.breeding.eggList;
  const subscriptions = Array(eggSlots.length);
  eggSlots.forEach((eggSlot, index) => {
    _hatchEggWhenReady(eggSlot(), index, subscriptions);
    eggSlot.subscribe((egg) => _hatchEggWhenReady(egg, index, subscriptions));
  });
}

function _queueIsEmpty() {
  return App.game.breeding.queueList().length === 0;
}

function _fillHatchery(queueIsEmpty, hasFreeEggSlot) {
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

function _breedPokemons() {
  const queueIsEmpty = ko.pureComputed(_queueIsEmpty);
  const hasFreeEggSlot = ko.pureComputed(() => App.game.breeding.hasFreeEggSlot());
  const fillHatchery = () => _fillHatchery(queueIsEmpty, hasFreeEggSlot);

  _whenReady(hasFreeEggSlot, fillHatchery);
  _whenReady(queueIsEmpty, fillHatchery);
}

function automateHatchery() {
  _hatchEggs();
  _breedPokemons();
}
