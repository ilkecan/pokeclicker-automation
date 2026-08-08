"use strict";

function _dischargeBattery() {
  if (App.game.underground.battery.canDischarge()) {
    App.game.underground.battery.discharge();
  }

  App.game.underground.battery.canDischarge.subscribe((ready) => {
    if (ready) {
      App.game.underground.battery.discharge();
    }
  });
}

function automateUnderground() {
  _dischargeBattery();
}
