"use strict";

const dungeon = (() => {
  const SETTINGS_SECTION = "dungeon";

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

  const VISIBLE_INACCESSIBLE_TILE_OPTIONS = Object.freeze({
    accessible: false,
    visible: true,
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
    state.options.searchAllChests = AutomationSettings.getValue(SETTINGS_SECTION, "searchAllChests");
    state.options.fightAllBattles = AutomationSettings.getValue(SETTINGS_SECTION, "fightAllBattles");

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
  }

  function samePosition(a, b) {
    return a.x === b.x && a.y === b.y && a.floor === b.floor;
  }

  function hasVisitedNeighbor(state, tile) {
    const floor = state.board[tile.floor];
    return DIRECTIONS.some((direction) => {
      // the "neighbor" may be outside the floor at the edge
      const neighbor = floor[tile.y + direction.y]?.[tile.x + direction.x];
      return neighbor?.isVisited;
    });
  }

  function isAccessible(state, tile) {
    return tile.isVisited || hasVisitedNeighbor(state, tile);
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

  function exploreUnseen(state) {
    const isFrontier = (tile) => !tile.isVisited && isAccessible(state, tile);
    const tile = findTile(state, (candidate) => !candidate.isVisible && isFrontier(candidate))
      ?? findTile(state, isFrontier);
    return moveAction(tile);
  }

  function progressionTile(state) {
    const type = state.position.floor === state.board.length - 1 ?
      GameConstants.DungeonTileType.boss :
      GameConstants.DungeonTileType.ladder;
    return findTileByType(state, type);
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

  function tileDistance(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  function followTarget(state, target) {
    const floor = state.board[target.floor];
    let closestVisitedDistance = Infinity;
    let nextTile;

    for (const tile of state.allTiles[target.floor]) {
      if (!tile.isVisited) {
        continue;
      }

      const distance = tileDistance(tile, target);
      if (distance >= closestVisitedDistance) {
        continue;
      }

      let tileToVisit;
      let closestNextTileDistance = Infinity;
      for (const direction of DIRECTIONS) {
        const candidate = floor[tile.y + direction.y]?.[tile.x + direction.x];
        if (!candidate || candidate.isVisited) {
          continue;
        }

        const candidateDistance = tileDistance(candidate, target);
        if (candidateDistance < closestNextTileDistance) {
          tileToVisit = candidate;
          closestNextTileDistance = candidateDistance;
        }
      }

      if (closestNextTileDistance < Infinity) {
        closestVisitedDistance = distance;
        nextTile = tileToVisit;
      }
    }

    return moveAction(nextTile);
  }

  function findVisibleInaccessibleTarget(state) {
    const { options, progression } = state;
    if (progression?.isVisible && !isAccessible(state, progression)) {
      return progression;
    }

    if (options.fightAllBattles) {
      const battle = findTileByType(state, GameConstants.DungeonTileType.enemy, VISIBLE_INACCESSIBLE_TILE_OPTIONS);
      if (battle) {
        return battle;
      }
    }

    if (options.searchAllChests) {
      const chest = findTileByType(state, GameConstants.DungeonTileType.chest, VISIBLE_INACCESSIBLE_TILE_OPTIONS);
      if (chest) {
        return chest;
      }
    }
  }

  function chooseDungeonAction(state) {
    const { options, progression, position } = state;
    if (!allTargetsVisible(state)) {
      const target = findVisibleInaccessibleTarget(state);
      if (target) {
        return followTarget(state, target);
      }
      return exploreUnseen(state);
    }

    if (options.fightAllBattles) {
      const battle = findTileByType(state, GameConstants.DungeonTileType.enemy, { accessible: true });
      if (battle) {
        return moveAction(battle);
      }
      const inaccessibleBattle = findTileByType(state, GameConstants.DungeonTileType.enemy);
      if (inaccessibleBattle) {
        return followTarget(state, inaccessibleBattle);
      }
    }

    // open accessible chests regardless of the `searchAllChests` option
    const chest = findTileByType(state, GameConstants.DungeonTileType.chest, { accessible: true });
    if (chest) {
      return samePosition(position, chest) ? interactAction(Interaction.CHEST) : moveAction(chest);
    }
    if (options.searchAllChests) {
      const inaccessibleChest = findTileByType(state, GameConstants.DungeonTileType.chest);
      if (inaccessibleChest) {
        return followTarget(state, inaccessibleChest);
      }
    }

    if (isAccessible(state, progression)) {
      if (!samePosition(position, progression)) {
        return moveAction(progression);
      }
      return interactAction(progression.type === GameConstants.DungeonTileType.boss ? Interaction.BOSS : Interaction.LADDER);
    }

    return followTarget(state, progression);
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
    if (DungeonRunner.dungeonFinished() || DungeonRunner.timeLeft() <= 0) {
      // either finished or failed
      return;
    }

    if (DungeonRunner.fighting() || DungeonBattle.catching()) {
      // can't take an action now
      return;
    }

    updateDungeonState(state, map);
    const action = chooseDungeonAction(state);
    executeDungeonAction(action, map);
  }

  function completeDungeonMap(map) {
    const state = createDungeonState(map);
    const actionSubscription = _runAndSubscribe(DungeonRunner.timeLeft, () => takeAction(state, map));
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

  function restartDungeon() {
    const canStart = ko.pureComputed(() => _and([
      !DungeonGuides.hired(),
      App.game.gameState !== GameConstants.GameState.dungeon,
      DungeonRunner.dungeonFinished(),
    ]));

    const subscription = _whenReady(canStart, () => {
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
    automate,
  }
})();
