'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const {
  assertFile,
  canonicalModulePath,
  createDeepConstant,
  createOfficialRandom,
  defaultImport,
  evaluateScope,
  gitRevision,
  gitWorktreeDirty,
  installTypeScriptLoader,
  resolveGameDir,
  sha256,
} = require('../../lib/runtime.cjs');
const { createVirtualClock } = require('../lib/virtual-clock.cjs');

const REQUIRED_GAME_FILES = [
  'src/modules/underground/mine/Mine.ts',
  'src/modules/underground/mine/MineConfig.ts',
  'src/modules/underground/UndergroundController.ts',
  'src/modules/underground/UndergroundItems.ts',
  'src/modules/underground/tools/UndergroundTool.ts',
  'src/modules/underground/tools/UndergroundTools.ts',
  'src/modules/underground/UndergroundBattery.ts',
  'src/modules/underground/Underground.ts',
  'src/modules/utilities/Rand.ts',
  'src/modules/utilities/SeededRand.ts',
  'src/modules/GameConstants.ts',
];
const TIMING_SOURCE_FILES = [
  'src/scripts/App.ts',
  'src/scripts/Game.ts',
];
const DEFAULT_MAX_DISCHARGE_FRAMES = 10000;

function defaultGameDir() {
  return resolveGameDir(path.resolve(__dirname, '..', '..'));
}

function defaultAutomationPath() {
  return path.resolve(__dirname, '..', '..', 'src', 'underground.js');
}

function createCounterMap(ko) {
  return new Proxy({}, {
    get(target, property) {
      if (!(property in target)) {
        target[property] = ko.observable(0);
      }
      return target[property];
    },
  });
}

function snapshotCounterMap(map) {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, value()]));
}

function subtractCounters(after, before) {
  const result = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const difference = (after[key] || 0) - (before[key] || 0);
    if (difference !== 0) {
      result[key] = difference;
    }
  }
  return result;
}

function sumObjectValues(object) {
  return Object.values(object).reduce((sum, value) => sum + value, 0);
}

function mineBoardHash(mine) {
  const cells = mine.grid.map((tile) => ({
    depth: tile.layerDepth,
    reward: tile.reward ? {
      rewardID: tile.reward.rewardID,
      undergroundItemID: tile.reward.undergroundItemID,
      localCoordinate: tile.reward.localCoordinate,
      rotations: tile.reward.rotations,
    } : null,
  }));
  return crypto.createHash('sha256').update(JSON.stringify(cells)).digest('hex');
}

function createRuntime(options = {}) {
  const gameDir = path.resolve(options.gameDir || process.env.POKECLICKER_DIR || defaultGameDir());
  const automationPath = path.resolve(options.automationPath || defaultAutomationPath());
  const seed = Number(options.seed ?? 1);
  const level = Number(options.level ?? 0);
  const region = Number(options.region ?? 7);
  const maxDischargeFrames = Number(options.maxDischargeFrames ?? DEFAULT_MAX_DISCHARGE_FRAMES);

  if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`seed must be a non-negative safe integer, got ${seed}`);
  if (!Number.isInteger(level) || level < 0) throw new Error(`level must be a non-negative integer, got ${level}`);
  if (!Number.isInteger(region) || region < 0 || region > 9) throw new Error(`region must be an integer from 0 to 9, got ${region}`);
  if (!Number.isInteger(maxDischargeFrames) || maxDischargeFrames < 1) {
    throw new Error(`maxDischargeFrames must be a positive integer, got ${maxDischargeFrames}`);
  }

  for (const relative of [...REQUIRED_GAME_FILES, ...TIMING_SOURCE_FILES]) {
    assertFile(path.join(gameDir, relative), `Required official game source ${relative}`);
  }
  assertFile(automationPath, 'Automation source');

  const knockoutPath = path.join(gameDir, 'node_modules', 'knockout');
  assertFile(path.join(knockoutPath, 'package.json'), 'The game Knockout dependency');
  const ko = require(knockoutPath);
  globalThis.ko = ko;

  const originalDeferUpdates = ko.options.deferUpdates;
  const clock = createVirtualClock();

  const inventory = new Map();
  const inventoryObservables = new Map();
  const itemList = new Proxy({}, {
    get(_target, property) {
      const name = String(property);
      return {
        displayName: name.replaceAll('_', ' '),
        basePrice: 1,
        gain(amount = 1) {
          inventory.set(name, (inventory.get(name) || 0) + amount);
          const observable = inventoryObservables.get(name);
          if (observable) observable(observable() + amount);
        },
      };
    },
  });
  const playerItems = new Proxy({}, {
    get(_target, property) {
      const name = String(property);
      if (!inventoryObservables.has(name)) {
        inventoryObservables.set(name, ko.observable(inventory.get(name) || 0));
      }
      return inventoryObservables.get(name);
    },
  });

  const modulesDir = path.join(gameDir, 'src', 'modules');
  const mocks = new Map();
  const setMock = (relative, exports) => mocks.set(
    canonicalModulePath(path.join(modulesDir, relative)),
    exports,
  );

  const noOpNotifier = { notify() {} };
  const notificationConstants = createDeepConstant();
  const settingObservables = new Map();
  const settings = {
    getSetting(name) {
      if (!settingObservables.has(name)) {
        const defaults = {
          autoRestartUndergroundMine: false,
          undergroundTreasureDisplayShowLocked: false,
          undergroundTreasureDisplaySorting: 'name',
          undergroundTreasureDisplaySortingDirection: false,
          undergroundTreasureDisplayGrouping: 'none',
        };
        settingObservables.set(name, ko.observable(defaults[name] ?? false));
      }
      return { observableValue: settingObservables.get(name) };
    },
  };

  class UndergroundHelpersMock {
    hired() { return []; }
    toJSON() { return {}; }
    fromJSON() {}
  }

  setMock('items/ItemList', { ItemList: itemList });
  setMock('settings', defaultImport(settings));
  setMock('notifications/Notifier', defaultImport(noOpNotifier));
  setMock('notifications/NotificationConstants', defaultImport(notificationConstants));
  setMock('notifications/NotificationOption', defaultImport({ info: 'info', success: 'success', warning: 'warning' }));
  setMock('underground/helper/UndergroundHelper', {
    UndergroundHelper: class UndergroundHelperMock {},
    UndergroundHelpers: UndergroundHelpersMock,
  });
  setMock('underground/UndergroundTreasuresSortOptions', { SortOptionConfigs: {}, SortOptions: {} });

  const loader = installTypeScriptLoader(gameDir, mocks);
  let officialRandom;
  let automationSubscriptions = [];
  let restored = false;
  const restore = () => {
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
        }
      }
    }
  };

  ko.options.deferUpdates = true;
  clock.installGlobalTimers();
  try {
    const GameConstants = require(path.join(modulesDir, 'GameConstants.ts'));
    const GameHelper = require(path.join(modulesDir, 'GameHelper.ts')).default;
    const UndergroundItems = require(path.join(modulesDir, 'underground', 'UndergroundItems.ts')).default;
    const { MineConfigs, MineType } = require(path.join(modulesDir, 'underground', 'mine', 'MineConfig.ts'));
    const { Mine } = require(path.join(modulesDir, 'underground', 'mine', 'Mine.ts'));
    const { UndergroundController } = require(path.join(modulesDir, 'underground', 'UndergroundController.ts'));
    const UndergroundToolType = require(path.join(modulesDir, 'underground', 'tools', 'UndergroundToolType.ts')).default;
    const UndergroundTools = require(path.join(modulesDir, 'underground', 'tools', 'UndergroundTools.ts')).default;
    const { UndergroundBattery } = require(path.join(modulesDir, 'underground', 'UndergroundBattery.ts'));
    const { Underground } = require(path.join(modulesDir, 'underground', 'Underground.ts'));
    const Rand = require(path.join(modulesDir, 'utilities', 'Rand.ts')).default;
    const SeededRand = require(path.join(modulesDir, 'utilities', 'SeededRand.ts')).default;
    const OakItemType = require(path.join(modulesDir, 'enums', 'OakItemType.ts')).default;
    const UndergroundItemValueType = require(path.join(modulesDir, 'enums', 'UndergroundItemValueType.ts')).default;
    officialRandom = createOfficialRandom(Rand, SeededRand, seed);

    const statistics = {
      undergroundItemsFound: ko.observable(0),
      undergroundSpecificItemsFound: createCounterMap(ko),
      undergroundLayersMined: ko.observable(0),
      undergroundSpecificLayersMined: createCounterMap(ko),
      undergroundLayersFullyMined: ko.observable(0),
      undergroundToolsUsed: createCounterMap(ko),
      undergroundBatteryDischarges: createCounterMap(ko),
      pokeballsObtained: createCounterMap(ko),
      secondsPlayed: ko.observable(0),
    };
    const usedOakItems = createCounterMap(ko);
    const oakItems = {
      isActive() { return false; },
      calculateBonus() { return 0; },
      use(type) { usedOakItems[type](usedOakItems[type]() + 1); },
    };

    globalThis.player = {
      highestRegion: () => region,
      itemList: playerItems,
      loseItem() {},
    };
    globalThis.App = { game: {
      statistics,
      oakItems,
      multiplier: { getBonus: () => 1 },
      party: { alreadyCaughtPokemonByName: () => false },
      wallet: { gainDiamonds() {} },
      gems: { gainGems() {} },
    } };

    const tools = new UndergroundTools();
    const battery = new UndergroundBattery();
    const mineObservable = ko.observable(null);
    const underground = {
      undergroundLevel: level,
      _mine: mineObservable,
      get mine() { return mineObservable(); },
      tools,
      battery,
      helpers: new UndergroundHelpersMock(),
      addUndergroundExp() {},
      generateMine() {},
    };
    App.game.underground = underground;
    tools.initialize();
    battery.initialize();

    if (options.battery === false) {
      battery.charge = () => {};
      battery.canDischarge = () => false;
    }

    Object.assign(globalThis, {
      GameConstants,
      GameHelper,
      UndergroundController,
      UndergroundItems,
      UndergroundItemValueType,
      MineConfigs,
      UndergroundToolType,
      OakItemType,
      Rand,
    });

    Object.assign(globalThis, evaluateScope(
      path.resolve(__dirname, '..', '..', 'src', 'common.js'),
      ['_disposeAll', '_runAndSubscribe', '_whenReady'],
    ));
    globalThis.AutomationSettings = {
      getValue(section, option) {
        return section === 'underground' && option === 'dig';
      },
    };
    const automationModule = evaluateScope(automationPath, ['underground']).underground;
    if (typeof automationModule?.dig !== 'function') {
      throw new Error('Automation source does not export underground.dig');
    }

    const gameTickMilliseconds = GameConstants.TICK_TIME;
    const gameTickSeconds = gameTickMilliseconds / GameConstants.SECOND;
    const workCycleSeconds = Math.max(
      GameConstants.WORKCYCLE_TIMEOUT_BASE - GameConstants.WORKCYCLE_TIMEOUT_DECREASE_PER_LEVEL * level,
      GameConstants.WORKCYCLE_TIMEOUT_MINIMUM,
    );
    let nextGameTickAt = gameTickMilliseconds;
    let achievementCounter = 0;
    let automationTicks = 0;
    let automationSetupElapsedNanoseconds = 0n;
    let automationActionElapsedNanoseconds = 0n;
    let activeMineTimingTrace = null;
    let activeDischargeTrace = null;

    function snapshotToolDurability() {
      return Object.fromEntries(tools.tools.map((tool) => [tool.id, tool.durability]));
    }

    function captureDischargeTransition() {
      if (!activeMineTimingTrace) return;
      const pattern = battery._activeDischargePattern;
      if (pattern && !activeDischargeTrace) {
        const state = battery.toJSON();
        activeDischargeTrace = {
          pattern: pattern.id,
          startedAtMilliseconds: clock.now,
          chargesAfterFirstFrame: state.charges,
          cooldownAfterFirstFrame: state.batteryCooldown,
        };
        activeMineTimingTrace.batteryDischarges.push(activeDischargeTrace);
      } else if (!pattern && activeDischargeTrace) {
        const state = battery.toJSON();
        activeDischargeTrace.completedAtMilliseconds = clock.now;
        activeDischargeTrace.chargesAfterCompletion = state.charges;
        activeDischargeTrace.cooldownAfterCompletion = state.batteryCooldown;
        activeDischargeTrace = null;
      }
    }

    function measureAutomation(phase, action) {
      const started = process.hrtime.bigint();
      try {
        return action();
      } finally {
        const elapsed = process.hrtime.bigint() - started;
        if (phase === 'setup') {
          automationSetupElapsedNanoseconds += elapsed;
        } else {
          automationActionElapsedNanoseconds += elapsed;
        }
      }
    }

    function flushKnockoutTasks(automationPhase = null) {
      if (automationPhase) {
        measureAutomation(automationPhase, () => ko.tasks.runEarly());
      } else {
        ko.tasks.runEarly();
      }
    }

    function processGameTick() {
      const mine = underground.mine;
      const automationReady = mine && mine.timeUntilDiscovery <= 0 && !mine.completed;
      const previousDigTick = Math.floor(statistics.secondsPlayed() / workCycleSeconds);
      let isAutomationTick = false;
      const discoveryBeforeTick = mine?.timeUntilDiscovery ?? 0;

      achievementCounter += gameTickMilliseconds;
      if (achievementCounter >= GameConstants.ACHIEVEMENT_TICK) {
        achievementCounter = 0;
        statistics.secondsPlayed(statistics.secondsPlayed() + 1);
        const currentDigTick = Math.floor(statistics.secondsPlayed() / workCycleSeconds);
        isAutomationTick = automationReady && currentDigTick !== previousDigTick;
      }

      underground.mine?.tick(gameTickSeconds);
      tools.update(gameTickSeconds);
      battery.update(gameTickSeconds);
      const discoveryCompleted = discoveryBeforeTick > 0 && underground.mine?.timeUntilDiscovery <= 0;
      if (activeMineTimingTrace && discoveryCompleted) {
        activeMineTimingTrace.toolDurabilityAfterDiscovery = snapshotToolDurability();
      }
      flushKnockoutTasks(isAutomationTick ? 'action' : discoveryCompleted ? 'setup' : null);
      if (isAutomationTick) automationTicks += 1;
      captureDischargeTransition();
    }

    function advanceVirtualTime() {
      const event = clock.advanceToNext(nextGameTickAt, () => {
        nextGameTickAt += gameTickMilliseconds;
        processGameTick();
      });
      return event.pendingMicrotasks;
    }

    function resolveMineType(name) {
      if (typeof name === 'number') return name;
      const normalized = String(name || 'Random').toLowerCase();
      const match = Object.keys(MineType)
        .filter((key) => Number.isNaN(Number(key)))
        .find((key) => key.toLowerCase() === normalized);
      if (!match) {
        const names = Object.keys(MineType).filter((key) => Number.isNaN(Number(key)));
        throw new Error(`unknown mine type ${name}; expected one of ${names.join(', ')}`);
      }
      return MineType[match];
    }

    function createMine(mineTypeName, mineIndex) {
      if (options.pairedBoards !== false) {
        officialRandom.seed(seed + mineIndex * 2);
      }
      const mineType = resolveMineType(mineTypeName);
      const minimumItems = Underground.calculateMinimumItemsToGenerate(level);
      const maximumItems = Underground.calculateMaximumItemsToGenerate(level);
      const timeToDiscover = UndergroundController.calculateDiscoverMineTimeout(mineType);
      const config = UndergroundController.generateMineConfig(mineType);
      const mine = new Mine({
        width: GameConstants.BASE_MINE_WIDTH,
        height: GameConstants.BASE_MINE_HEIGHT,
        minimumDepth: GameConstants.BASE_MINIMUM_LAYER_DEPTH,
        maximumExtraLayers: GameConstants.BASE_EXTRA_LAYER_DEPTH,
        minimumItemsToGenerate: minimumItems,
        extraItemsToGenerate: Math.max(maximumItems - minimumItems, 0),
        timeToDiscover,
        config,
      });
      mine.generate();
      if (options.pairedBoards !== false) {
        officialRandom.seed(seed + mineIndex * 2 + 1);
      }
      mineObservable(mine);
      flushKnockoutTasks('setup');
      return mine;
    }

    async function simulateMine(mineTypeName, mineIndex, maxTicks = 100000) {
      const mine = createMine(mineTypeName, mineIndex);
      const startedVirtualTime = clock.now;
      const automationTicksBefore = automationTicks;
      const discoverySeconds = mine.timeUntilDiscovery;
      const timingTrace = options.traceTiming ? {
        toolDurabilityBeforeDiscovery: snapshotToolDurability(),
        toolDurabilityAfterDiscovery: discoverySeconds > 0 ? null : snapshotToolDurability(),
        batteryDischarges: [],
      } : null;
      activeMineTimingTrace = timingTrace;
      const boardHash = mineBoardHash(mine);
      const initialDepth = mine.grid.reduce((sum, tile) => sum + tile.layerDepth, 0);
      const initialInventory = sumObjectValues(Object.fromEntries(inventory));
      const toolCountersBefore = snapshotCounterMap(statistics.undergroundToolsUsed);
      const batteryCountersBefore = snapshotCounterMap(statistics.undergroundBatteryDischarges);
      while (!mine.completed || battery._activeDischargePattern) {
        const ticks = automationTicks - automationTicksBefore;
        const dischargeActive = Boolean(battery._activeDischargePattern);
        if (!mine.completed && !dischargeActive && ticks >= maxTicks) {
          throw new Error(`mine did not complete within ${maxTicks} automation ticks`);
        }
        if (dischargeActive) {
          if (!clock.hasPendingTimers) {
            throw new Error('battery discharge is active without a pending timer');
          }
          const dischargeFrame = battery.toJSON().activeDischargeFrame;
          if (dischargeFrame > maxDischargeFrames) {
            throw new Error(`battery discharge exceeded ${maxDischargeFrames} frames`);
          }
        }
        const pendingMicrotasks = advanceVirtualTime();
        if (pendingMicrotasks) {
          await pendingMicrotasks;
          flushKnockoutTasks();
          captureDischargeTransition();
        }
      }

      const ticks = automationTicks - automationTicksBefore;
      const finalDepth = mine.grid.reduce((sum, tile) => sum + tile.layerDepth, 0);
      const gained = sumObjectValues(Object.fromEntries(inventory)) - initialInventory;
      activeMineTimingTrace = null;
      return {
        ticks,
        simulatedSeconds: (clock.now - startedVirtualTime) / GameConstants.SECOND,
        discoverySeconds,
        mineType: MineType[mine.mineType],
        boardHash,
        itemsBuried: mine.itemsBuried,
        itemsFound: mine.itemsFound,
        itemsGained: gained,
        itemsDestroyed: mine.itemsFound - gained,
        layersRemoved: initialDepth - finalDepth,
        layersLeft: finalDepth,
        toolsUsed: subtractCounters(snapshotCounterMap(statistics.undergroundToolsUsed), toolCountersBefore),
        batteryDischarges: subtractCounters(snapshotCounterMap(statistics.undergroundBatteryDischarges), batteryCountersBefore),
        ...(timingTrace ? { timingTrace } : {}),
      };
    }

    let hasRun = false;
    return {
      async run({ mines = 100, mineType = 'Random', maxTicks = 100000 } = {}) {
        if (restored) throw new Error('runtime has been restored and cannot be run');
        if (hasRun) throw new Error('runtime can only be run once');
        if (!Number.isInteger(mines) || mines < 1) throw new Error(`mines must be a positive integer, got ${mines}`);
        if (!Number.isInteger(maxTicks) || maxTicks < 1) throw new Error(`maxTicks must be a positive integer, got ${maxTicks}`);
        if (options.pairedBoards !== false && seed + mines * 2 > Number.MAX_SAFE_INTEGER) {
          throw new Error('seed and mine count exceed the safe integer range for paired streams');
        }
        hasRun = true;
        const started = process.hrtime.bigint();
        measureAutomation('setup', () => {
          automationSubscriptions = automationModule.dig();
        });
        const results = [];
        for (let index = 0; index < mines; index++) {
          results.push(await simulateMine(mineType, index, maxTicks));
        }
        const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
        const automationSetupElapsedMs = Number(automationSetupElapsedNanoseconds) / 1e6;
        const automationActionElapsedMs = Number(automationActionElapsedNanoseconds) / 1e6;
        const automationElapsedMs = automationSetupElapsedMs + automationActionElapsedMs;
        const modulesLoaded = [...loader.loaded].sort();
        const totals = results.reduce((total, result) => {
          for (const field of ['ticks', 'simulatedSeconds', 'discoverySeconds', 'itemsBuried', 'itemsFound', 'itemsGained', 'itemsDestroyed', 'layersRemoved', 'layersLeft']) {
            total[field] += result[field];
          }
          for (const [key, value] of Object.entries(result.toolsUsed)) total.toolsUsed[key] = (total.toolsUsed[key] || 0) + value;
          for (const [key, value] of Object.entries(result.batteryDischarges)) total.batteryDischarges[key] = (total.batteryDischarges[key] || 0) + value;
          return total;
        }, {
          ticks: 0,
          simulatedSeconds: 0,
          discoverySeconds: 0,
          itemsBuried: 0,
          itemsFound: 0,
          itemsGained: 0,
          itemsDestroyed: 0,
          layersRemoved: 0,
          layersLeft: 0,
          toolsUsed: {},
          batteryDischarges: {},
        });

        return {
          configuration: {
            seed,
            level,
            region,
            mines,
            mineType,
            battery: options.battery !== false,
            pairedBoards: options.pairedBoards !== false,
          },
          totals,
          averages: {
            ticksPerMine: totals.ticks / mines,
            layersRemovedPerMine: totals.layersRemoved / mines,
            itemsPerMine: totals.itemsFound / mines,
          },
          performance: {
            elapsedMs,
            automationSetupElapsedMs,
            automationSetupMicrosecondsPerMine: automationSetupElapsedMs * 1000 / mines,
            automationActionElapsedMs,
            automationActionMicrosecondsPerTick: totals.ticks === 0 ? 0 : automationActionElapsedMs * 1000 / totals.ticks,
            automationElapsedMs,
            minesPerSecond: mines / (elapsedMs / 1000),
          },
          officialSource: {
            gameDir,
            revision: gitRevision(gameDir),
            dirty: gitWorktreeDirty(gameDir),
            modulesLoaded,
            moduleHashes: Object.fromEntries(modulesLoaded.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
            coreHashes: Object.fromEntries(REQUIRED_GAME_FILES.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
            timingSourceHashes: Object.fromEntries(TIMING_SOURCE_FILES.map((relative) => [relative, sha256(path.join(gameDir, relative))])),
          },
          automationSource: {
            path: automationPath,
            sha256: sha256(automationPath),
          },
          mines: results,
        };
      },
      restore,
    };
  } catch (error) {
    restore();
    throw error;
  }
}

module.exports = {
  createRuntime,
  defaultAutomationPath,
  defaultGameDir,
};
