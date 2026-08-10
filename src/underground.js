"use strict";

function _dischargeBattery() {
  _whenReady(App.game.underground.battery.canDischarge, () => App.game.underground.battery.discharge());
}

function _useSurvey() {
  const tool = App.game.underground.tools.getTool(UndergroundToolType.Survey);
  _whenReady(tool.canUseTool, () => App.game.underground.tools.useTool(UndergroundToolType.Survey, 0, 0));
}

function _dig() {
  _dischargeBattery();
  _useSurvey();
}

function _sellUndergroundTreasures() {
  const treasures = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Diamond);
  const treasuresToSell = treasures.filter((treasure) => ItemList[treasure.itemName].basePrice === Infinity); // exclude Everstone
  for (const treasure of treasuresToSell) {
    const canSell = ko.pureComputed(() => treasure.isUnlocked() && !treasure.sellLocked() && player.itemList[treasure.itemName]() > 0);
    _whenReady(canSell, () => UndergroundTrading.quickSell(treasure));
  }
}

function _sellTreasures() {
  _sellUndergroundTreasures();
}

function automateUnderground() {
  _dig();
  _sellTreasures();
}
