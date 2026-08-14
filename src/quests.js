"use strict";

const automateQuests = (() => {
  function claimCompletedQuests() {
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

  const questOrder = [
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

  const questPriorityMapping = new Map(questOrder.map((questType, priority) => [questType, priority]));

  function questPriority(quest) {
    return questPriorityMapping.get(quest.constructor.name) ?? Infinity;
  }

  function chooseQuestsToStart(quests, number) {
    return quests.sort((a, b) => questPriority(a) - questPriority(b)).slice(0, number);
  }

  function startQuests() {
    const emptyQuestSlots = ko.pureComputed(() => App.game.quests.questSlots() - App.game.quests.currentQuests().length);
    const unstartedQuests = ko.pureComputed(() => App.game.quests.incompleteQuests().filter((quest) => !quest.inProgress()));

    _whenReady(ko.pureComputed(() => emptyQuestSlots() > 0 && unstartedQuests().length > 0), () => {
      for (const quest of chooseQuestsToStart(unstartedQuests(), emptyQuestSlots())) {
        App.game.quests.beginQuest(quest.index);
      }
    });
  }

  function automate() {
    claimCompletedQuests();
    startQuests();
  }

  return function automateQuests() {
    ko.when(() => App.game.quests.isDailyQuestsUnlocked(), automate);
  };
})();
