"use strict";

function _dischargeBattery() {
  _whenReady(App.game.underground.battery.canDischarge, () => App.game.underground.battery.discharge());
}

function _useSurvey() {
  const tool = App.game.underground.tools.getTool(UndergroundToolType.Survey);
  _whenReady(tool.canUseTool, () => App.game.underground.tools.useTool(UndergroundToolType.Survey, 0, 0));
}

function automateUnderground() {
  _dischargeBattery();
  _useSurvey();
}
