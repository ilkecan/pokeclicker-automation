// Safari: stateless single-species scarcity scoring, exact ball-only Q/turn chains,
// stock-only berries, shiny-first catch-max, encounter-tile routing, and runner lifecycle.
"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createHarness } = require("./lib/harness.cjs");

const constantsHarness = createHarness();
const { GameConstants } = constantsHarness.game;
const BaitType = { Bait: 0, Razz: 1, Pinap: 2, Nanab: 3 };
const BaitList = {
  Bait: { type: BaitType.Bait },
  Razz: { type: BaitType.Razz },
  Pinap: { type: BaitType.Pinap },
  Nanab: { type: BaitType.Nanab },
};
const BerryType = { Razz: 0, Nanab: 1 };
const OakItemType = { Magic_Ball: "magicBall" };
const REGION = GameConstants.Region.kanto;

function createElements() {
  const elements = new Map();
  function element(selector) {
    if (!elements.has(selector)) {
      const classes = new Set();
      const handlers = new Map();
      elements.set(selector, {
        on(event, callback) {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event).add(callback);
        },
        off(event, callback) {
          if (!callback) handlers.delete(event);
          else handlers.get(event)?.delete(callback);
        },
        trigger(event) {
          if (event === "shown.bs.modal") classes.add("show");
          if (event === "hidden.bs.modal") classes.delete("show");
          for (const callback of [...(handlers.get(event) ?? [])]) callback();
        },
        handlerCount(event) {
          return handlers.get(event)?.size ?? 0;
        },
        hasClass(name) {
          return classes.has(name);
        },
        addClass(name) {
          classes.add(name);
        },
        removeClass(name) {
          classes.delete(name);
        },
      });
    }
    return elements.get(selector);
  }
  return { $, element };

  function $(selector) {
    return element(selector);
  }
}

function createGlobals({
  grid = [[GameConstants.SafariTile.grass, GameConstants.SafariTile.grass]],
  position = { x: 0, y: 0 },
  pokemons = [],
  items = [],
  encounters = [encounter("Enemy", 1, 0), encounter("Ignored", 1, 0)],
  balls = 10,
  inProgress = false,
  inBattle = false,
  busy = false,
  shinyBonus = 1,
  evBonus = 1,
  slowEVs = false,
  environment = 0,
  enabled = true,
  options = {},
  ownedPokemons = {},
  town = { content: [] },
  gameState = GameConstants.GameState.town,
  battleModalState = "hidden",
  safariModalState = "show",
  region = REGION,
  razz = 0,
  nanab = 0,
} = {}) {
  const { ko } = constantsHarness.game;
  const sectionEnabled = ko.observable(enabled);
  const optionValues = {
    followVisiblePokemon: ko.observable(options.followVisiblePokemon ?? true),
    collectVisibleItems: ko.observable(options.collectVisibleItems ?? true),
    autoEnter: ko.observable(options.autoEnter ?? true),
  };
  const progress = ko.observable(inProgress);
  const battle = ko.observable(inBattle);
  const battleBusy = ko.observable(busy);
  const ballCount = ko.observable(balls);
  const pokemonGrid = ko.observableArray(pokemons);
  const itemGrid = ko.observableArray(items);
  const activeRegion = ko.observable(region);
  const safariModal = ko.observable(safariModalState);
  const berryInventory = {
    [BerryType.Razz]: ko.observable(razz),
    [BerryType.Nanab]: ko.observable(nanab),
  };
  const calls = {
    move: [],
    stop: [],
    throwBall: [],
    throwRock: [],
    throwBait: [],
    selectedBait: [],
    run: [],
    openModal: 0,
    pay: 0,
  };
  const townValue = ko.observable(town);
  const gameStateValue = ko.observable(gameState);
  const { $, element } = createElements();
  if (safariModalState === "show") {
    element("#safariModal").addClass("show");
  }
  const selectedBait = ko.observable(BaitList.Bait);
  if (battleModalState === "show") {
    element("#safariBattleModal").addClass("show");
  }
  const timers = new Map();
  let nextTimer = 1;
  const timeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  const clearTimeoutFake = (id) => timers.delete(id);
  const runTimer = (id = timers.keys().next().value) => {
    const timer = timers.get(id);
    if (!timer) return false;
    timers.delete(id);
    timer.callback();
    return true;
  };
  let enemy = null;
  const Safari = {
    grid,
    playerXY: position,
    inProgress: progress,
    inBattle: battle,
    balls: ballCount,
    activeRegion,
    activeEnvironment: ko.observable(environment),
    pokemonGrid,
    itemGrid,
    isMoving: false,
    moveSpeed: 250,
    getPlayerStartCoords: () => [0, 0],
    move(direction) { calls.move.push(direction); this.isMoving = true; },
    stop(direction) { calls.stop.push(direction); this.isMoving = false; },
    canPay: ko.observable(true),
    openModal() {
      calls.openModal++;
      gameStateValue(GameConstants.GameState.safari);
    },
    payEntranceFee() { calls.pay++; progress(true); },
  };
  const SafariBattle = {
    busy: battleBusy,
    selectedBait(value) {
      if (arguments.length) calls.selectedBait.push(value);
      return selectedBait(value);
    },
    get enemy() { return enemy; },
    set enemy(value) { enemy = value; },
    throwBall() { calls.throwBall.push(true); },
    throwRock() { calls.throwRock.push(true); },
    throwBait() { calls.throwBait.push(true); },
    run() { calls.run.push(true); },
  };
  const App = {
    game: {
      multiplier: { getBonus: (type) => type === "ev" ? evBonus : shinyBonus },
      challenges: { list: { slowEVs: { active: ko.observable(slowEVs) } } },
      oakItems: { calculateBonus: () => 0 },
      farming: { berryInventory },
      party: {
        alreadyCaughtPokemonByName: (name) => Object.hasOwn(ownedPokemons, name),
        getPokemonByName: (name) => ownedPokemons[name],
      },
      get gameState() { return gameStateValue(); },
      set gameState(value) { gameStateValue(value); },
    },
  };
  const player = { region, get town() { return townValue(); } };
  const settings = {
    enabled: () => sectionEnabled,
    isEnabled: () => sectionEnabled(),
    getValue: (_section, option) => optionValues[option](),
    value: (_section, option) => optionValues[option],
    sections: [{
      id: "safari",
      options: Object.entries(optionValues).map(([id, value]) => ({ id, value })),
    }],
  };
  const SafariPokemonList = { list: { [region]: ko.observable(encounters) } };
  const context = {
    $, App, AutomationSettings: settings, Safari, SafariBattle, SafariPokemonList, player,
    BaitType, BaitList, BerryType, OakItemType,
    DisplayObservables: {
      modalState: {
        get safariModal() { return safariModal(); },
        safariModalObservable: safariModal,
        get safariBattleModal() {
          return element("#safariBattleModal").hasClass("show") ? "show" : "hidden";
        },
      },
    },
    SafariEnvironments: { Grass: 0, Water: 1 },
    SafariTownContent: class SafariTownContent {},
    setTimeout: timeout,
    clearTimeout: clearTimeoutFake,
  };
  return {
    context,
    calls,
    progress,
    battle,
    battleBusy,
    ballCount,
    pokemonGrid,
    itemGrid,
    sectionEnabled,
    safariModal,
    optionValues,
    activeRegion,
    Safari,
    SafariBattle,
    canPay: Safari.canPay,
    townValue,
    App,
    player,
    timers,
    runTimer,
    element,
    town,
  };
}

function loadSafari(t, globals) {
  return createHarness(t).loadAutomation("safari", globals.context).automation;
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
}

function neutral(balls = 30) {
  return { balls, angry: 0, eating: 0, eatingBait: BaitType.Bait };
}

function owned(banked, pokerus = GameConstants.Pokerus.Contagious) {
  return { pokerus, calculateEVs: () => banked };
}

function createState(automation, globals) {
  const { Safari } = globals;
  const height = Safari.grid.length;
  const width = Safari.grid[0].length;
  const state = {
    grid: Safari.grid,
    width,
    height,
    position: { x: Safari.playerXY.x, y: Safari.playerXY.y },
    options: { followVisiblePokemon: true, collectVisibleItems: true },
    distances: Array.from({ length: height }, () => Array(width).fill(Infinity)),
    predecessors: Array.from({ length: height }, () => Array(width).fill(null)),
    queue: [],
    weights: automation.createWeights(),
  };
  automation.updateState(state);
  return state;
}

function encounter(name, weight, environment, available = true) {
  return { name, weight, environments: [environment], isAvailable: () => available };
}

function pokemon(name, x, y, shiny = false, overrides = {}) {
  return {
    name,
    x,
    y,
    shiny,
    baseCatchFactor: 50,
    baseEscapeFactor: 30,
    levelModifier: 0,
    angry: 0,
    eating: 0,
    eatingBait: BaitType.Bait,
    ...overrides,
    get steps() { throw new Error("steps must not be read"); },
  };
}

function item(x, y) {
  return { x, y };
}

test("builds reusable BFS routes around obstacles and omits unreachable targets", (t) => {
  const grid = [
    [0, 99, 0, 0, 0],
    [0, 99, 0, 0, 0],
    [0, 0, 0, 0, 0],
    [0, 99, 99, 99, 0],
    [0, 0, 0, 0, 0],
  ];
  const unreachable = pokemon("Blocked", 1, 0);
  const reachable = item(4, 4);
  const globals = createGlobals({ grid, pokemons: [unreachable], items: [reachable] });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);
  const distances = state.distances;
  const predecessors = state.predecessors;
  assert.equal(automation.chooseAction(state).direction, "down");
  assert.equal(state.distances[0][1], Infinity);
  globals.Safari.playerXY.x = 4;
  globals.Safari.playerXY.y = 4;
  globals.pokemonGrid([pokemon("Blocked", 1, 0)]);
  automation.updateState(state);
  assert.equal(state.distances, distances);
  assert.equal(state.predecessors, predecessors);
});

test("prioritizes rare visible Pokémon over distance and Pokémon over items", (t) => {
  const grid = [Array(5).fill(GameConstants.SafariTile.grass)];
  const globals = createGlobals({
    grid,
    position: { x: 2, y: 0 },
    pokemons: [pokemon("Common", 1, 0), pokemon("Rare", 4, 0)],
    items: [item(1, 0)],
    encounters: [
      encounter("Common", 100, 0),
      encounter("Rare", 1, 0),
    ],
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "right" }));
  globals.optionValues.followVisiblePokemon(false);
  automation.updateState(state);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "left" }));
});
test("filters visible Pokemon by catch priority", (t) => {
  const globals = createGlobals({
    grid: [[GameConstants.SafariTile.grass, GameConstants.SafariTile.grass, GameConstants.SafariTile.grass, GameConstants.SafariTile.grass]],
    position: { x: 2, y: 0 },
    pokemons: [pokemon("Resistant", 1, 0), pokemon("Contagious", 3, 0)],
    options: { collectVisibleItems: false },
    ownedPokemons: {
      Resistant: { pokerus: GameConstants.Pokerus.Resistant },
      Contagious: { pokerus: GameConstants.Pokerus.Contagious },
    },
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "right" }));
});

test("normalizes environment weights and applies shiny multiplier", (t) => {
  const grid = [[GameConstants.SafariTile.grass, 1, 1, GameConstants.SafariTile.grass]];
  const globals = createGlobals({
    grid,
    position: { x: 2, y: 0 },
    pokemons: [pokemon("WaterRare", 1, 0, false), pokemon("GrassShiny", 3, 0, true)],
    encounters: [
      encounter("WaterRare", 2, 1),
      encounter("WaterCommon", 100, 1),
      encounter("WaterOther", 3, 1),
      encounter("GrassShiny", 1, 0),
      encounter("GrassCommon", 99, 0),
    ],
    shinyBonus: 2,
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "right" }));
  assert.equal(state.weights.water.total, 105);
  assert.equal(state.weights.water.weights.get("WaterRare"), 2);
});

test("moves toward another grass tile without retaining a patrol goal", (t) => {
  const grid = [[GameConstants.SafariTile.grass, 0, GameConstants.SafariTile.grass]];
  const globals = createGlobals({ grid, position: { x: 1, y: 0 } });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "left" }));
  globals.Safari.playerXY.x = 0;
  automation.updateState(state);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "right" }));
  globals.Safari.playerXY.x = 1;
  automation.updateState(state);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "left" }));
});

test("executes exactly one official operation per action", (t) => {
  const globals = createGlobals();
  const automation = loadSafari(t, globals);
  automation.executeAction({ type: "move", direction: "left" });
  automation.executeAction({ type: "throwBall" });
  assert.deepEqual(globals.calls.move, ["left"]);
  assert.deepEqual(globals.calls.stop, ["left"]);
  assert.deepEqual(globals.calls.throwBall, [true]);
});

test("executes official rock and bait operations without restoring bait selection", (t) => {
  const globals = createGlobals();
  const automation = loadSafari(t, globals);
  automation.executeAction({ type: "throwRock" });
  automation.executeAction({ type: "throwBait", bait: BaitType.Nanab });

  assert.deepEqual(globals.calls.throwRock, [true]);
  assert.deepEqual(globals.calls.throwBait, [true]);
  assert.deepEqual(globals.calls.selectedBait, [BaitList.Nanab]);
});

test("invests basic bait in a scarce normal encounter without berries", (t) => {
  const globals = createGlobals({
    inBattle: true,
    balls: 10,
    battleModalState: "show",
    encounters: [encounter("Normal", 1, 0), encounter("Common", 99, 0)],
  });
  globals.SafariBattle.enemy = pokemon("Normal", 0, 0, false, {
    baseCatchFactor: 10,
    baseEscapeFactor: 30,
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "throwBait", bait: BaitType.Bait }));
});

test("optimizes shiny berry choice from current state", (t) => {
  const globals = createGlobals({
    inBattle: true,
    balls: 4,
    razz: 1,
    nanab: 1,
    battleModalState: "show",
  });
  globals.SafariBattle.enemy = pokemon("Shiny", 0, 0, true, {
    baseCatchFactor: 10,
    baseEscapeFactor: 30,
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  const action = automation.chooseAction(state);
  assert.equal(action.type, "throwBait");
  assert.ok([BaitType.Razz, BaitType.Nanab].includes(action.bait));
  assert.equal(action.bait, BaitType.Razz);
  const lowCatchGlobals = createGlobals({
    inBattle: true,
    balls: 30,
    razz: 1,
    nanab: 1,
    battleModalState: "show",
  });
  lowCatchGlobals.SafariBattle.enemy = pokemon("Shiny", 0, 0, true, {
    baseCatchFactor: 0.1,
    baseEscapeFactor: 30,
  });
  const lowCatchAutomation = loadSafari(t, lowCatchGlobals);
  const lowCatchState = createState(lowCatchAutomation, lowCatchGlobals);
  // SafariPokemon.ts:47 fixes escape at 30; Nanab won only in the old escape-99 fixture.
  close(lowCatchAutomation.baitValue(lowCatchState.enemy, neutral(), BaitType.Razz).value, 0.0056744122959760225);
  close(lowCatchAutomation.baitValue(lowCatchState.enemy, neutral(), BaitType.Nanab).value, 0.005480786579367901);
  assert.equal(lowCatchAutomation.chooseAction(lowCatchState).bait, BaitType.Razz);
});

test("keeps a persistent Razz bonus instead of re-baiting basic", (t) => {
  const globals = createGlobals({
    inBattle: true,
    balls: 10,
    battleModalState: "show",
  });
  globals.SafariBattle.enemy = pokemon("Shiny", 0, 0, true, {
    baseCatchFactor: 18,
    baseEscapeFactor: 30,
    eating: 0,
    eatingBait: BaitType.Razz,
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "throwBall" }));
});

test("rocks with one ball left while eating and balls otherwise", (t) => {
  const globals = createGlobals({
    inBattle: true,
    balls: 1,
    battleModalState: "show",
    encounters: [encounter("Normal", 1, 0), encounter("Common", 99, 0)],
  });
  globals.SafariBattle.enemy = pokemon("Normal", 0, 0, false, { eating: 2 });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "throwRock" }));
  globals.SafariBattle.enemy = pokemon("Normal", 0, 0, false);
  automation.updateState(state);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "throwBall" }));
});

test("runs from a Pokemon that should not be caught", (t) => {
  const globals = createGlobals({
    inProgress: true,
    inBattle: true,
    balls: 2,
    battleModalState: "show",
    ownedPokemons: {
      Resistant: { pokerus: GameConstants.Pokerus.Resistant },
    },
  });
  globals.SafariBattle.enemy = pokemon("Resistant", 0, 0);
  const automation = loadSafari(t, globals);
  automation.automate();
  globals.runTimer();

  assert.deepEqual(globals.calls.run, [true]);
  assert.deepEqual(globals.calls.throwBall, []);
});

test("active runner defers movement and waits for modal readiness, busy state, and balls", (t) => {
  const globals = createGlobals({ grid: [[0, GameConstants.SafariTile.grass]], balls: 2 });
  globals.Safari.playerXY = { x: 1, y: 0 };
  const automation = loadSafari(t, globals);
  automation.automate();
  globals.progress(true);
  assert.deepEqual(globals.calls.move, []);
  globals.Safari.playerXY = { x: 0, y: 0 };
  globals.runTimer();
  assert.deepEqual(globals.calls.move, ["right"]);
  globals.Safari.isMoving = false;
  globals.runTimer();
  globals.battle(true);
  globals.SafariBattle.enemy = pokemon("Enemy", 0, 0);
  globals.battleBusy(false);
  globals.element("#safariBattleModal").trigger("shown.bs.modal");
  assert.deepEqual(globals.calls.throwBall, []);
  globals.runTimer();

  assert.deepEqual(globals.calls.throwBall, [true]);
  globals.ballCount(0);
  globals.battle(false);
  assert.deepEqual(globals.calls.throwBall, [true]);
  globals.sectionEnabled(false);
  assert.equal(globals.timers.size, 0);
  assert.equal(globals.element("#safariBattleModal").handlerCount("shown.bs.modal"), 0);
});
test("starts when the actual modal is already shown", (t) => {
  const globals = createGlobals({
    grid: [[0, GameConstants.SafariTile.grass]],
    inProgress: true,
    safariModalState: "hidden",
  });
  globals.element("#safariModal").addClass("show");
  const automation = loadSafari(t, globals);
  automation.automate();
  assert.equal(globals.timers.size, 1);
  globals.runTimer();
  assert.deepEqual(globals.calls.move, ["right"]);
});

test("disposes the Safari runner while the main modal is closed", (t) => {
  const globals = createGlobals({
    grid: [[0, GameConstants.SafariTile.grass]],
    inProgress: true,
  });
  const automation = loadSafari(t, globals);
  automation.automate();
  assert.equal(globals.timers.size, 1);

  globals.element("#safariModal").trigger("hide.bs.modal");
  assert.equal(globals.timers.size, 0);
  globals.battle(true);
  globals.SafariBattle.enemy = pokemon("Ignored", 0, 0);
  globals.element("#safariBattleModal").trigger("shown.bs.modal");
  assert.deepEqual(globals.calls.throwBall, []);

  globals.element("#safariModal").addClass("show");
  globals.element("#safariModal").trigger("shown.bs.modal");
  assert.equal(globals.timers.size, 1);
  globals.element("#safariBattleModal").trigger("shown.bs.modal");
  globals.runTimer();
  assert.deepEqual(globals.calls.throwBall, [true]);
});

test("disposes active timers, listeners, and subscriptions on section disable", (t) => {
  const globals = createGlobals({
    grid: [[0, GameConstants.SafariTile.grass]],
    options: { autoEnter: false },
  });
  const automation = loadSafari(t, globals);
  automation.automate();
  globals.progress(true);
  assert.equal(globals.timers.size, 1);
  assert.equal(globals.element("#safariBattleModal").handlerCount("shown.bs.modal"), 1);
  globals.sectionEnabled(false);
  assert.equal(globals.timers.size, 0);
  assert.equal(globals.element("#safariBattleModal").handlerCount("shown.bs.modal"), 0);
  globals.pokemonGrid([pokemon("Ignored", 1, 0)]);
  globals.battle(true);
  assert.deepEqual(globals.calls.throwBall, []);

});
test("resumes an already-visible battle on attachment and re-enable", (t) => {
  const globals = createGlobals({
    grid: [[0, GameConstants.SafariTile.grass]],
    inProgress: true,
    inBattle: true,
    balls: 2,
    battleModalState: "show",
  });
  globals.SafariBattle.enemy = pokemon("Enemy", 0, 0);
  const automation = loadSafari(t, globals);
  automation.automate();
  assert.deepEqual(globals.calls.throwBall, []);
  globals.runTimer();
  assert.deepEqual(globals.calls.throwBall, [true]);
  globals.sectionEnabled(false);
  globals.sectionEnabled(true);
  assert.deepEqual(globals.calls.throwBall, [true]);
  globals.runTimer();
  assert.deepEqual(globals.calls.throwBall, [true, true]);
});

test("defers each resolved turn and consumes one ball per accepted throw", (t) => {
  const globals = createGlobals({
    grid: [[0, GameConstants.SafariTile.grass]],
    inProgress: true,
    inBattle: true,
    busy: true,
    balls: 2,
  });
  globals.SafariBattle.enemy = pokemon("Enemy", 0, 0);
  globals.SafariBattle.throwBall = () => {
    if (!globals.battle() || globals.battleBusy()) return;
    globals.battleBusy(true);
    globals.ballCount(globals.ballCount() - 1);
    globals.calls.throwBall.push(true);
  };
  const automation = loadSafari(t, globals);
  automation.automate();
  globals.battleBusy(false);
  globals.element("#safariBattleModal").trigger("shown.bs.modal");
  assert.deepEqual(globals.calls.throwBall, []);
  globals.runTimer();
  assert.deepEqual(globals.calls.throwBall, [true]);
  assert.equal(globals.ballCount(), 1);
  globals.battleBusy(false);
  assert.deepEqual(globals.calls.throwBall, [true]);
  globals.runTimer();
  assert.deepEqual(globals.calls.throwBall, [true, true]);
  assert.equal(globals.ballCount(), 0);
  globals.battle(false);
  globals.battleBusy(false);
  assert.deepEqual(globals.calls.throwBall, [true, true]);
});

test("visible collisions do not become routing obstacles", (t) => {
  const globals = createGlobals({
    grid: [[0, 0, 0, GameConstants.SafariTile.grass]],
    options: { followVisiblePokemon: false, collectVisibleItems: false },
    pokemons: [pokemon("Passing", 1, 0)],
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);
  assert.equal(JSON.stringify(automation.chooseAction(state)), JSON.stringify({ type: "move", direction: "right" }));
});
test("auto-enter pays after the modal is shown", (t) => {
  class SafariTownContent {}
  const town = { content: [new SafariTownContent()] };
  const globals = createGlobals({ town, inProgress: false, safariModalState: "hidden" });
  globals.context.SafariTownContent = SafariTownContent;
  const automation = loadSafari(t, globals);

  automation.automate();

  assert.equal(globals.calls.openModal, 1);
  assert.equal(globals.calls.pay, 0);
  assert.equal(globals.element("#safariModal").handlerCount("shown.bs.modal"), 2);
  globals.element("#safariModal").trigger("shown.bs.modal");
  assert.equal(globals.calls.pay, 1);
  assert.equal(globals.Safari.inProgress(), true);
});
test("auto-enter waits for the Safari modal to finish closing", (t) => {
  class SafariTownContent {}
  const town = { content: [new SafariTownContent()] };
  const globals = createGlobals({ town, inProgress: false, safariModalState: "hide" });
  globals.context.SafariTownContent = SafariTownContent;
  const automation = loadSafari(t, globals);

  automation.automate();

  assert.equal(globals.calls.openModal, 0);
  assert.equal(globals.element("#safariModal").handlerCount("shown.bs.modal"), 1);
  globals.safariModal("hidden");
  assert.equal(globals.calls.openModal, 1);
  assert.equal(globals.element("#safariModal").handlerCount("shown.bs.modal"), 2);
});

test("ball chains count survival, terminal catches, final balls, and status decay", (t) => {
  const automation = loadSafari(t, createGlobals());
  const enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  const two = automation.ballContinuation(enemy, neutral(2));
  close(two.value, 0.1 + 0.9 * 0.7 * 0.1);
  close(two.turns, 1 + 0.9 * 0.7);
  const empty = automation.ballContinuation(enemy, neutral(0));
  assert.equal(empty.value, 0);
  assert.equal(empty.turns, 0);
  const last = automation.ballContinuation(enemy, neutral(1));
  assert.equal(last.value, 0.1); // No flee roll can undo the final catch.
  assert.equal(last.turns, 1);
  const eating = automation.ballContinuation(enemy, { ...neutral(2), eating: 1 });
  close(eating.value, 0.05 + 0.95 * 0.925 * 0.1);
  close(eating.turns, 1 + 0.95 * 0.925); // Flee before decrement, then neutral.
  const guaranteed = automation.ballContinuation(
    pokemon("Enemy", 0, 0, false, { baseCatchFactor: 42.5, levelModifier: 0.98 }),
    { ...neutral(), angry: 2 },
  );
  assert.equal(guaranteed.value, 1);
  assert.equal(guaranteed.turns, 1);
});

test("setup chains average game durations and charge their own turn", (t) => {
  const automation = loadSafari(t, createGlobals());
  const enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  // Independent path enumeration: catch terminates before flee; flee before decay.
  function rollout(balls, angry, eating, bait) {
    if (balls === 0) return { value: 0, turns: 0 };
    const p = 0.1 / (eating > 0 ? 2 : 1) * (angry > 0 ? 2 : 1) * (bait === BaitType.Razz ? 1.5 : 1);
    const flee = 0.3 / (eating > 0 ? 4 : 1) * (angry > 0 ? 2 : 1) / (bait === BaitType.Nanab ? 1.5 : 1);
    const next = rollout(balls - 1, Math.max(0, angry - 1), Math.max(0, eating - 1), bait);
    return { value: p + (1 - p) * (1 - flee) * next.value, turns: 1 + (1 - p) * (1 - flee) * next.turns };
  }
  for (const bait of [BaitType.Bait, BaitType.Razz, BaitType.Nanab]) {
    const max = bait === BaitType.Bait ? 6 : 7; // Bait.ts:35,45,63
    let value = 0;
    let turns = 1;
    const survive = 1 - 0.3 / 4 / (bait === BaitType.Nanab ? 1.5 : 1);
    for (let duration = 2; duration <= max; duration++) {
      const next = rollout(8, 0, duration - 1, bait);
      value += survive * next.value / (max - 1);
      turns += survive * next.turns / (max - 1);
    }
    const actual = automation.baitValue(enemy, neutral(8), bait);
    close(actual.value, value);
    close(actual.turns, turns);
  }
  let value = 0;
  let turns = 1;
  for (let duration = 2; duration <= 6; duration++) {
    const next = rollout(8, duration - 1, 0, BaitType.Bait);
    value += 0.4 * next.value / 5;
    turns += 0.4 * next.turns / 5;
  }
  const rock = automation.rockValue(enemy, neutral(8));
  close(rock.value, value);
  close(rock.turns, turns);
});

test("berries replace one persistent slot and rocks preserve it", (t) => {
  const automation = loadSafari(t, createGlobals());
  const enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  const razz = { ...neutral(1), eatingBait: BaitType.Razz };
  const nanab = { ...neutral(1), eatingBait: BaitType.Nanab };
  close(automation.ballContinuation(enemy, razz).value, 0.15);
  close(automation.escapeProbability(enemy, 0, 0, BaitType.Nanab), 0.2);
  const rockRazz = automation.rockValue(enemy, { ...razz, eating: 6 });
  close(rockRazz.value, 0.4 * 0.3);
  close(rockRazz.turns, 1.4);
  const rockNanab = automation.rockValue(enemy, nanab);
  close(rockNanab.value, 0.6 * 0.2);
  close(rockNanab.turns, 1.6);
  close(automation.baitValue(enemy, razz, BaitType.Nanab).value, 0.95 * 0.05);
  close(automation.baitValue(enemy, nanab, BaitType.Razz).value, 0.925 * 0.075);
  close(automation.baitValue(enemy, razz, BaitType.Bait).value, 0.925 * 0.05);
});

test("short refresh rolls preserve longer status and clear the opposing status", (t) => {
  const automation = loadSafari(t, createGlobals());
  const enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  // Eating 6 is reachable after a berry roll of 7; basic's rolls cannot shorten it.
  const refreshed = automation.baitValue(enemy, { ...neutral(6), eating: 6, eatingBait: BaitType.Razz }, BaitType.Bait);
  const continuation = automation.ballContinuation(enemy, { ...neutral(6), eating: 5 });
  close(refreshed.value, 0.925 * continuation.value);
  close(refreshed.turns, 1 + 0.925 * continuation.turns);
  const calmed = automation.baitValue(enemy, { ...neutral(1), angry: 5 }, BaitType.Nanab);
  close(calmed.value, 0.95 * 0.05);
  close(calmed.turns, 1.95);
  // Angry 5 is reachable after a rock roll of 6: rolls 2–5 preserve 5, roll 6 extends.
  const rocked = automation.rockValue(enemy, { ...neutral(6), angry: 5 });
  const short = automation.ballContinuation(enemy, { ...neutral(6), angry: 4 });
  const long = automation.ballContinuation(enemy, { ...neutral(6), angry: 5 });
  close(rocked.value, 0.4 * (4 * short.value + long.value) / 5);
  close(rocked.turns, 1 + 0.4 * (4 * short.turns + long.turns) / 5);
});

test("unfinished mons deposit one full catch regardless of banked progress", (t) => {
  for (const [slowEVs, evBonus, banked, expected] of [
    [false, 1, 0, 1],
    [false, 1, 49.75, 1],
    [true, 1, 49.999, 1],
    [false, 2, 49.5, 1],
    // Saturated-yet-Contagious still deposits: the game flips to Resistant on
    // the next EV gain, so any overbank here self-corrects after one catch.
    [false, 1, 50, 1],
    [false, 1, 51, 1],
  ]) {
    const member = owned(banked);
    const globals = createGlobals({ slowEVs, evBonus, ownedPokemons: { Enemy: member } });
    const automation = loadSafari(t, globals);
    globals.App.game.challenges.list.slowEVs.active = () => assert.fail("threshold deposit needs no bonus reads");
    globals.App.game.multiplier.getBonus = () => assert.fail("threshold deposit needs no bonus reads");
    globals.App.game.party.calculateEffortPoints = () => assert.fail("per-mon yields are out of scope");
    member.heldItem = () => assert.fail("held items are out of scope");
    assert.equal(automation.progressValue(pokemon("Enemy", 0, 0)), expected);
  }
});

test("acquisition credits make 51 to 50 and 501 to 500 transitions despite zero yield", (t) => {
  for (const slowEVs of [false, true]) {
    const members = {};
    const globals = createGlobals({ slowEVs, ownedPokemons: members });
    const automation = loadSafari(t, globals);
    const enemy = pokemon("Enemy", 0, 0);
    const u = slowEVs ? 0.1 : 1;
    const catchesLeft = 50 / u;
    const acquisition = automation.progressValue(enemy);
    assert.equal(acquisition, 1);
    assert.equal(catchesLeft + acquisition, slowEVs ? 501 : 51);
    members.Enemy = owned(0, GameConstants.Pokerus.Uninfected);
    assert.equal(automation.progressValue(enemy), 0); // Acquisition alone has banked no EVs.
    let progress = acquisition;
    let banked = 0;
    members.Enemy = { pokerus: GameConstants.Pokerus.Contagious, calculateEVs: () => banked };
    for (let catchIndex = 0; catchIndex < catchesLeft; catchIndex++) {
      banked = catchIndex * u;
      progress += automation.progressValue(enemy);
    }
    close(progress - acquisition, slowEVs ? 500 : 50);
    banked = 50;
    assert.equal(automation.progressValue(enemy), 1); // Flip lands on the next gain.
  }
});

test("shiny catch-max precedes EV and ownership reads, including unowned and Resistant", (t) => {
  for (const members of [{}, { Enemy: owned(50, GameConstants.Pokerus.Resistant) }]) {
    const globals = createGlobals({ razz: 1, nanab: 1, ownedPokemons: members });
    const automation = loadSafari(t, globals);
    const enemy = pokemon("Enemy", 0, 0, true, { baseCatchFactor: 10 });
    const state = { enemy, balls: 4 };
    const unavailable = () => assert.fail("shiny scorer must run before progress/spawn reads");
    globals.App.game.party.getPokemonByName = unavailable;
    globals.App.game.party.alreadyCaughtPokemonByName = unavailable;
    globals.App.game.challenges.list.slowEVs.active = unavailable;
    globals.App.game.multiplier.getBonus = unavailable;
    globals.Safari.activeEnvironment = unavailable;
    assert.equal(automation.chooseBattleAction(state).bait, BaitType.Razz);
  }
  const globals = createGlobals();
  const automation = loadSafari(t, globals);
  // A saturated, already-angry shiny is guaranteed on this ball; setup can lose it.
  const enemy = pokemon("Enemy", 0, 0, true, { baseCatchFactor: 42.5, levelModifier: 0.98, angry: 5 });
  assert.equal(automation.chooseBattleAction({ enemy, balls: 1 }).type, "throwBall");
});

test("zero-deposit owned encounters run but negative scores never summon RUN", (t) => {
  const members = { Enemy: owned(0, GameConstants.Pokerus.Uninfected) };
  const globals = createGlobals({ ownedPokemons: members, encounters: [encounter("Enemy", 1, 0)], razz: 1, nanab: 1 });
  const automation = loadSafari(t, globals);
  globals.SafariBattle.enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  const state = createState(automation, globals);
  assert.equal(automation.chooseBattleAction(state).type, "run");
  members.Enemy = owned(50, GameConstants.Pokerus.Resistant);
  assert.equal(automation.chooseBattleAction(state).type, "run");
  members.Enemy = owned(49.999);
  assert.equal(automation.progressValue(state.enemy), 1); // Final sliver banks a full catch.
  const weight = automation.battleWeight(state, 1);
  for (const action of automation.battleActionCandidates()) {
    const { value, turns } = automation.actionScore(state.enemy, neutral(1), action);
    assert.ok(weight * value - turns < 0);
  }
  assert.notEqual(automation.chooseBattleAction(state).type, "run");
  delete members.Enemy;
  assert.notEqual(automation.chooseBattleAction(state).type, "run"); // Acquisition, not EV yield.
});

test("one-ply rollout gaps are documented as probabilities, not pinned actions", (t) => {
  const automation = loadSafari(t, createGlobals({ nanab: 1 }));
  const enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 4 });
  const ball = automation.ballContinuation(enemy, neutral(1)).value;
  const nanabThenBalls = automation.baitValue(enemy, neutral(1), BaitType.Nanab).value;
  const nanabThenRockThenBall = 0.95 * automation.rockValue(enemy, { ...neutral(1), eating: 1, eatingBait: BaitType.Nanab }).value;
  close(ball, 0.04);
  close(nanabThenBalls, 0.019);
  close(nanabThenRockThenBall, 0.0456);
  assert.ok(nanabThenRockThenBall > ball);
});

test("K stays fixed across actions, statuses and balls, using only current-environment species share", (t) => {
  const globals = createGlobals({
    environment: 1,
    encounters: [encounter("Enemy", 2, 1), encounter("Water", 98, 1), encounter("Enemy", 1, 0)],
    ownedPokemons: { Enemy: owned(0) },
    razz: 1, nanab: 1,
  });
  const automation = loadSafari(t, globals);
  globals.SafariBattle.enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
  const state = createState(automation, globals);
  const q = 0.1 * (1 - 0.63 ** 30) / (1 - 0.63);
  const weight = automation.battleWeight(state, 1);
  close(weight, 1 / (0.02 * q));
  assert.ok(Math.abs(weight - 1 / (0.02 * 0.1)) > 100); // Not per throw.
  for (const battle of [
    neutral(1), { ...neutral(12), angry: 5, eatingBait: BaitType.Nanab },
    { ...neutral(29), eating: 6, eatingBait: BaitType.Razz },
  ]) {
    Object.assign(state.enemy, battle);
    state.balls = battle.balls;
    for (const action of automation.battleActionCandidates()) {
      automation.actionScore(state.enemy, battle, action);
      close(automation.battleWeight(state, 1), weight);
    }
  }
  globals.Safari.activeEnvironment(0);
  close(automation.battleWeight(state, 1), weight * 0.02);
  globals.Safari.activeEnvironment(1);
  state.enemy.levelModifier = 0.5; // Live base/level factors still change the fixed baseline.
  const leveledQ = 0.15 * (1 - 0.595 ** 30) / (1 - 0.595);
  close(automation.battleWeight(state, 1), 1 / (0.02 * leveledQ));
});

test("uncapped endgame progress never rescales the same fight or reads other species", (t) => {
  for (const share of [0.02, 0.2]) {
    const members = { Enemy: owned(0) };
    const globals = createGlobals({
      ownedPokemons: members, razz: 1, nanab: 1,
      encounters: [encounter("Enemy", share * 100, 0), encounter("Other", 100 - share * 100, 0)],
    });
    const automation = loadSafari(t, globals);
    globals.SafariBattle.enemy = pokemon("Enemy", 0, 0, false, { baseCatchFactor: 10 });
    const state = createState(automation, globals);
    globals.App.game.party.getPokemonByName = (name) => {
      assert.equal(name, "Enemy");
      return members[name];
    };
    const initial = automation.chooseBattleAction(state);
    const weight = automation.battleWeight(state, automation.progressValue(state.enemy));
    members.Enemy = owned(48.9);
    assert.equal(JSON.stringify(automation.chooseBattleAction(state)), JSON.stringify(initial));
    close(automation.battleWeight(state, automation.progressValue(state.enemy)), weight);
  }
});

test("stock is availability only and is re-read with live statuses", (t) => {
  const globals = createGlobals({ razz: 1, nanab: 1 });
  const automation = loadSafari(t, globals);
  const enemy = pokemon("Enemy", 0, 0, true, { baseCatchFactor: 10 });
  const state = { enemy, balls: 4 };
  assert.equal(automation.chooseBattleAction(state).bait, BaitType.Razz);
  globals.App.game.farming.berryInventory[BerryType.Razz](0);
  globals.App.game.farming.berryInventory[BerryType.Nanab](0);
  assert.equal(automation.chooseBattleAction(state).type, "throwBall");
  assert.ok(automation.battleActionCandidates().every((action) => action.type !== "throwBait" || action.bait === BaitType.Bait));
  globals.App.game.farming.berryInventory[BerryType.Razz](1);
  assert.equal(automation.chooseBattleAction(state).bait, BaitType.Razz);
  globals.App.game.farming.berryInventory[BerryType.Razz](1000);
  assert.equal(automation.chooseBattleAction(state).bait, BaitType.Razz);
  enemy.eatingBait = BaitType.Razz;
  assert.equal(automation.chooseBattleAction(state).type, "throwBall");
});

test("c=1 skips berries on commons and invests in bottlenecks with separated flip points", (t) => {
  // Kanto SafariPokemonList.ts:44–68, all unlocks available (grass total 166, water 109).
  // PokemonList catch rates / 6 per SafariPokemon.ts:46; level 1, no Oak bonus.
  for (const [name, catchRate, weight, total, environment, expected, flip, margin] of [
    ["Magikarp", 255, 20, 109, 1, "throwBall", 0.43173816418543504, 0.8476235331275355],
    ["Nidoran(M)", 235, 25, 166, 0, "throwBall", 0.6097481110454102, 0.597165158],
    ["Chansey", 30, 4, 166, 0, "throwBait", 9.539345162180737, 3.997301044],
  ]) {
    const globals = createGlobals({
      environment, razz: 1, nanab: 1, balls: 30,
      ownedPokemons: { [name]: owned(0) },
      encounters: [encounter(name, weight, environment), encounter("Background", total - weight, environment)],
    });
    const automation = loadSafari(t, globals);
    globals.SafariBattle.enemy = pokemon(name, 0, 0, false, { baseCatchFactor: catchRate / 6 });
    const state = createState(automation, globals);
    const K = automation.battleWeight(state, automation.progressValue(state.enemy));
    const ball = automation.ballContinuation(state.enemy, neutral());
    const razz = automation.baitValue(state.enemy, neutral(), BaitType.Razz);
    close(K * (razz.value - ball.value) / (razz.turns - ball.turns), flip);
    const selected = automation.chooseBattleAction(state);
    assert.equal(selected.type, expected);
    if (expected === "throwBait") {
      assert.equal(selected.bait, BaitType.Razz);
      assert.ok(flip > 5);
    } else {
      assert.ok(flip < 0.7);
    }
    const scores = automation.battleActionCandidates()
      .map((action) => automation.actionScore(state.enemy, neutral(), action))
      .map(({ value, turns }) => K * value - turns).sort((a, b) => b - a);
    assert.ok(Math.abs(scores[0] - scores[1] - margin) < 1e-9);
  }
});

test("patrols water encounter tiles when the Safari has no grass", (t) => {
  const globals = createGlobals({
    region: GameConstants.Region.alola,
    grid: [[GameConstants.SafariTile.ground, GameConstants.SafariTile.waterC, GameConstants.SafariTile.waterC]],
    inProgress: true,
  });
  const automation = loadSafari(t, globals);
  automation.automate();
  globals.runTimer();
  globals.Safari.playerXY.x = 1;
  globals.runTimer();
  globals.Safari.playerXY.x = 2;
  globals.runTimer();
  assert.deepEqual(globals.calls.move, ["right", "right", "left"]);
  globals.sectionEnabled(false);
});

test("cancels pending entrance payment when the section is disabled", (t) => {
  class SafariTownContent {}
  const globals = createGlobals({
    town: { content: [new SafariTownContent()] },
    safariModalState: "hidden",
  });
  globals.context.SafariTownContent = SafariTownContent;
  const automation = loadSafari(t, globals);
  automation.automate();
  assert.equal(globals.calls.openModal, 1);
  globals.sectionEnabled(false);
  globals.element("#safariModal").trigger("shown.bs.modal");
  assert.equal(globals.calls.pay, 0);
  assert.equal(globals.progress(), false);
});
