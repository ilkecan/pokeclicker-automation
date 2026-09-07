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
  encounters = [],
  balls = 10,
  inProgress = false,
  inBattle = false,
  busy = false,
  shinyBonus = 1,
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
      multiplier: { getBonus: () => shinyBonus },
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

test("optimizes normal encounters with basic bait only", (t) => {
  const globals = createGlobals({
    inBattle: true,
    balls: 10,
    battleModalState: "show",
  });
  globals.SafariBattle.enemy = pokemon("Normal", 0, 0, false, {
    baseCatchFactor: 10,
    baseEscapeFactor: 90,
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
    baseEscapeFactor: 70,
  });
  const automation = loadSafari(t, globals);
  const state = createState(automation, globals);

  const action = automation.chooseAction(state);
  assert.equal(action.type, "throwBait");
  assert.ok([BaitType.Razz, BaitType.Nanab].includes(action.bait));
  assert.equal(action.bait, BaitType.Razz);
  const highEscapeGlobals = createGlobals({
    inBattle: true,
    balls: 30,
    razz: 1,
    nanab: 1,
    battleModalState: "show",
  });
  highEscapeGlobals.SafariBattle.enemy = pokemon("Shiny", 0, 0, true, {
    baseCatchFactor: 0.1,
    baseEscapeFactor: 99,
  });
  const highEscapeAutomation = loadSafari(t, highEscapeGlobals);
  const highEscapeState = createState(highEscapeAutomation, highEscapeGlobals);
  assert.equal(highEscapeAutomation.chooseAction(highEscapeState).bait, BaitType.Nanab);
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
