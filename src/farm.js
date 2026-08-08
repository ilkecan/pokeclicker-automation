"use strict";

function _catchWanderers() {
  App.game.farming.plotList.forEach((plot) => {
    if (plot.canCatchWanderer()) {
      App.game.farming.handleWanderer(plot);
    }

    plot._wanderer.subscribe((wanderer) => {
      if (wanderer) {
        App.game.farming.handleWanderer(plot);
      }
    });
  });
}

function automateFarm() {
  _catchWanderers();
}
