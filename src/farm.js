"use strict";

function _catchWanderers() {
  App.game.farming.plotList.forEach((plot) => {
    _whenReady(plot._wanderer, () => App.game.farming.handleWanderer(plot));
  });
}

function _harvestWitheringBerries() {
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

function automateFarm() {
  _catchWanderers();
  _harvestWitheringBerries();
}
