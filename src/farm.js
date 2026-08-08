"use strict";

function _catchWanderers() {
  App.game.farming.plotList.forEach((plot) => {
    _whenReady(plot._wanderer, () => App.game.farming.handleWanderer(plot));
  });
}

function automateFarm() {
  _catchWanderers();
}
