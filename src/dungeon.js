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

  function findTileByType(state, type, { accessibleOnly = false } = {}) {
    const predicate = accessibleOnly
      ? (tile) => tile.type === type && isAccessible(state, tile)
      : (tile) => tile.type === type;

    return findTile(state, predicate);
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

  function findExplorationTile(state) {
    const isFrontier = (tile) => !tile.isVisited && isAccessible(state, tile);
    return findTile(state, (tile) => !tile.isVisible && isFrontier(tile))
      ?? findTile(state, isFrontier);
  }

  function progressionTile(state) {
    const type = state.position.floor === state.board.length - 1 ?
      GameConstants.DungeonTileType.boss :
      GameConstants.DungeonTileType.ladder;
    return findTileByType(state, type);
  }

  function allTargetsVisible(state, progression) {
    const floor = state.position.floor;
    const tiles = state.allTiles[floor];

    if (!progression) {
      return false;
    }

    if (state.options.searchAllChests) {
      const visibleChests = countTilesByType(tiles, GameConstants.DungeonTileType.chest);
      if (state.chestsOpened[floor] + visibleChests < state.targetCounts[floor].chests) {
        return false;
      }
    }

    if (state.options.fightAllBattles) {
      const visibleBattles = countTilesByType(tiles, GameConstants.DungeonTileType.enemy);
      if (state.battlesWon[floor] + visibleBattles < state.targetCounts[floor].battles) {
        return false;
      }
    }

    return true;
  }

  function chooseDungeonAction(state) {
    const progression = progressionTile(state);
    if (!allTargetsVisible(state, progression)) {
      return moveAction(findExplorationTile(state));
    }

    if (state.options.fightAllBattles) {
      const battle = findTileByType(state, GameConstants.DungeonTileType.enemy, { accessibleOnly: true });
      if (battle) {
        return moveAction(battle);
      }
      if (findTileByType(state, GameConstants.DungeonTileType.enemy)) {
        return moveAction(findExplorationTile(state));
      }
    }

    // open accessible chests regardless of the `searchAllChests` option
    const chest = findTileByType(state, GameConstants.DungeonTileType.chest, { accessibleOnly: true });
    if (chest) {
      return samePosition(state.position, chest) ? interactAction(Interaction.CHEST) : moveAction(chest);
    }
    if (state.options.searchAllChests) {
      if (findTileByType(state, GameConstants.DungeonTileType.chest)) {
        return moveAction(findExplorationTile(state));
      }
    }

    if (isAccessible(state, progression)) {
      if (!samePosition(state.position, progression)) {
        return moveAction(progression);
      }
      return interactAction(progression.type === GameConstants.DungeonTileType.boss ? Interaction.BOSS : Interaction.LADDER);
    }

    return moveAction(findExplorationTile(state));
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
    _automate(() => AutomationSettings.isEnabled(SETTINGS_SECTION), [
      restartDungeon,
      runDungeon,
    ]);
  };

  return {
    automate,
  }
})();
