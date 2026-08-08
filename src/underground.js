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

function _useSurvey() {
  const tool = App.game.underground.tools.getTool(UndergroundToolType.Survey);
  if (tool.canUseTool()) {
    App.game.underground.tools.useTool(UndergroundToolType.Survey, 0, 0);
  }

  tool.canUseTool.subscribe((ready) => {
    if (ready) {
      App.game.underground.tools.useTool(UndergroundToolType.Survey, 0, 0);
    }
  });
}

function automateUnderground() {
  _dischargeBattery();
  _useSurvey();
}
