"use strict";

const farm = (() => {
  const SETTINGS_SECTION = "farm";

  function catchWanderers() {
    const subscriptions = App.game.farming.plotList.map((plot) => {
      const shouldCatch = ko.pureComputed(() => _and([
        AutomationSettings.getValue(SETTINGS_SECTION, "catchWanderers"),
        plot._wanderer(),
      ]));
      return _whenReady(shouldCatch, () => App.game.farming.handleWanderer(plot));
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
