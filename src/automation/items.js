"use strict";

const items = (() => {
  const SETTINGS_SECTION = "items";

  function chooseHeldItem(pokemon) {
    const item = ItemList.Wonder_Chest;
    if (!item.canUse(pokemon)) {
      return null;
    }

    return item;
  }

  function canGiveItem(item) {
    if (item === null) {
      return false;
    }

    if (player.amountOfItem(item.name) <= 0) {
      return false;
    }

    return true;
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
        return canGiveItem(item);
      });
    });

    const subscription = _whenReady(canGiveHeldItem, function() {
      for (const pokemon of pokemons()) {
        const item = chooseHeldItem(pokemon);
        if (!canGiveItem(item)) {
          continue;
        }

        pokemon.giveHeldItem(item);
      }
    });

    return [subscription];
  }

  function automate() {
    _automate(AutomationSettings.enabled(SETTINGS_SECTION), [giveHeldItems]);
  };

  return {
    automate,
  }
})();
