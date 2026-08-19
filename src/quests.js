"use strict";

const automateQuests = (() => {
  const SETTINGS_SECTION = "quests";

  function claimCompletedQuests() {
    const claimableQuests = ko.pureComputed(() =>
      App.game.quests.questList().filter((quest) => _and([
        quest.isCompleted(),
        !quest.claimed(),
      ]))
    );

    const canClaimQuest = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "claimCompletedQuests"),
      claimableQuests().length > 0,
    ]));

    const subscription = _whenReady(canClaimQuest, () => {
      for (const quest of claimableQuests()) {
        App.game.quests.claimQuest(quest.index);
      }
    });
    return [subscription];
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
    const canStartQuest = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "startQuests"),
      emptyQuestSlots() > 0,
      unstartedQuests().length > 0,
    ]));

    const subscription = _whenReady(canStartQuest, () => {
      for (const quest of chooseQuestsToStart(unstartedQuests(), emptyQuestSlots())) {
        App.game.quests.beginQuest(quest.index);
      }
    });
    return [subscription];
  }

  return function automateQuests() {
    _automate(() => _and([
      App.game.quests.isDailyQuestsUnlocked(),
      AutomationSettings.isEnabled(SETTINGS_SECTION),
    ]), [
      claimCompletedQuests,
      startQuests,
    ]);
  };
})();
