"use strict";

const items = (() => {
  const SETTINGS_SECTION = "items";

  function chooseHeldItem(_pokemon) {
    return ItemList.Wonder_Chest;
  }

  function pokemonsWithoutHeldItem() {
    const sort = Settings.getSetting("heldItemSort").observableValue();
    const direction = Settings.getSetting("heldItemSortDirection").observableValue();

    return App.game.party.caughtPokemon
      .filter((pokemon) => pokemon.id > 0 && !pokemon.heldItem())
      .sort(PartyController.compareBy(sort, direction));
  }

  function giveHeldItems() {
    const pokemons = ko.pureComputed(pokemonsWithoutHeldItem);

    const canGiveHeldItem = ko.pureComputed(() => {
      if (!AutomationSettings.getValue(SETTINGS_SECTION, "giveHeldItems")) {
        return false;
      }

      return pokemons().some((pokemon) => {
        const item = chooseHeldItem(pokemon);
        return player.amountOfItem(item.name) > 0 && item.canUse(pokemon);
      });
    });

    const subscription = _whenReady(canGiveHeldItem, function() {
      for (const pokemon of pokemons()) {
        const item = chooseHeldItem(pokemon);
        pokemon.giveHeldItem(item);
      }
    });

    return [subscription];
  }

  function automate() {
    _automate(() => AutomationSettings.isEnabled(SETTINGS_SECTION), [giveHeldItems]);
  };

  return {
    automate,
  }
})();
