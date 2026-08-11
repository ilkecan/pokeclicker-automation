"use strict";

function _chooseHeldItem(_pokemon) {
  return ItemList.Wonder_Chest;
}

function _pokemonsWithoutHeldItem() {
  const sort = Settings.getSetting("heldItemSort").observableValue();
  const direction = Settings.getSetting("heldItemSortDirection").observableValue();

  return App.game.party.caughtPokemon
    .filter((pokemon) => pokemon.id > 0 && !pokemon.heldItem())
    .sort(PartyController.compareBy(sort, direction));
}

function _giveHeldItems() {
  const pokemons = ko.pureComputed(_pokemonsWithoutHeldItem);

  const canGiveHeldItem = ko.pureComputed(() =>
    pokemons().some((pokemon) => {
      const item = _chooseHeldItem(pokemon);
      return player.amountOfItem(item.name) && item.canUse(pokemon);
    })
  );

  _whenReady(canGiveHeldItem, function() {
    for (const pokemon of pokemons()) {
      const item = _chooseHeldItem(pokemon);
      pokemon.giveHeldItem(item);
    }
  });
}

function automateItems() {
  _giveHeldItems();
}
