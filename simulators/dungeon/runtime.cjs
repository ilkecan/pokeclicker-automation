'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  assertFile,
  createOfficialRandom,
  defaultImport,
  evaluateScope,
  evaluateTypeScriptScripts,
  gitRevision,
  gitWorktreeDirty,
  installTypeScriptLoader,
  resolveGameDir,
  sha256,
} = require('../../lib/runtime.cjs');
const { summarizeSample } = require('../lib/statistics.cjs');
const { createVirtualClock } = require('../lib/virtual-clock.cjs');

const REQUIRED_GAME_FILES = [
  'src/modules/GameConstants.ts',
  'src/modules/GameHelper.ts',
  'src/modules/utilities/Rand.ts',
  'src/modules/utilities/SeededRand.ts',
];
const DUNGEON_SCRIPTS = [
  'src/scripts/dungeons/Point.ts',
  'src/scripts/dungeons/DungeonTile.ts',
  'src/scripts/dungeons/DungeonMap.ts',
  'src/scripts/dungeons/DungeonRunner.ts',
];
const TIMING_SOURCE_FILES = ['src/scripts/App.ts', 'src/scripts/Game.ts'];
const CHEST_TIERS = ['common', 'rare', 'epic', 'legendary', 'mythic'];
const DEFAULT_SIZES = [5, 10, 14];
const DEFAULT_MAPS = 1000;

function defaultGameDir() {
  return resolveGameDir(path.resolve(__dirname, '..', '..'));
}

function defaultAutomationPath() {
  return path.resolve(__dirname, '..', '..', 'src', 'dungeon.js');
}

function mapHash(map) {
  const board = map.board().map((floor) => floor.map((row) => row.map((tile) => ({
    type: tile.type(),
    tier: tile.metadata?.tier ?? null,
  }))));
  return crypto.createHash('sha256').update(JSON.stringify({ floorSizes: map.floorSizes, board })).digest('hex');
}

function formatSettings(settings) {
  const enabled = [];
  if (settings.fightAllBattles) enabled.push('fight');
  if (settings.openAccessibleChests) enabled.push('open');
  if (settings.searchAllChests) enabled.push('search');
  return enabled.length ? enabled.join('+') : 'basic';
}

function allConfigurations() {
  return Array.from({ length: 8 }, (_, value) => ({
    fightAllBattles: Boolean(value & 1),
    openAccessibleChests: Boolean(value & 2),
    searchAllChests: Boolean(value & 4),
  }));
}

function validatePositiveInteger(name, value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`[pokeclicker-automation] dungeon-runtime: ${name} must be a positive integer, got ${value}`);
  }
}

function validateSize(size) {
  if (!Number.isInteger(size) || size < 5 || size > 14) {
    throw new Error(`[pokeclicker-automation] dungeon-runtime: size must be an integer from 5 to 14, got ${size}`);
  }
}

function validateTier(name, value) {
  if (!CHEST_TIERS.includes(value)) {
    throw new Error(`[pokeclicker-automation] dungeon-runtime: ${name} must be one of ${CHEST_TIERS.join(', ')}, got ${value}`);
  }
}
function createRuntime(options = {}) {
  const gameDir = path.resolve(options.gameDir || process.env.POKECLICKER_DIR || defaultGameDir());
  const automationPath = path.resolve(options.automationPath || defaultAutomationPath());
  const seed = Number(options.seed ?? 1);
  const battleTicks = Number(options.battleTicks ?? 1);
  const bossTicks = Number(options.bossTicks ?? 1);
  const ko = require(path.join(gameDir, 'node_modules', 'knockout'));
  const clock = createVirtualClock();
  const originalDeferUpdates = ko.options.deferUpdates;
  const loader = installTypeScriptLoader(gameDir);
  const originalGlobals = new Map();
  let restored = false;
  let hasRun = false;
  let automationSubscriptions = [];
  let actionElapsedNanoseconds = 0n;
  let setupElapsedNanoseconds = 0n;
  let policyCallbackCount = 0;
  let activeBattle = null;
  let completedBossBattles = 0;
  let automationModule;
  let GameConstants;
  let GameHelper;
  let Rand;
  let SeededRand;
  let Point;
  let DungeonTile;
  let DungeonMap;
  let DungeonRunner;
  let officialRandom;
  let context;
  let battleAdapter;

  function setGlobal(name, value) {
    if (!originalGlobals.has(name)) {
      originalGlobals.set(name, Object.prototype.hasOwnProperty.call(globalThis, name)
        ? { exists: true, value: globalThis[name] }
        : { exists: false });
    }
    globalThis[name] = value;
  }

  function measure(phase, action) {
    const started = process.hrtime.bigint();
    try {
      return action();
    } finally {
      const elapsed = process.hrtime.bigint() - started;
      if (phase === 'setup') setupElapsedNanoseconds += elapsed;
      else actionElapsedNanoseconds += elapsed;
    }
  }

  function flushTasks(phase = null) {
    if (phase) measure(phase, () => ko.tasks.runEarly());
    else ko.tasks.runEarly();
  }

  function restore() {
    if (restored) return;
    restored = true;
    try {
      for (const subscription of automationSubscriptions) subscription?.dispose();
      automationSubscriptions = [];
      ko.tasks.runEarly();
    } finally {
      ko.tasks.resetForTesting();
      ko.options.deferUpdates = originalDeferUpdates;
      try {
        officialRandom?.restore();
      } finally {
        try {
          loader.restore();
        } finally {
          clock.restoreGlobalTimers();
          for (const [name, previous] of originalGlobals) {
            if (previous.exists) globalThis[name] = previous.value;
            else delete globalThis[name];
          }
        }
      }
    }
  }

  function createObservableMap() {
    return new Proxy({}, {
      get(target, property) {
        if (!(property in target)) target[property] = ko.observable(0);
        return target[property];
      },
    });
  }

  function createBattleAdapter() {
    const adapter = {
      catching: () => false,
      generateNewEnemy() {
        activeBattle = { kind: 'regular', elapsed: 0 };
        DungeonRunner.fighting(true);
      },
      generateNewBoss() {
        activeBattle = { kind: 'boss', elapsed: 0 };
        DungeonRunner.fighting(true);
      },
      tick(milliseconds) {
        if (!activeBattle) return;
        activeBattle.elapsed += milliseconds;
        const duration = (activeBattle.kind === 'boss' ? bossTicks : battleTicks) * GameConstants.BATTLE_TICK;
        if (activeBattle.elapsed < duration) return;
        const kind = activeBattle.kind;
        activeBattle = null;
        DungeonRunner.map.currentTile().type(GameConstants.DungeonTileType.empty);
        DungeonRunner.map.currentTile().calculateCssClass();
        DungeonRunner.fighting(false);
        if (kind === 'boss') {
          completedBossBattles += 1;
          DungeonRunner.fightingBoss(false);
          DungeonRunner.defeatedBoss('simulated boss');
          DungeonRunner.dungeonWon();
        } else {
          DungeonRunner.encountersWon(DungeonRunner.encountersWon() + 1);
        }
      },
    };
    return adapter;
  }

  function installEnvironment() {
    assertFile(path.join(gameDir, 'node_modules', 'knockout', 'package.json'), 'The game Knockout dependency');
    for (const relative of [...REQUIRED_GAME_FILES, ...DUNGEON_SCRIPTS, ...TIMING_SOURCE_FILES]) {
      assertFile(path.join(gameDir, relative), `Required official game source ${relative}`);
    }
    assertFile(automationPath, 'Automation source');

    ko.options.deferUpdates = true;
    setGlobal('ko', ko);
    clock.installGlobalTimers();
    GameConstants = require(path.join(gameDir, 'src', 'modules', 'GameConstants.ts'));
    GameHelper = require(path.join(gameDir, 'src', 'modules', 'GameHelper.ts')).default || require(path.join(gameDir, 'src', 'modules', 'GameHelper.ts'));
    Rand = require(path.join(gameDir, 'src', 'modules', 'utilities', 'Rand.ts')).default;
    SeededRand = require(path.join(gameDir, 'src', 'modules', 'utilities', 'SeededRand.ts')).default;
    officialRandom = createOfficialRandom(Rand, SeededRand, seed);

    battleAdapter = createBattleAdapter();
    const statistics = {
      dungeonsCleared: createObservableMap(),
      dungeonGuideClears: createObservableMap(),
    };
    const app = { game: {
      gameState: GameConstants.GameState.town,
      statistics,
      wallet: { loseAmount() {}, addAmount() {}, gainMoney() {}, gainDungeonTokens() {} },
      farming: { gainBerry() {} },
      pokeballs: {},
      party: { alreadyCaughtPokemon() { return false; } },
      breeding: { progressEggsBattle() {} },
      oakItems: { isActive() { return false; } },
    } };
    const player = { region: 0, town: { dungeon: null }, loseItem() {}, gainItem() {}, lowerItemMultipliers() {} };
    const mapHelper = { moveToTown() { app.game.gameState = GameConstants.GameState.town; } };
    const dungeonGuides = { hired() { return null; }, startDungeon() {}, endDungeon() {} };
    const notifier = { notify() {}, confirm: async () => true };
    const flute = { getFluteMultiplier() { return 1; } };
    const effectEngine = { isActive() { return () => false; } };
    const notificationConstants = new Proxy({}, { get: () => new Proxy({}, { get: () => 'notification' }) });

    ({ context, value: { Point, DungeonTile, DungeonMap, DungeonRunner } } = evaluateTypeScriptScripts(
      gameDir,
      DUNGEON_SCRIPTS,
      {
        GameConstants,
        GameHelper,
        Rand,
        ko,
        DungeonBattle: battleAdapter,
        App: app,
        player,
        MapHelper: mapHelper,
        DungeonGuides: dungeonGuides,
        Notifier: notifier,
        FluteEffectRunner: flute,
        EffectEngineRunner: effectEngine,
        NotificationConstants: notificationConstants,
      },
      '({ Point, DungeonTile, DungeonMap, DungeonRunner })',
    ));

    context.DungeonBattle = battleAdapter;
    context.DungeonRunner = DungeonRunner;
    DungeonRunner.gainLoot = () => {};
    context.player = player;
    context.MapHelper = mapHelper;
    context.DungeonGuides = dungeonGuides;
    context.Notifier = notifier;
    context.FluteEffectRunner = flute;
    context.EffectEngineRunner = effectEngine;

    Object.assign(globalThis, {
      ko,
      GameConstants,
      GameHelper,
      Rand,
      DungeonRunner,
      DungeonBattle: battleAdapter,
      App: app,
      player,
      MapHelper: mapHelper,
      DungeonGuides: dungeonGuides,
      Notifier: notifier,
      FluteEffectRunner: flute,
      EffectEngineRunner: effectEngine,
      NotificationConstants: notificationConstants,
    });
    const common = evaluateScope(path.resolve(__dirname, '..', '..', 'src', 'common.js'), [
      '_and', '_disposeAll', '_runAndSubscribe', '_whenReady',
    ]);
    Object.assign(globalThis, common);
    const originalRunAndSubscribe = common._runAndSubscribe;
    setGlobal('_runAndSubscribe', (observable, action) => {
      let immediate = true;
      return originalRunAndSubscribe(observable, (value) => {
        policyCallbackCount += 1;
        if (immediate) action(value);
        else measure('action', () => action(value));
        immediate = false;
      });
    });
    setGlobal('AutomationSettings', {
      getValue(section, option) {
        if (section !== 'dungeon') return false;
        return currentSettings[option];
      },
    });
    automationModule = evaluateScope(automationPath, ['dungeon']).dungeon;
    if (typeof automationModule?.completeDungeonMap !== 'function') {
      throw new Error('[pokeclicker-automation] dungeon-runtime: Automation source does not export dungeon.completeDungeonMap');
    }
    return { app, player, battleAdapter };
  }

  let currentSettings = {};
  try {
    validatePositiveInteger('battleTicks', battleTicks);
    validatePositiveInteger('bossTicks', bossTicks);
    installEnvironment();
  } catch (error) {
    restore();
    throw error;
  }

  function resetRunner(map, fixture) {
    activeBattle = null;
    completedBossBattles = 0;
    DungeonRunner.dungeon = fixture;
    DungeonRunner.map = map;
    DungeonRunner.timeBonus(1);
    DungeonRunner.timeLeft(GameConstants.DUNGEON_TIME);
    DungeonRunner.timeLeftPercentage(100);
    DungeonRunner.chestsOpened(0);
    DungeonRunner.encountersWon(0);
    DungeonRunner.chestsOpenedPerFloor = new Array(map.board().length).fill(0);
    DungeonRunner.currentTileType = ko.pureComputed(() => DungeonRunner.map.currentTile().type);
    DungeonRunner.fighting(false);
    DungeonRunner.fightingBoss(false);
    DungeonRunner.defeatedBoss(null);
    DungeonRunner.dungeonFinished(false);
    DungeonRunner.fightingLootEnemy = false;
    DungeonRunner.continuousInteractionInput = false;
    fixture.name = fixture.name;
    fixture.difficulty = 0;
    fixture.hasUnlockedBoss = () => true;
    context.App.game.gameState = GameConstants.GameState.dungeon;
    globalThis.App.game.gameState = GameConstants.GameState.dungeon;
    fixture.rewardFunction = () => {};
    fixture.difficultyRoute = 1;
    fixture.baseHealth = 1;
    context.App.game.gameState = GameConstants.GameState.dungeon;
    globalThis.App.game.gameState = GameConstants.GameState.dungeon;
  }

  function createFixture() {
    const name = GameConstants.RegionDungeons?.flat?.()[0] || 'Viridian Forest';
    return {
      name,
      difficulty: 0,
      difficultyRoute: 1,
      baseHealth: 1,
      hasUnlockedBoss: () => true,
      rewardFunction: () => {},
    };
  }

  async function simulateMap(size, mapIndex, settings, chestTier, minimumChestTier, rootSeed) {
    const mapSeed = rootSeed + mapIndex * 2;
    officialRandom.seed(mapSeed);
    const map = new DungeonMap(size, () => ({
      tier: chestTier,
      loot: { loot: 'simulated loot', amount: 1, ignoreDebuff: false },
    }));
    const initialHash = mapHash(map);
    const fixture = createFixture();
    context.App.game.statistics.dungeonsCleared[GameConstants.getDungeonIndex(fixture.name)](0);
    currentSettings = { ...settings, minimumChestTier };
    resetRunner(map, fixture);
    const startedVirtualTime = clock.now;
    const subscriptions = measure('setup', () => automationModule.completeDungeonMap(map));
    automationSubscriptions.push(...subscriptions);
    flushTasks();

    const maximumTicks = Math.ceil((GameConstants.DUNGEON_TIME + (map.board().length - 1) * GameConstants.DUNGEON_LADDER_BONUS) / GameConstants.DUNGEON_TICK) + 2;
    let nextGameTickAt = clock.now + GameConstants.TICK_TIME;
    let ticks = 0;
    while (!DungeonRunner.dungeonFinished()) {
      if (ticks >= maximumTicks) {
        subscriptions.forEach((subscription) => subscription?.dispose());
        throw new Error(`[pokeclicker-automation] dungeon-runtime: dungeon did not finish within official time bound of ${maximumTicks} ticks`);
      }
      const event = clock.advanceToNext(nextGameTickAt, () => {
        nextGameTickAt += GameConstants.TICK_TIME;
        battleAdapter.tick(GameConstants.TICK_TIME);
        DungeonRunner.tick();
      });
      if (event.pendingMicrotasks) await event.pendingMicrotasks;
      if (event.type === 'external') ticks += 1;
      flushTasks('action');
    }
    subscriptions.forEach((subscription) => subscription?.dispose());
    automationSubscriptions = automationSubscriptions.filter((subscription) => !subscriptions.includes(subscription));
    const regularBattles = DungeonRunner.encountersWon();
    const chestsOpened = DungeonRunner.chestsOpened();
    const simulatedSeconds = (clock.now - startedVirtualTime) / GameConstants.SECOND;
    const status = completedBossBattles > 0 ? 'completed' : 'timedOut';
    return {
      mapIndex,
      mapSeed,
      mapHash: initialHash,
      status,
      ticks,
      simulatedSeconds,
      remainingDungeonSeconds: DungeonRunner.timeLeft() / GameConstants.SECOND,
      regularBattles,
      bossBattles: completedBossBattles,
      chestsOpened,
    };
  }

  function scenarioDefinitions({ single, size, sizes, settings }) {
    if (single) return [{ size, settings: { ...settings }, label: formatSettings(settings) }];
    return sizes.flatMap((scenarioSize) => allConfigurations().map((scenarioSettings) => ({
      size: scenarioSize,
      settings: scenarioSettings,
      label: formatSettings(scenarioSettings),
    })));
  }

  function summarizeScenario(results) {
    const completed = results.filter((result) => result.status === 'completed');
    const sum = (field) => results.reduce((total, result) => total + result[field], 0);
    const totals = {
      maps: results.length,
      completed: completed.length,
      timedOut: results.length - completed.length,
      ticks: sum('ticks'),
      simulatedSeconds: sum('simulatedSeconds'),
      regularBattles: sum('regularBattles'),
      bossBattles: sum('bossBattles'),
      chestsOpened: sum('chestsOpened'),
    };
    const completionTimes = completed.map((result) => result.simulatedSeconds);
    const distributions = {
      completionSeconds: summarizeSample(completionTimes),
      regularBattles: summarizeSample(results.map((result) => result.regularBattles)),
      bossBattles: summarizeSample(results.map((result) => result.bossBattles)),
      chestsOpened: summarizeSample(results.map((result) => result.chestsOpened)),
    };
    return {
      totals,
      averages: {
        completionSeconds: distributions.completionSeconds.mean,
        regularBattles: distributions.regularBattles.mean,
        bossBattles: distributions.bossBattles.mean,
        chestsOpened: distributions.chestsOpened.mean,
      },
      distributions,
    };
  }

  return {
    async run({
      maps = DEFAULT_MAPS,
      sizes = DEFAULT_SIZES,
      single = false,
      size = 5,
      settings = { fightAllBattles: false, openAccessibleChests: false, searchAllChests: false },
      chestTier = 'common',
      minimumChestTier = 'common',
    } = {}) {
      if (restored) throw new Error('[pokeclicker-automation] dungeon-runtime: runtime has been restored and cannot be run');
      if (hasRun) throw new Error('[pokeclicker-automation] dungeon-runtime: runtime can only be run once');
      validatePositiveInteger('maps', maps);
      validateTier('chestTier', chestTier);
      validateTier('minimumChestTier', minimumChestTier);
      validateSize(size);
      sizes.forEach(validateSize);
      if (!Number.isSafeInteger(seed) || seed + maps * 2 > Number.MAX_SAFE_INTEGER) {
        throw new Error('[pokeclicker-automation] dungeon-runtime: seed and map count exceed the safe integer range');
      }
      hasRun = true;
      const started = process.hrtime.bigint();
      const definitions = scenarioDefinitions({ single, size, sizes, settings });
      const scenarios = [];
      for (const definition of definitions) {
        const results = [];
        for (let mapIndex = 0; mapIndex < maps; mapIndex++) {
          results.push(await simulateMap(definition.size, mapIndex, definition.settings, chestTier, minimumChestTier, seed));
        }
        scenarios.push({
          size: definition.size,
          label: definition.label,
          settings: { ...definition.settings, minimumChestTier },
          ...summarizeScenario(results),
          maps: results,
        });
      }
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
      const setupMs = Number(setupElapsedNanoseconds) / 1e6;
      const actionMs = Number(actionElapsedNanoseconds) / 1e6;
      const automationMs = setupMs + actionMs;
      const loadedFiles = [...new Set([
        ...loader.loaded,
        ...REQUIRED_GAME_FILES,
        ...DUNGEON_SCRIPTS,
      ])].sort();
      return {
        configuration: {
          mode: single ? 'single' : 'matrix',
          seed,
          maps,
          sizes: single ? [size] : [...sizes],
          chestTier,
          minimumChestTier,
          battleTicks,
          bossTicks,
          ...(single ? { settings: { ...settings } } : {}),
        },
        performance: {
          elapsedMs,
          automationSetupElapsedMs: setupMs,
          automationSetupMicrosecondsPerMap: setupMs * 1000 / (maps * scenarios.length),
          automationActionElapsedMs: actionMs,
          automationActionMicrosecondsPerCallback: policyCallbackCount === 0 ? 0 : actionMs * 1000 / policyCallbackCount,
          automationElapsedMs: automationMs,
          mapsPerSecond: scenarios.length * maps / (elapsedMs / 1000),
        },
        officialSource: {
          gameDir,
          revision: gitRevision(gameDir),
          dirty: gitWorktreeDirty(gameDir),
          modulesLoaded: loadedFiles,
          moduleHashes: Object.fromEntries(loadedFiles.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
          coreHashes: Object.fromEntries(REQUIRED_GAME_FILES.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
          timingSourceHashes: Object.fromEntries(TIMING_SOURCE_FILES.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
        },
        automationSource: { path: automationPath, sha256: sha256(automationPath) },
        scenarios,
      };
    },
    restore,
  };
}

module.exports = { createRuntime, defaultAutomationPath, defaultGameDir };
