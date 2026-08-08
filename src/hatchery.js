"use strict";

function _hatchEggWhenReady(egg, index, subscriptions) {
  subscriptions[index]?.dispose();
  subscriptions[index] = null;

  if (egg.isNone()) {
    return;
  }

  if (egg.canHatch()) {
    App.game.breeding.hatchPokemonEgg(index);
    return;
  }

  const canHatch = ko.pureComputed(() => egg.canHatch());
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

function _fillHatchery() {
  if (!_queueIsEmpty()) {
    // something is queued (manually, by the player), back off and let the
    // game's own queue-consumption fill the slot instead of racing it.
    return;
  }

  for (const p of BreedingController.hatcherySortedFilteredList()) {
    if (!p.isHatchable()) {
      continue;
    }

    if (!App.game.breeding.hasFreeEggSlot()) {
      break;
    }

    App.game.breeding.addPokemonToHatchery(p);
  }
}

function _breedPokemons() {
  _fillHatchery();

  const eggSlotFree = ko.pureComputed(() => App.game.breeding.hasFreeEggSlot());
  eggSlotFree.subscribe((free) => {
    if (free) {
      _fillHatchery();
    }
  });

  const queueEmpty = ko.pureComputed(_queueIsEmpty);
  queueEmpty.subscribe((empty) => {
    if (empty) {
      _fillHatchery();
    }
  });
}

function automateHatchery() {
  _hatchEggs();
  _breedPokemons();
}
