"use strict";

const farm = (() => {
  const SETTINGS_SECTION = "farm";

  function catchWanderer(plot) {
    const { wanderer } = plot;
    const gooey = MulchType.Gooey_Mulch;
    const caught = App.game.party.alreadyCaughtPokemonByName(wanderer.name);
    const pokerus = caught ? App.game.party.getPokemonByName(wanderer.name).pokerus : GameConstants.Pokerus.Uninfected;

    const priority = _or([
      !caught,
      pokerus === GameConstants.Pokerus.Contagious,
      wanderer.shiny,
    ])

    const shouldMulch = _and([
      App.game.farming.hasMulch(gooey),
      AutomationSettings.getValue(SETTINGS_SECTION, "useGooeyMulch"),
      plot.mulch === MulchType.None,
      priority,
    ])

    if (shouldMulch) {
      App.game.farming.addMulch(plot.index, gooey);
      if (plot.mulch !== gooey) {
        console.error("[pokeclicker-automation] farm: failed to apply Gooey Mulch before catching wanderer", {
          plot: plot.index,
          pokemon: wanderer.name,
        });
      }
    }

    App.game.farming.handleWanderer(plot);
  }

  function catchWanderers() {
    const subscriptions = App.game.farming.plotList.map((plot) => {
      const shouldCatch = ko.pureComputed(() => _and([
        AutomationSettings.getValue(SETTINGS_SECTION, "catchWanderers"),
        plot.canCatchWanderer(),
      ]));

      return _whenReady(shouldCatch, () => catchWanderer(plot));
    });
    return subscriptions;
  }

  function harvestWitheringBerries() {
    const subscriptions = App.game.farming.plotList.map((plot) => {
      const shouldHarvest = ko.pureComputed(() => {
        if (!AutomationSettings.getValue(SETTINGS_SECTION, "harvestWitheringBerries")) {
          return false;
        }

        if (plot.berry === BerryType.None || plot.isSafeLocked || plot.stage() !== PlotStage.Berry) {
          return false;
        }

        const growthMultiplier = App.game.farming.getGrowthMultiplier() * plot.getGrowthMultiplier();
        if (growthMultiplier === 0) {
          // freeze mulch
          return false;
        }

        const remainingGrowth = plot.berryData.growthTime[PlotStage.Berry] - plot.age;
        return remainingGrowth <= growthMultiplier;
      });

      return _whenReady(shouldHarvest, () => App.game.farming.harvest(plot.index));
    });
    return subscriptions;
  }

  function automate() {
    _automate(() => _and([
      App.game.farming.canAccess(),
      AutomationSettings.isEnabled(SETTINGS_SECTION),
    ]), [
      catchWanderers,
      harvestWitheringBerries,
    ]);
  };

  return {
    automate,
  }
})();
