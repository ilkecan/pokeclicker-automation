"use strict";

const dungeon = (() => {
  const SETTINGS_SECTION = "dungeon";

  const ChestTier = Object.freeze({
    common: 0,
    rare: 1,
    epic: 2,
    legendary: 3,
    mythic: 4,
  });
  const DIRECTIONS = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
  ];

  const Interaction = Object.freeze({
    CHEST: "chest",
    LADDER: "ladder",
    BOSS: "boss",
  });

  const ActionType = Object.freeze({
    MOVE: "move",
    INTERACT: "interact",
  });

  function createTileState(x, y, floor) {
    return {
      x,
      y,
      floor,
      isVisible: false,
      isVisited: false,
      type: null,
      chestTier: null,
    };
  }

  function createDungeonState(map) {
    const board = map.floorSizes.map((size, floor) =>
      Array.from({ length: size }, (_, y) =>
        Array.from({ length: size }, (_, x) => createTileState(x, y, floor))
      )
    );

    return {
      position: { x: 0, y: 0, floor: 0 },
      options: {
        searchAllChests: false,
        fightAllBattles: false,
      },
      targetCounts: map.floorSizes.map((size) => ({
        chests: size,
        battles: size * 2 + 3,
      })),
      chestsOpened: map.floorSizes.map(() => 0),
      battlesWon: map.floorSizes.map(() => 0),
      encountersWon: 0,
      progression: null,
      timeLeft: Infinity,
      routeGrid: null,
      board,
      allTiles: board.map((floor) => floor.flat()),
    };
  }

  function updateTileState(tileState, gameTile) {
    tileState.isVisible = gameTile.isVisible;
    tileState.isVisited = gameTile.isVisited;

    // The rest becomes available to the user if the tile is visible. Note that
    // the visibility is monotonic.
    if (!tileState.isVisible) {
      return;
    }

    tileState.type = gameTile.type();
    if (tileState.type === GameConstants.DungeonTileType.chest) {
      tileState.chestTier = gameTile.metadata.tier;
    }
  }

  function updateDungeonState(state, map) {
    state.options.fightAllBattles = AutomationSettings.getValue(SETTINGS_SECTION, "fightAllBattles");
    state.options.openAccessibleChests = AutomationSettings.getValue(SETTINGS_SECTION, "openAccessibleChests");
    state.options.minimumChestTier = AutomationSettings.getValue(SETTINGS_SECTION, "minimumChestTier");
    state.options.searchAllChests = AutomationSettings.getValue(SETTINGS_SECTION, "searchAllChests");

    state.timeLeft = DungeonRunner.timeLeft();
    const point = map.playerPosition();
    state.position.x = point.x;
    state.position.y = point.y;
    state.position.floor = point.floor;
    state.chestsOpened[point.floor] = DungeonRunner.chestsOpenedPerFloor[point.floor];

    const encountersWon = DungeonRunner.encountersWon();
    state.battlesWon[point.floor] += encountersWon - state.encountersWon;
    state.encountersWon = encountersWon;

    const floorIndex = state.position.floor;
    const floor = map.board()[floorIndex];
    for (const tileState of state.allTiles[floorIndex]) {
      updateTileState(tileState, floor[tileState.y][tileState.x]);
    }
    state.progression = progressionTile(state);
    state.routeGrid = createRouteGrid(state);
  }

  function samePosition(a, b) {
    return a.x === b.x && a.y === b.y && a.floor === b.floor;
  }

  function hasVisitedNeighbour(state, tile) {
    const floor = state.board[tile.floor];
    return DIRECTIONS.some((direction) => {
      // the "neighbour" may be outside the floor at the edge
      const neighbour = floor[tile.y + direction.y]?.[tile.x + direction.x];
      return neighbour?.isVisited;
    });
  }

  function isAccessible(state, tile) {
    return tile.isVisited || hasVisitedNeighbour(state, tile);
  }

  function findTile(state, predicate) {
    return state.allTiles[state.position.floor].find(predicate);
  }

  function countTilesByType(tiles, type) {
    return tiles.reduce((count, tile) => count + (tile.type === type), 0);
  }

  function findTileByType(state, type, { accessible, visible } = {}) {
    return findTile(state, (tile) =>
      tile.type === type &&
      (accessible === undefined || isAccessible(state, tile) === accessible) &&
      (visible === undefined || tile.isVisible === visible)
    );
  }

  function targetRouteCost(state, routeGrid, tile) {
    if (tile.isVisited && !samePosition(state.position, tile)) {
      return GameConstants.DUNGEON_TICK;
    }
    return routeGrid.costs[tile.y][tile.x];
  }

  function findBestTarget(state, routeGrid, predicate) {
    let bestTarget;
    let bestCost = Infinity;

    for (const tile of state.allTiles[state.position.floor]) {
      if (!predicate(tile)) {
        continue;
      }

      const cost = targetRouteCost(state, routeGrid, tile);
      if (cost >= bestCost) {
        continue;
      }

      bestTarget = tile;
      bestCost = cost;
    }

    return bestTarget;
  }

  function isTarget(state, tile) {
    switch (tile.type) {
      case progressionTileType(state):
        return true;
      case GameConstants.DungeonTileType.chest:
        return state.options.searchAllChests;
      case GameConstants.DungeonTileType.enemy:
        return state.options.fightAllBattles;
      default:
        return false;
    }
  }

  function routeCost(state, tile, unseenBattleChance) {
    if (isTarget(state, tile)) {
      return 0;
    }

    return frontierTime(tile, unseenBattleChance);
  }

  function isChestToOpen(tile, minimumChestTier) {
    return _and([
      tile.type === GameConstants.DungeonTileType.chest,
      ChestTier[tile.chestTier] >= ChestTier[minimumChestTier],
    ]);
  }

  function findChestThatCanRevealFloor(state, routeGrid) {
    const { allTiles, board, chestsOpened, options, position } = state;
    const floor = position.floor;
    const tiles = allTiles[floor];
    // `/ 3` is enough for revealing the chests & `/ 2` is for full floor
    // reveal. We use the latter here.
    const numChestsOpenedRequired = Math.ceil(board[floor].length / 2);
    const chestsNeeded = numChestsOpenedRequired - chestsOpened[floor];
    const isEligible = (tile) => isChestToOpen(tile, options.minimumChestTier);
    const numEligibleChests = tiles.reduce((count, tile) => count + isEligible(tile), 0);
    if (numEligibleChests < chestsNeeded) {
      return;
    }

    return findBestTarget(state, routeGrid, isEligible);
  }

  function moveAction(tile) {
    return {
      type: ActionType.MOVE,
      x: tile.x,
      y: tile.y,
      floor: tile.floor,
    };
  }

  function interactAction(interaction) {
    return {
      type: ActionType.INTERACT,
      interaction,
    };
  }

  function progressInteraction(progression) {
    switch (progression.type) {
      case GameConstants.DungeonTileType.boss:
        return Interaction.BOSS;
      case GameConstants.DungeonTileType.ladder:
        return Interaction.LADDER;
      default:
        console.error("[pokeclicker-automation] dungeon: unknown progression tile!");
    }
  }

  function findUnvisitedNonBattleNeighbour(state) {
    return findTile(state, (tile) => _and([
      !tile.isVisited,
      isAccessible(state, tile),
      tile.isVisible,
      tile.type !== GameConstants.DungeonTileType.enemy,
    ]));
  }

  function accessibleNeighbourGain(state, tile) {
    const floor = state.board[tile.floor];
    return DIRECTIONS.reduce((count, direction) => {
      const neighbour = floor[tile.y + direction.y]?.[tile.x + direction.x];
      return count + Boolean(neighbour && !isAccessible(state, neighbour));
    }, 0);
  }

  function unseenBattleProbability(state) {
    const floor = state.position.floor;
    const tiles = state.allTiles[floor];
    const unknownTileCount = tiles.reduce((count, tile) => count + !tile.isVisible, 0);
    if (!unknownTileCount) {
      return 0;
    }

    const knownBattleCount = countTilesByType(tiles, GameConstants.DungeonTileType.enemy);
    const remainingBattleCount = state.targetCounts[floor].battles - state.battlesWon[floor] - knownBattleCount;
    return remainingBattleCount / unknownTileCount;
  }

  function frontierTime(tile, unseenBattleChance) {
    // Even in the best case scenario where the battle takes 1 battle tick, the
    // score still prefers battle tiles only if there isn't any non-battle tile
    // with any neighbour gain. So there is no need to track the actual battle
    // time.
    const battleChance = tile.type === GameConstants.DungeonTileType.enemy ? 1 : unseenBattleChance;
    return GameConstants.DUNGEON_TICK +
      battleChance * (GameConstants.BATTLE_TICK - GameConstants.DUNGEON_TICK);
  }

  function exploreFrontier(state) {
    let bestTile;
    let bestScore = 0;
    const unseenBattleChance = unseenBattleProbability(state);

    for (const tile of state.allTiles[state.position.floor]) {
      if (tile.isVisited || !hasVisitedNeighbour(state, tile)) {
        continue;
      }

      const score = accessibleNeighbourGain(state, tile) / frontierTime(tile, unseenBattleChance);
      if (score >= bestScore) {
        bestTile = tile;
        bestScore = score;
      }
    }

    return moveAction(bestTile);
  }

  function progressionTileType(state) {
    return state.position.floor === state.board.length - 1 ?
      GameConstants.DungeonTileType.boss :
      GameConstants.DungeonTileType.ladder;
  }

  function progressionTile(state) {
    return findTileByType(state, progressionTileType(state));
  }

  function allTargetsVisible(state) {
    const { battlesWon, chestsOpened, options, position, progression, targetCounts } = state;
    const floor = position.floor;
    const tiles = state.allTiles[floor];

    if (!progression) {
      return false;
    }

    if (options.searchAllChests) {
      const visibleChests = countTilesByType(tiles, GameConstants.DungeonTileType.chest);
      if (chestsOpened[floor] + visibleChests < targetCounts[floor].chests) {
        return false;
      }
    }

    if (options.fightAllBattles) {
      const visibleBattles = countTilesByType(tiles, GameConstants.DungeonTileType.enemy);
      if (battlesWon[floor] + visibleBattles < targetCounts[floor].battles) {
        return false;
      }
    }

    return true;
  }

  function siftUp(queue, index) {
    const node = queue[index];
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2);
      if (queue[parentIndex].cost <= node.cost) {
        break;
      }

      queue[index] = queue[parentIndex];
      index = parentIndex;
    }
    queue[index] = node;
  }

  function siftDown(queue, index) {
    const node = queue[index];
    while (true) {
      const leftIndex = index * 2 + 1;
      if (leftIndex >= queue.length) {
        break;
      }

      let childIndex = leftIndex;
      const rightIndex = leftIndex + 1;

      if (rightIndex < queue.length && queue[rightIndex].cost < queue[leftIndex].cost) {
        childIndex = rightIndex;
      }

      if (queue[childIndex].cost >= node.cost) {
        break;
      }

      queue[index] = queue[childIndex];
      index = childIndex;
    }
    queue[index] = node;
  }

  function enqueueRouteNode(queue, x, y, cost) {
    queue.push({ x, y, cost });
    siftUp(queue, queue.length - 1);
  }

  function dequeueRouteNode(queue) {
    const node = queue[0];
    const lastNode = queue.pop();
    if (queue.length > 0) {
      queue[0] = lastNode;
      siftDown(queue, 0);
    }
    return node;
  }

  function createRouteGrid(state) {
    const floorIndex = state.position.floor;
    const floor = state.board[floorIndex];
    const unseenBattleChance = unseenBattleProbability(state);
    const costs = Array.from({ length: floor.length }, () => Array(floor.length).fill(Infinity));
    const predecessors = Array.from({ length: floor.length }, () => Array(floor.length).fill(null));
    const queue = [];

    for (const tile of state.allTiles[floorIndex]) {
      if (!tile.isVisited) {
        continue;
      }
      costs[tile.y][tile.x] = 0;
      enqueueRouteNode(queue, tile.x, tile.y, 0);
    }

    while (queue.length > 0) {
      const node = dequeueRouteNode(queue);
      if (node.cost !== costs[node.y][node.x]) {
        continue;
      }

      for (const direction of DIRECTIONS) {
        const candidate = floor[node.y + direction.y]?.[node.x + direction.x];
        if (!candidate || candidate.isVisited) {
          continue;
        }

        const candidateCost = node.cost + routeCost(state, candidate, unseenBattleChance);
        if (candidateCost >= costs[candidate.y][candidate.x]) {
          continue;
        }

        costs[candidate.y][candidate.x] = candidateCost;
        predecessors[candidate.y][candidate.x] = floor[node.y][node.x];
        enqueueRouteNode(queue, candidate.x, candidate.y, candidateCost);
      }
    }

    return { costs, predecessors };
  }

  function followTarget(routeGrid, target) {
    let tile = target;
    while (true) {
      const predecessor = routeGrid.predecessors[tile.y][tile.x];
      if (predecessor.isVisited) {
        break;
      }
      tile = predecessor;
    }
    return moveAction(tile);
  }


  function moveToOrInteract(position, target, interaction) {
    return samePosition(position, target) ?
      interactAction(interaction) :
      moveAction(target);
  }

  function chooseDungeonAction(state) {
    const { options, progression, position, routeGrid } = state;
    if (state.timeLeft < GameConstants.BATTLE_TICK) {
      const chest = findBestTarget(state, routeGrid, (tile) => _and([
        tile.type === GameConstants.DungeonTileType.chest,
        isAccessible(state, tile),
      ]));
      if (chest) {
        return moveToOrInteract(position, chest, Interaction.CHEST);
      }
    }

    // Try to reach unvisited, visible targets early to increase visibility /
    // reachability. Since we would have to eventually reach those targets
    // eventually, this should be mostly net positive.
    const target = findBestTarget(state, routeGrid, (tile) => _and([
      isTarget(state, tile),
      !isAccessible(state, tile),
    ]));
    if (target) {
      return followTarget(routeGrid, target);
    }

    if (!allTargetsVisible(state)) {
      const unvisitedNonBattleNeighbour = findUnvisitedNonBattleNeighbour(state);
      if (unvisitedNonBattleNeighbour) {
        // visiting unexplored accessible non-battle tiles increase future accessibility
        return moveAction(unvisitedNonBattleNeighbour);
      }

      if (!options.fightAllBattles && options.openAccessibleChests) {
        // Open chests we would open before progressing anyway if they can
        // reveal remaining targets sooner. Paired simulator evaluation showed
        // lower aggregate completion time and fewer battles without reducing
        // completion success, so keep this proactive behavior.
        const revealChest = findChestThatCanRevealFloor(state, routeGrid);
        if (revealChest) {
          if (!isAccessible(state, revealChest)) {
            return followTarget(routeGrid, revealChest);
          }
          return moveToOrInteract(position, revealChest, Interaction.CHEST);
        }
      }

      return exploreFrontier(state);
    }

    if (!isAccessible(state, progression)) {
      // prioritize finding the progression tile first
      return followTarget(routeGrid, progression);
    }

    if (options.fightAllBattles) {
      const battle = findBestTarget(state, routeGrid, (tile) => tile.type === GameConstants.DungeonTileType.enemy);
      if (battle) {
        return isAccessible(state, battle) ? moveAction(battle) : followTarget(routeGrid, battle);
      }
    }

    if (options.openAccessibleChests) {
      const chest = findBestTarget(state, routeGrid, (tile) => _and([
        isAccessible(state, tile),
        isChestToOpen(tile, options.minimumChestTier),
      ]));
      if (chest) {
        return moveToOrInteract(position, chest, Interaction.CHEST);
      }
    }

    return moveToOrInteract(position, progression, progressInteraction(progression));
  }

  function executeDungeonAction(action, map) {
    switch (action.type) {
      case ActionType.MOVE:
        map.moveToCoordinates(action.x, action.y, action.floor);
        break;
      case ActionType.INTERACT:
        switch (action.interaction) {
          case Interaction.CHEST:
            DungeonRunner.openChest();
            break;
          case Interaction.LADDER:
            DungeonRunner.nextFloor();
            break;
          case Interaction.BOSS:
            DungeonRunner.startBossFight();
            break;
        }
        break;
    }
  }

  function takeAction(state, map) {
    if (DungeonRunner.dungeonFinished()) {
      // dungeon is finished
      return;
    }

    if (state.timeLeft <= 0) {
      // dungeon is failed
      return;
    }

    if (DungeonRunner.fighting() || DungeonBattle.catching()) {
      // can't take an action now
      return;
    }

    const action = chooseDungeonAction(state);
    executeDungeonAction(action, map);
  }

  function completeDungeonMap(map) {
    const state = createDungeonState(map);
    const actionSubscription = _runAndSubscribe(DungeonRunner.timeLeft, () => {
      updateDungeonState(state, map);
      takeAction(state, map);
    });
    const disposeSubscription = ko.when(DungeonRunner.dungeonFinished, () => actionSubscription.dispose());

    return [
      actionSubscription,
      disposeSubscription,
    ];
  }

  function runDungeon() {
    const shouldRun = ko.pureComputed(() => _and([
      !DungeonGuides.hired(),
      App.game.gameState === GameConstants.GameState.dungeon,
      DungeonRunner.timeLeftPercentage() >= 100,
    ]));
    let subscriptions = [];

    const subscription = _whenReady(shouldRun, () => {
      _disposeAll(subscriptions); // almost surely no-op

      subscriptions = completeDungeonMap(DungeonRunner.map);
    });

    return [
      subscription,
      // `subscriptions` change dynamically, so we need a closure instead of a copied array
      { dispose() { _disposeAll(subscriptions); } },
    ]
  }

  function enterDungeon() {
    DungeonRunner.initializeDungeon(player.town.dungeon);
  }

  function areDungeonPokemonComplete(dungeon) {
    const includeShiny = false;
    return RouteHelper.listCompleted(dungeon.allAvailablePokemon(), includeShiny);
  }

  function dungeonNeedsRestart(dungeon) {
    return _or([
      App.game.quests.currentQuests().some((quest) => _and([
        !quest.isCompleted(),
        quest instanceof DefeatDungeonQuest,
        quest.dungeon === dungeon.name,
      ])),
      !DungeonRunner.isAchievementsComplete(dungeon),
      !areDungeonPokemonComplete(dungeon),
    ]);
  }

  function restartDungeon() {
    const canStart = ko.pureComputed(() => _and([
      !DungeonGuides.hired(),
      App.game.gameState !== GameConstants.GameState.dungeon,
      DungeonRunner.dungeonFinished(),
    ]));

    const subscription = _whenReady(canStart, () => {
      const dungeon = player.town.dungeon;
      if (_and([
        AutomationSettings.getValue(SETTINGS_SECTION, "smartAutoRestart"),
        !dungeonNeedsRestart(dungeon),
      ])) {
        return;
      }

      if (DungeonRunner.timeLeft() <= 0) {
        if (AutomationSettings.getValue(SETTINGS_SECTION, "restartUponLoss")) {
          enterDungeon();
        }
      } else {
        if (DungeonRunner.map?.currentTile().type() === GameConstants.DungeonTileType.entrance) {
          // dungeon left
          return;
        }

        if (AutomationSettings.getValue(SETTINGS_SECTION, "restartUponWin")) {
          enterDungeon();
        }
      }
    });
    return [subscription];
  }

  function automate() {
    _automate(AutomationSettings.enabled(SETTINGS_SECTION), [
      restartDungeon,
      runDungeon,
    ]);
  };

  return {
    ChestTier,
    automate,
    chooseDungeonAction,
    completeDungeonMap,
    createRouteGrid,
  }
})();
