"use strict";

const automateFarm = (() => {
  function catchWanderers() {
    App.game.farming.plotList.forEach((plot) => {
      _whenReady(plot._wanderer, () => App.game.farming.handleWanderer(plot));
    });
  }

  function harvestWitheringBerries() {
    App.game.farming.plotList.forEach((plot) => {
      const shouldHarvest = ko.pureComputed(() => {
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

      _whenReady(shouldHarvest, () => App.game.farming.harvest(plot.index));
    });
  }

  function automate() {
    catchWanderers();
    harvestWitheringBerries();
  }

  return function automateFarm() {
    ko.when(() => App.game.farming.canAccess(), automate);
  };
})();
