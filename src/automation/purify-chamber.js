"use strict";

const purifyChamber = (() => {
  const SETTINGS_SECTION = "purifyChamber";

  function highestAttackShadowPokemon() {
    let selectedPokemon = { attack: 0 };
    for (const pokemon of App.game.party.caughtPokemon) {
      if (pokemon.shadow !== GameConstants.ShadowStatus.Shadow) {
        continue;
      }

      if (pokemon.attack > selectedPokemon.attack) {
        selectedPokemon = pokemon;
      }
    }
    return selectedPokemon;
  }

  function purifyPokemons() {
    let purificationSubscription;
    const disposePurification = {
      dispose() {
        purificationSubscription?.dispose();
      }
    };

    const subscription = _runAndSubscribe(AutomationSettings.value(SETTINGS_SECTION, "purifyPokemon"), (enabled) => {
      if (enabled) {
        // Flow stays at 0 when there is no more shadow Pokemon.
        const ready = ko.pureComputed(() => App.game.purifyChamber.currentFlow() >= App.game.purifyChamber.flowNeeded());
        purificationSubscription = _whenReady(ready, () => {
          App.game.purifyChamber.selectedPokemon(highestAttackShadowPokemon());
          App.game.purifyChamber.purify();
        });
      } else {
        disposePurification.dispose();
      }
    });

    return [
      disposePurification,
      subscription,
    ];
  }

  function automate() {
    _automate(() => _and([
      AutomationSettings.isEnabled(SETTINGS_SECTION),
      PurifyChamber.shortcutVisible(),
    ]), [purifyPokemons]);
  };

  return {
    automate,
  }
})();
