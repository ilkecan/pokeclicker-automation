"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

function loadGym(t, {
  autoRestart = true,
  smartAutoRestart = false,
  quests = [],
  stats = [0],
} = {}) {
  const harness = createHarness(t);
  const { ko } = harness.game;
  const sectionEnabled = ko.observable(true);
  const parent = ko.observable(autoRestart);
  const smart = ko.observable(smartAutoRestart);
  const currentQuests = ko.observable(quests);
  const defeatedStats = stats.map((value) => typeof value === "function" ? value : ko.observable(value));
  const settingCalls = [];
  const settings = {
    enabled: () => sectionEnabled,
    value(section, id) {
      settingCalls.push({ section, id });
      return id === "autoRestart" ? parent : smart;
    },
    getValue(section, id) {
      return this.value(section, id)();
    },
  };
  const target = {
    town: "Pewter City",
    clears: () => 1,
    areaStatus: () => [],
  };
  const originalStartGym = function(targetGym, restart) {
    this.autoRestart(restart);
    this.gymObservable(targetGym);
    this.started = { target: targetGym, restart };
  };
  const App = {
    game: {
      quests: { currentQuests },
      statistics: { gymsDefeated: defeatedStats },
      wallet: {
        gained: 0,
        spent: 0,
        gainMoney(amount) { this.gained += amount; },
        loseAmount(amount) { this.spent += amount; return true; },
      },
      gameState: "gym",
    },
  };
  const GameConstants = { getGymIndex: () => 0 };
  const originalGymWon = function(targetGym) {
    const stat = App.game.statistics.gymsDefeated[GameConstants.getGymIndex(targetGym.town)];
    stat(stat() + 1);
    if (this.autoRestart()) {
      const cost = targetGym.clears() >= 100 ? 0 : targetGym.moneyReward * 2;
      if (cost === 0 || App.game.wallet.loseAmount(cost)) {
        this.startGym(targetGym, this.autoRestart(), false);
        return;
      }
    }
    App.game.wallet.gainMoney(targetGym.moneyReward);
    App.game.gameState = "town";
  };
  const GymRunner = {
    autoRestart: ko.observable(false),
    gymObservable: ko.observable(target),
    startGym: originalStartGym,
    gymWon: originalGymWon,
    started: null,
  };
  const DefeatGymQuest = class DefeatGymQuest {};
  const context = {
    App,
    AutomationSettings: settings,
    DefeatGymQuest,
    GymRunner,
    GameConstants,
    areaStatus: { missingAchievement: "missingAchievement" },
  };
  const gym = harness.loadAutomation("gym", context).automation;
  gym.automate();
  harness.addCleanup(() => sectionEnabled(false));

  return {
    ko,
    ...context,
    originalStartGym,
    originalGymWon,
    parent,
    sectionEnabled,
    settingCalls,
    currentQuests,
    target,
  };

}
function createGymQuest(state, town, completed) {
  const quest = new state.DefeatGymQuest();
  const completedState = state.ko.observable(completed);
  quest.gymTown = town;
  quest.isCompleted = () => completedState();
  quest.setCompleted = completedState;
  return quest;
}

function settle(state) {
  state.ko.tasks.runEarly();
}

test("smart restart stops completed gyms and retains pending requirements", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), false);

  state.target.areaStatus = () => ["missingAchievement"];
  state.GymRunner.startGym(state.target, true);
  settle(state);
  state.target.areaStatus = () => [];
  const matching = createGymQuest(state, state.target.town, false);
  state.currentQuests([matching]);
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), true);
});

test("secret completed achievements do not force smart autorestart", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  state.target.areaStatus = () => [];
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), false);
});

test("quests for other gyms are ignored", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  const other = createGymQuest(state, "Cerulean City", false);
  state.currentQuests([other]);
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), false);
});

test("startGym omitted argument keeps clears default and smart disabled preserves restart", (t) => {
  const state = loadGym(t, { smartAutoRestart: false });
  assert.equal(state.target.clears(), 1);
  state.GymRunner.startGym(state.target);
  assert.equal(state.settingCalls.some(({ id }) => id === "autoRestart"), true);
  settle(state);
  assert.equal(state.GymRunner.started.restart, true, JSON.stringify(state.GymRunner.started));
  assert.equal(state.GymRunner.autoRestart(), true);
});

test("smart start stops a completed gym after restarting the same gym", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  settle(state);
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), false);
  state.GymRunner.startGym(state.target, true);
  settle(state);
  assert.equal(state.GymRunner.autoRestart(), false);
});

test("smart final clear pays normally without restart cost", (t) => {
  const state = loadGym(t, { smartAutoRestart: true, stats: [0] });
  state.target.moneyReward = 25;
  state.GymRunner.gymWon(state.target);
  settle(state);
  assert.equal(state.GymRunner.started, null);
  assert.equal(state.App.game.wallet.spent, 0);
  assert.equal(state.App.game.wallet.gained, 25);
  assert.equal(state.App.game.gameState, "town");
  assert.equal(state.GymRunner.autoRestart(), false);
});

test("completed matching quests stop while incomplete matching quests restart", (t) => {
  const state = loadGym(t, { smartAutoRestart: true, stats: [0] });
  const quest = createGymQuest(state, "Pewter City", true);
  state.currentQuests([quest]);
  state.GymRunner.autoRestart(true);
  settle(state);
  state.GymRunner.gymWon(state.target);
  settle(state);
  assert.equal(state.GymRunner.started, null);

  quest.setCompleted(false);
  settle(state);
  state.GymRunner.autoRestart(true);
  state.GymRunner.gymWon(state.target);
  settle(state);
  assert.equal(state.GymRunner.started.restart, true);
});

test("preserves observable identity and restores methods without stacking", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  const autoRestartObservable = state.GymRunner.autoRestart;
  const wrappedStart = state.GymRunner.startGym;
  state.parent(false);
  assert.equal(state.GymRunner.startGym, state.originalStartGym);
  assert.equal(state.GymRunner.gymWon, state.originalGymWon);

  state.parent(true);
  assert.notEqual(state.GymRunner.startGym, wrappedStart);
  assert.equal(state.GymRunner.autoRestart, autoRestartObservable);

  state.sectionEnabled(false);
  assert.equal(state.GymRunner.startGym, state.originalStartGym);
  assert.equal(state.GymRunner.gymWon, state.originalGymWon);
});

test("section disposal restores both methods while auto restart remains enabled", (t) => {
  const state = loadGym(t, { smartAutoRestart: true });
  state.sectionEnabled(false);
  assert.equal(state.GymRunner.startGym, state.originalStartGym);
  assert.equal(state.GymRunner.gymWon, state.originalGymWon);
  assert.equal(state.parent(), true);
});
