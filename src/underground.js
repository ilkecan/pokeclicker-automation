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

function _flattenQuest(quest) {
  return quest instanceof MultipleQuestsQuest ? quest.quests : [quest];
}

function _getRemainingQuestAmount(quest) {
  return Math.max(0, quest.amount - (quest.focus() - quest.initial()));
}

function _sellGemPlates() {
  const gemPlates = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Gem);
  const activeGemQuests = ko.pureComputed(() => {
    const questLineQuests = App.game.quests.questLines()
      .filter((questLine) => questLine.state() === QuestLineState.started)
      .flatMap((questLine) => _flattenQuest(questLine.curQuestObject()));

    return [
      ...App.game.quests.questList(),
      ...questLineQuests,
    ].filter((quest) => quest instanceof GainGemsQuest && quest.inProgress() && quest.progress() < 1);
  });

  for (const gemPlate of gemPlates) {
    const amountToSell = ko.pureComputed(() => {
      if (gemPlate.sellLocked()) {
        return 0;
      }

      const gemsRemaining = activeGemQuests()
        .filter((quest) => quest.type === gemPlate.type)
        .reduce((maximum, quest) => Math.max(maximum, _getRemainingQuestAmount(quest)), 0);
      const availablePlates = player.itemList[gemPlate.itemName]();

      return Math.min(Math.ceil(gemsRemaining / gemPlate.value), availablePlates);
    });

    _whenReady(
      ko.pureComputed(() => amountToSell() > 0),
      () => UndergroundController.sellMineItem(gemPlate, amountToSell()),
    );
  }
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
  _sellGemPlates();
  _sellUndergroundTreasures();
}

function _automateUnderground() {
  _dig();
  _sellTreasures();
}

function automateUnderground() {
  ko.when(() => App.game.underground.canAccess(), _automateUnderground);
}
