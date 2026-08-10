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

function automateQuests() {
  _claimCompletedQuests();
}
