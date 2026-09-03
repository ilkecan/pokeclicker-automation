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
  const loadedDungeon = createHarness(t).loadAutomation("dungeon", createDungeonGlobals()).automation;
  return {
    ...loadedDungeon,
    chooseDungeonAction(state) {
      state.timeGrid = loadedDungeon.createTimeGrid(state);
      return loadedDungeon.chooseDungeonAction(state);
    },
  };
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

  const state = {
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
  state.timeGrid = dungeon.createTimeGrid(state);
  return state;
}

function assertMove(action, coordinates) {
  assert.deepEqual({ ...action }, {
    type: "move",
    ...coordinates,
    floor: 0,
  });
}

function assertInteract(action, interaction) {
  assert.deepEqual({ ...action }, {
    type: "interact",
    interaction,
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

test("exports the complete dungeon map entry point", () => {
  assert.equal(typeof dungeon.completeDungeonMap, "function");
});

test("stores predecessors alongside route costs", () => {
  const state = createState({ targetType: null, visited: [[0, 0], [1, 0], [2, 0]] });
  const { costs, predecessors } = state.timeGrid;

  assert.equal(costs[0][3], GameConstants.DUNGEON_TICK);
  assert.equal(predecessors[0][3], state.board[0][0][2]);
});

test("routes through a mandatory battle instead of a safe detour", () => {
  const state = createState({
    targetType: "enemy",
    targetPosition: [1, 0],
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
    visited: [[0, 0]],
    progressionPosition: [1, 1],
  });
  const battle = state.board[0][0][1];
  state.progression.type = DungeonTileType.boss;
  state.progression.isVisited = false;
  state.timeGrid = dungeon.createTimeGrid(state);

  assert.equal(state.timeGrid.costs[0][1], 0);
  assert.equal(state.timeGrid.costs[1][1], 0);
  assert.equal(state.timeGrid.predecessors[1][1], battle);
  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("reconstructs adjacent zero-cost target chains", () => {
  const state = createState({
    targetType: "enemy",
    targetPosition: [2, 0],
    options: { fightAllBattles: true, searchAllChests: true },
    targetCounts: { chests: 1, battles: 1 },
    visited: [[0, 0]],
    progressionPosition: [4, 0],
  });
  const chest = state.board[0][0][1];
  chest.isVisible = true;
  chest.type = DungeonTileType.chest;
  state.timeGrid = dungeon.createTimeGrid(state);

  assert.equal(state.timeGrid.costs[0][1], 0);
  assert.equal(state.timeGrid.costs[0][2], 0);
  assert.equal(state.timeGrid.predecessors[0][2], chest);
  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("leaves unreachable targets unselected", () => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
  });
  state.board[0][3][4] = null;
  state.board[0][4][3] = null;

  const action = dungeon.chooseDungeonAction(state);
  assert.equal(action.type, "move");
});

test("moves toward an inaccessible battle during target discovery", (t) => {
  const state = createState({
    targetType: "enemy",
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 2 },
  });

  assertMove(dungeon.chooseDungeonAction(state), { x: 2, y: 1 });
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

test("chooses the inaccessible battle with the shortest time path", (t) => {
  const state = createState({
    targetType: "enemy",
    targetPosition: [0, 1],
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 2 },
    progressionPosition: [4, 0],
    visited: [[2, 0], [3, 0], [4, 0]],
  });
  state.position = { x: 4, y: 0, floor: 0 };

  const closerBattle = state.board[0][2][4];
  closerBattle.isVisible = true;
  closerBattle.type = DungeonTileType.enemy;

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 1 });
});

test("uses every visited tile as a zero-cost route source", (t) => {
  const state = createState({
    targetType: null,
    options: { openAccessibleChests: false },
    progressionPosition: [2, 0],
    visited: [[0, 0], [0, 1]],
  });
  state.position = { x: 0, y: 1, floor: 0 };
  state.progression.isVisited = false;

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
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

test("does not reveal the floor early when opening accessible chests is disabled", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [0, 0],
    targetChestTier: "rare",
    options: {
      openAccessibleChests: false,
      minimumChestTier: "rare",
      searchAllChests: false,
    },
    visited: [[0, 0]],
  });
  const emptyTile = state.board[0][0][1];
  emptyTile.isVisible = true;
  emptyTile.type = DungeonTileType.empty;
  for (const [x, y, tier] of [[3, 4, "rare"], [4, 4, "epic"]]) {
    const chest = state.board[0][y][x];
    chest.isVisible = true;
    chest.type = DungeonTileType.chest;
    chest.chestTier = tier;
  }

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});


test("does not count visible chests below the minimum tier toward revealing the floor", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [0, 0],
    targetChestTier: "rare",
    options: {
      fightAllBattles: false,
      minimumChestTier: "rare",
      searchAllChests: false,
    },
    visited: [[0, 0]],
  });
  const emptyTile = state.board[0][0][1];
  emptyTile.isVisible = true;
  emptyTile.type = DungeonTileType.empty;
  for (const [x, y, tier] of [[3, 4, "common"], [4, 4, "epic"]]) {
    const chest = state.board[0][y][x];
    chest.isVisible = true;
    chest.type = DungeonTileType.chest;
    chest.chestTier = tier;
  }

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("does not open chests early when fighting all battles", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [0, 0],
    targetChestTier: "rare",
    options: {
      fightAllBattles: true,
      minimumChestTier: "rare",
      searchAllChests: false,
    },
    visited: [[0, 0]],
  });
  const emptyTile = state.board[0][0][1];
  emptyTile.isVisible = true;
  emptyTile.type = DungeonTileType.empty;
  for (const [x, y] of [[3, 4], [4, 4]]) {
    const chest = state.board[0][y][x];
    chest.isVisible = true;
    chest.type = DungeonTileType.chest;
    chest.chestTier = "rare";
  }

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
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

test("opens every accessible chest when the run cannot progress", (t) => {
  const state = createState({
    targetType: null,
    options: { openAccessibleChests: false, minimumChestTier: "mythic" },
    progressionPosition: [4, 0],
    visited: [[0, 0], [1, 0], [0, 1]],
  });
  state.timeLeft = GameConstants.BATTLE_TICK - 1;

  const firstChest = state.board[0][0][2];
  firstChest.isVisible = true;
  firstChest.type = DungeonTileType.chest;
  firstChest.chestTier = "common";
  const secondChest = state.board[0][1][1];
  secondChest.isVisible = true;
  secondChest.type = DungeonTileType.chest;
  secondChest.chestTier = "common";

  assertMove(dungeon.chooseDungeonAction(state), { x: 2, y: 0 });

  state.position = { x: 2, y: 0, floor: 0 };
  firstChest.isVisited = true;
  assertInteract(dungeon.chooseDungeonAction(state), "chest");
  firstChest.type = null;
  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 1 });

  state.position = { x: 1, y: 1, floor: 0 };
  secondChest.isVisited = true;
  assertInteract(dungeon.chooseDungeonAction(state), "chest");
  secondChest.type = null;
  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 0 });
});

test("does not salvage chests at the battle tick boundary", (t) => {
  const state = createState({
    targetType: "chest",
    targetPosition: [1, 0],
    options: { openAccessibleChests: false },
    progressionPosition: [4, 0],
  });
  state.timeLeft = GameConstants.BATTLE_TICK;

  assertMove(dungeon.chooseDungeonAction(state), { x: 4, y: 0 });
});

test("salvages the current chest before remote accessible chests", (t) => {
  const state = createState({
    targetType: null,
    options: { openAccessibleChests: false, minimumChestTier: "mythic" },
    targetCounts: { chests: 2, battles: 0 },
    progressionPosition: [4, 0],
    visited: [[0, 0], [4, 4]],
  });
  state.timeLeft = GameConstants.BATTLE_TICK - 1;
  state.position = { x: 4, y: 4, floor: 0 };

  const remoteChest = state.board[0][0][0];
  remoteChest.isVisible = true;
  remoteChest.type = DungeonTileType.chest;
  remoteChest.chestTier = "common";
  const currentChest = state.board[0][4][4];
  currentChest.isVisible = true;
  currentChest.type = DungeonTileType.chest;
  currentChest.chestTier = "common";

  assertInteract(dungeon.chooseDungeonAction(state), "chest");
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

test("does not explore non-battle neighbours when every target is visible", (t) => {
  const state = createState({
    targetType: "enemy",
    targetPosition: [1, 0],
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
    progressionPosition: [4, 0],
    visited: [[0, 0], [4, 0]],
  });
  const emptyTile = state.board[0][1][0];
  emptyTile.isVisible = true;
  emptyTile.type = DungeonTileType.empty;

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("routes through a mandatory battle to visible progression", (t) => {
  const state = createState({
    targetType: null,
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
    progressionPosition: [1, 1],
    visited: [[0, 0]],
  });
  state.progression.isVisited = false;

  const battlePathTile = state.board[0][0][1];
  battlePathTile.isVisible = true;
  battlePathTile.type = DungeonTileType.enemy;
  const emptyPathTile = state.board[0][1][0];
  emptyPathTile.isVisible = true;
  emptyPathTile.type = DungeonTileType.empty;

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
});

test("routes through a mandatory battle on a shorter path", (t) => {
  const state = createState({
    targetType: null,
    options: { fightAllBattles: true },
    targetCounts: { chests: 0, battles: 1 },
    progressionPosition: [4, 0],
    visited: [[0, 0]],
  });
  state.progression.isVisited = false;

  const battlePathTile = state.board[0][0][1];
  battlePathTile.isVisible = true;
  battlePathTile.type = DungeonTileType.enemy;
  for (const [x, y] of [[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]) {
    const emptyPathTile = state.board[0][y][x];
    emptyPathTile.isVisible = true;
    emptyPathTile.type = DungeonTileType.empty;
  }

  assertMove(dungeon.chooseDungeonAction(state), { x: 1, y: 0 });
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
