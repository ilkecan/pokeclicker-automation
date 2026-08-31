"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { GameConstants } = constantsHarness.game;
const { DungeonTileType } = GameConstants;

function createDungeonGlobals() {
  return {
    dungeonList: {
      eventDungeon: {
        lootTable: {
          mythic: [{
            requirement: {
              isCompleted: () => {
                throw new Error("event requirement evaluated while loading automation");
              },
            },
          }],
        },
      },
    },
  };
}

function loadDungeon(t) {
  return createHarness(t).loadAutomation("dungeon", createDungeonGlobals()).automation;
}

function createState({
  targetType,
  targetPosition = [4, 4],
  targetChestTier = null,
  options = {},
  targetCounts = { chests: 0, battles: 0 },
  visited = [[0, 0], [1, 0], [2, 0]],
  progressionPosition = null,
}) {
  const size = 5;
  const board = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ({
      x,
      y,
      floor: 0,
      isVisible: false,
      isVisited: false,
      type: null,
      chestTier: null,
    }))
  );

  for (const [x, y] of visited) {
    board[y][x].isVisited = true;
  }

  let progression = null;
  if (progressionPosition) {
    const [x, y] = progressionPosition;
    progression = board[y][x];
    progression.isVisible = true;
    progression.isVisited = true;
    progression.type = DungeonTileType.boss;
  }

  const normalizedTargetType = {
    boss: DungeonTileType.boss,
    ladder: DungeonTileType.ladder,
    chest: DungeonTileType.chest,
    enemy: DungeonTileType.enemy,
  }[targetType] ?? targetType;
  const [targetX, targetY] = targetPosition;
  const target = board[targetY][targetX];
  target.isVisible = true;
  target.type = normalizedTargetType;
  if (normalizedTargetType === DungeonTileType.chest) {
    target.chestTier = targetChestTier;
  }
  if (normalizedTargetType === DungeonTileType.boss) {
    progression = target;
  }

  return {
    position: { x: 0, y: 0, floor: 0 },
    options: {
      searchAllChests: false,
      openAccessibleChests: true,
      minimumChestTier: "common",
      fightAllBattles: false,
      ...options,
    },
    targetCounts: [targetCounts],
    chestsOpened: [0],
    battlesWon: [0],
    board: [board],
    allTiles: [board.flat()],
    progression,
  };
}

function assertMove(action, coordinates) {
  assert.deepEqual({ ...action }, {
    type: "move",
    ...coordinates,
    floor: 0,
  });
}

let dungeon;
test.beforeEach((t) => {
  dungeon = loadDungeon(t);
});

test("uses the fixed chest tier ordering before game initialization", () => {
  assert.deepEqual(Object.keys(dungeon.ChestTier), ["common", "rare", "epic", "legendary", "mythic"]);
  assert.deepEqual(Object.values(dungeon.ChestTier), [0, 1, 2, 3, 4]);
});

test("moves toward an inaccessible battle during target discovery", (t) => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 2 },
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 3, y: 0 });
});

test("finds an inaccessible battle beyond an accessible battle", (t) => {
  const state = createState({
    targetType: "enemy",
    targetPosition: [0, 4],
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 3 },
  });
  const accessibleBattle = state.board[0][0][1];
  accessibleBattle.isVisible = true;
  accessibleBattle.type = DungeonTileType.enemy;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("finds an inaccessible chest beyond an accessible chest", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [0, 4],
    options: { searchAllChests: true },
    targetCounts: { chests: 3, battles: 0 },
  });
  const accessibleChest = state.board[0][0][1];
  accessibleChest.isVisible = true;
  accessibleChest.type = DungeonTileType.chest;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("routes to inaccessible chests before opening accessible chests", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [0, 4],
    options: { searchAllChests: true },
    targetCounts: { chests: 2, battles: 0 },
    progressionPosition: [4, 0],
  });
  const accessibleChest = state.board[0][0][1];
  accessibleChest.isVisible = true;
  accessibleChest.type = DungeonTileType.chest;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("progresses before opening accessible chests when disabled", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    options: { openAccessibleChests: false, minimumChestTier: "rare" },
    progressionPosition: [4, 0],
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 0 });
});

test("opens accessible common chests by default", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    targetChestTier: "common",
    progressionPosition: [4, 0],
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("skips accessible common chests", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    targetChestTier: "common",
    options: { minimumChestTier: "rare" },
    progressionPosition: [4, 0],
  });
  const rareChest = state.board[0][0][2];
  rareChest.isVisible = true;
  rareChest.type = DungeonTileType.chest;
  rareChest.chestTier = "rare";

  assertMove(dungeon.chooseDungeonAction(state), { x: 2, y: 0 });
});

test("progresses when only accessible chests are common", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    targetChestTier: "common",
    options: { minimumChestTier: "rare" },
    progressionPosition: [4, 0],
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 0 });
});

test("opens the first accessible chest at or above the minimum tier", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    targetChestTier: "common",
    options: { minimumChestTier: "epic" },
    progressionPosition: [4, 0],
  });
  const rareChest = state.board[0][0][2];
  rareChest.isVisible = true;
  rareChest.type = DungeonTileType.chest;
  rareChest.chestTier = "rare";
  const epicChest = state.board[0][0][3];
  epicChest.isVisible = true;
  epicChest.type = DungeonTileType.chest;
  epicChest.chestTier = "epic";

  assertMove(dungeon.chooseDungeonAction(state), { x: 3, y: 0 });
});

test("prioritizes inaccessible progression over secondary targets", (t) => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 2 },
  });
  const progression = state.board[0][4][0];
  progression.isVisible = true;
  progression.type = DungeonTileType.boss;
  state.progression = progression;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("follows inaccessible progression before accessible secondary targets", (t) => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
  });
  const progression = state.board[0][4][0];
  progression.isVisible = true;
  progression.type = DungeonTileType.boss;
  state.progression = progression;
  const accessibleBattle = state.board[0][0][1];
  accessibleBattle.isVisible = true;
  accessibleBattle.type = DungeonTileType.enemy;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("moves toward an inaccessible battle after all targets are visible", (t) => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
    progressionPosition: [4, 0],
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 1 });
});

test("moves toward an inaccessible chest from the closest visited tile", (t) => {
  const state = createState({
    targetType: "chest",
    options: { searchAllChests: true },
    targetCounts: { chests: 1, battles: 0 },
    progressionPosition: [4, 0],
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 1 });
});

test("prefers non-battle exploration tiles when battles are disabled", (t) => {
  const state = createState({
    targetType: null,
    options: { fightAllBattles: false },
    visited: [[0, 0]],
  });
  const battle = state.board[0][0][1];
  battle.isVisible = true;
  battle.type = DungeonTileType.enemy;
  const chest = state.board[0][1][0];
  chest.isVisible = true;
  chest.type = DungeonTileType.chest;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("does not classify unseen tiles as non-battles", (t) => {
  const state = createState({
    targetType: null,
    options: { fightAllBattles: false },
    visited: [[0, 0]],
  });
  const chest = state.board[0][1][0];
  chest.isVisible = true;
  chest.type = DungeonTileType.chest;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("prefers non-battle exploration regardless of fight-all", (t) => {
  const state = createState({
    targetType: null,
    options: { fightAllBattles: true },
    visited: [[0, 0]],
  });
  const battle = state.board[0][0][1];
  battle.isVisible = true;
  battle.type = DungeonTileType.enemy;
  const chest = state.board[0][1][0];
  chest.isVisible = true;
  chest.type = DungeonTileType.chest;

  assertMove(dungeon.chooseDungeonAction(state), { x: 0, y: 1 });
});

test("keeps normal exploration when no target is available", (t) => {
  const state = createState({
    targetType: null,
    visited: [[0, 0]],
  });

  const action = dungeon.chooseDungeonAction(state);
  assert.equal(action.type, "move");
  const tile = state.board[action.floor][action.y][action.x];
  assert.equal(tile.isVisited, false);
  const hasVisitedNeighbor = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([x, y]) =>
    state.board[action.floor][action.y + y]?.[action.x + x]?.isVisited
  );
  assert.equal(hasVisitedNeighbor, true);
});

function loadRestartDungeon(t, {
  smartAutoRestart = true,
  restartUponLoss = true,
  restartUponWin = true,
  achievementsComplete = true,
  pokemonComplete = true,
  possiblePokemon = ["Pikachu"],
  quest = null,
  timeLeft = 1,
  entrance = false,
  guidesHired = false,
  dungeonFinished = true,
} = {}) {
  const harness = createHarness(t);
  const { ko } = harness.game;
  const sectionEnabled = ko.observable(true);
  const currentQuests = ko.observable([]);
  const initialized = [];
  const includeShinyValues = [];
  const settings = {
    smartAutoRestart,
    restartUponLoss,
    restartUponWin,
  };
  const target = {
    name: "Test Dungeon",
    allAvailablePokemon: () => possiblePokemon,
  };
  const dungeonTimeLeft = ko.observable(timeLeft);
  const finished = ko.observable(dungeonFinished);
  const currentTileType = ko.observable(entrance ? GameConstants.DungeonTileType.entrance : "boss");
  const DungeonRunner = {
    timeLeft: dungeonTimeLeft,
    timeLeftPercentage: ko.observable(0),
    dungeonFinished: finished,
    isAchievementsComplete: () => achievementsComplete,
    initializeDungeon(dungeon) {
      initialized.push(dungeon);
      finished(false);
    },
    map: {
      currentTile: () => ({ type: currentTileType }),
    },
  };
  const context = {
    App: {
      game: {
        gameState: "town",
        quests: { currentQuests },
      },
    },
    AutomationSettings: {
      enabled: () => sectionEnabled,
      getValue: (_section, id) => settings[id],
    },
    DefeatDungeonQuest: class DefeatDungeonQuest {},
    DungeonGuides: { hired: () => guidesHired },
    DungeonRunner,
    GameConstants: {
      GameState: { dungeon: "dungeon" },
      DungeonTileType: { entrance: "entrance" },
    },
    RouteHelper: {
      listCompleted: (_pokemon, includeShiny) => {
        includeShinyValues.push(includeShiny);
        return pokemonComplete;
      },
    },
    player: { town: { dungeon: target } },
  };

  if (quest) {
    const dungeonQuest = new context.DefeatDungeonQuest();
    const questCompleted = ko.observable(quest.completed);
    dungeonQuest.dungeon = quest.dungeon;
    dungeonQuest.isCompleted = () => questCompleted();
    currentQuests([dungeonQuest]);
  }

  const dungeon = harness.loadAutomation("dungeon", {
    ...context,
    dungeonList: {},
  }).automation;
  dungeon.automate();
  harness.addCleanup(() => sectionEnabled(false));

  return { dungeon, includeShinyValues, initialized, target };
}

function assertDungeonRestart(t, expected, options = {}) {
  const state = loadRestartDungeon(t, options);
  assert.equal(state.initialized.length > 0, expected);
  return state;
}

test("smart dungeon restart requires every completion condition", (t) => {
  for (const condition of ["achievementsComplete", "quest", "pokemonComplete"]) {
    const options = {};
    if (condition === "achievementsComplete") options.achievementsComplete = false;
    if (condition === "pokemonComplete") options.pokemonComplete = false;
    if (condition === "quest") options.quest = { dungeon: "Test Dungeon", completed: false };
    assertDungeonRestart(t, true, options);
  }
  assertDungeonRestart(t, false);
});

test("completed matching quests do not block smart completion", (t) => {
  assertDungeonRestart(t, false, {
    quest: { dungeon: "Test Dungeon", completed: true },
  });
});

test("other dungeon quests and empty Pokemon lists do not block completion", (t) => {
  const state = assertDungeonRestart(t, false, {
    quest: { dungeon: "Other Dungeon", completed: false },
    pokemonComplete: true,
  });
  assert.deepEqual(state.includeShinyValues, [false]);

  const empty = assertDungeonRestart(t, false, { possiblePokemon: [] });
  assert.deepEqual(empty.includeShinyValues, [false]);
});

test("loss and win settings independently gate smart restart", (t) => {
  assertDungeonRestart(t, true, { timeLeft: -1, achievementsComplete: false });
  assertDungeonRestart(t, false, {
    timeLeft: -1,
    restartUponLoss: false,
    achievementsComplete: false,
  });
  assertDungeonRestart(t, true, { timeLeft: 1, achievementsComplete: false });
  assertDungeonRestart(t, false, {
    timeLeft: 1,
    restartUponWin: false,
    achievementsComplete: false,
  });
  assertDungeonRestart(t, true, { smartAutoRestart: false });
});

test("entrance, guides, and unfinished dungeons prevent restart", (t) => {
  assertDungeonRestart(t, false, { entrance: true });
  assertDungeonRestart(t, false, { guidesHired: true });
  assertDungeonRestart(t, false, { dungeonFinished: false });
});
