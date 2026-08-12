"use strict";

function _claimCompletedQuests() {
  const claimableQuests = ko.pureComputed(() =>
    App.game.quests.questList().filter(
      (quest) => quest.isCompleted() && !quest.claimed(),
    ),
  );

  const canClaimQuest = ko.pureComputed(() => claimableQuests().length > 0);

  _whenReady(canClaimQuest, () => {
    for (const quest of claimableQuests()) {
      App.game.quests.claimQuest(quest.index);
    }
  });
}

const _questOrder = [
  "CatchShiniesQuest",
  "HatchEggsQuest",
  "GainGemsQuest",
  "MineLayersQuest",
  "MineItemsQuest",

  "GainMoneyQuest",
  "DefeatPokemonsQuest",

  "GainTokensQuest",
  "CapturePokemonsQuest",
  "CapturePokemonTypesQuest",
  "UsePokeballQuest",

  "DefeatGymQuest",
  "DefeatDungeonQuest",

  "HarvestBerriesQuest",
  "GainFarmPointsQuest",

  "ClearBattleFrontierQuest",
  "CatchShadowsQuest",
  "UseOakItemQuest",
];

const _questPriorityMapping = new Map(_questOrder.map((questType, priority) => [questType, priority]));

function _questPriority(quest) {
  return _questPriorityMapping.get(quest.constructor.name) ?? Infinity;
}

function _chooseQuestsToStart(quests, number) {
  return quests.sort((a, b) => _questPriority(a) - _questPriority(b)).slice(0, number);
}

function _startQuests() {
  const emptyQuestSlots = ko.pureComputed(() => App.game.quests.questSlots() - App.game.quests.currentQuests().length);
  const unstartedQuests = ko.pureComputed(() => App.game.quests.incompleteQuests().filter((quest) => !quest.inProgress()));

  _whenReady(ko.pureComputed(() => emptyQuestSlots() > 0 && unstartedQuests().length > 0), () => {
    for (const quest of _chooseQuestsToStart(unstartedQuests(), emptyQuestSlots())) {
      App.game.quests.beginQuest(quest.index);
    }
  });
}

function _automateQuests() {
  _claimCompletedQuests();
  _startQuests();
}

function automateQuests() {
  ko.when(() => App.game.quests.isDailyQuestsUnlocked(), _automateQuests);
}
