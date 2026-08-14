"use strict";

function _isNeighbouringItemTile(tile, other) {
  const a = tile.reward.localCoordinate;
  const b = other.reward.localCoordinate;
  const manhattanDistance = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  return manhattanDistance === 1;
}

function _chiselComparisonValue(tile) {
  // defer layerDepth of 1 to other tools to not waste chisel's power
  const x = tile.layerDepth;
  return x === 1 ? Infinity : x;
}

function _undergroundTileGlobalCoordinate(itemAnchors, tile) {
  const anchor = itemAnchors.get(tile.reward.rewardID);
  const coordinate = tile.reward.localCoordinate;
  return {
    x: anchor.x + coordinate.x,
    y: anchor.y + coordinate.y,
  };
}

function _getCandidateTiles(partitionedTiles) {
  return partitionedTiles.buried.filter((tile) => partitionedTiles.mined.some((other) => _isNeighbouringItemTile(tile, other)));
}

function _digOnce(mine, itemAnchors, itemTilesPartitioned, candidateTilesToDig) {
  if (App.game.underground.battery.canDischarge()) {
    App.game.underground.battery.discharge();
    return;
  }

  const survey = App.game.underground.tools.getTool(UndergroundToolType.Survey);
  if (survey.canUseTool()) {
    App.game.underground.tools.useTool(survey.id, 0, 0);
    return;
  }

  if (mine.itemsPartiallyFound < mine.itemsBuried) {
    const bomb = App.game.underground.tools.getTool(UndergroundToolType.Bomb);
    if (bomb.canUseTool()) {
      App.game.underground.tools.useTool(bomb.id, 0, 0);
      return;
    }
  }

  const hammer = App.game.underground.tools.getTool(UndergroundToolType.Hammer);
  if (hammer.canUseTool()) {
    const allCandidateTiles = candidateTilesToDig.values().flatMap((x) => x);
    const candidateCoordinates = allCandidateTiles.map((tile) => _undergroundTileGlobalCoordinate(itemAnchors, tile));

    const { width, height, grid } = mine;
    const tileValues = Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) => {
      const index = mine.getGridIndexForCoordinate({ x, y });
      return grid[index].layerDepth > 0 ? 1 : 0;
    }));
    for (const { x, y } of candidateCoordinates) {
      tileValues[x][y] = 10; // 1 item covering tile is better than 9 non-covering or unknown ones
    }

    let bestValue = 0;
    let bestCoordinate;

    for (let x = 1; x < width - 1; x++) {
      for (let y = 1; y < height - 1; y++) {
        let currentValue = 0;
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            currentValue += tileValues[x + i][y + j];
          }
        }
        if (currentValue > bestValue) {
          bestValue = currentValue;
          bestCoordinate = { x, y };
        }
      }
    }

    if (bestValue >= 2) {
      App.game.underground.tools.useTool(hammer.id, bestCoordinate.x, bestCoordinate.y);
      return;
    }
  }

  const chisel = App.game.underground.tools.getTool(UndergroundToolType.Chisel);
  if (chisel.canUseTool()) {
    let itemId;
    let minBuriedCount = Infinity;
    for (const [candidateItemId, partitionedTiles] of itemTilesPartitioned) {
      if (partitionedTiles.mined.length > 0 && partitionedTiles.buried.length < minBuriedCount) {
        minBuriedCount = partitionedTiles.buried.length;
        itemId = candidateItemId;
      }
    }

    let coordinate;
    if (itemId === undefined) {
      if (chisel.durability < 1) {
        return;
      }

      const diggableIndices = mine.grid.reduce((indices, tile, index) => {
        if (tile.layerDepth > 0) {
          indices.push(index);
        }
        return indices;
      }, []);
      const randomIndex = Rand.fromArray(diggableIndices);
      coordinate = mine.getCoordinateForGridIndex(randomIndex);
    } else {
      const candidateTiles = candidateTilesToDig.get(itemId);
      const tile = candidateTiles.sort((a, b) => _chiselComparisonValue(a) - _chiselComparisonValue(b))[0];
      coordinate = _undergroundTileGlobalCoordinate(itemAnchors, tile);
    }

    App.game.underground.tools.useTool(chisel.id, coordinate.x, coordinate.y);
  }
}

function _digMine(mine) {
  const itemAnchors = new Map();
  for (const [index, tile] of mine.grid.entries()) {
    if (!tile.reward || itemAnchors.has(tile.reward.rewardID)) {
      continue;
    }
    const { x, y } = mine.getCoordinateForGridIndex(index);
    const { x: localX, y: localY } = tile.reward.localCoordinate;
    itemAnchors.set(tile.reward.rewardID, { x: x - localX, y: y - localY });
  }

  const itemTiles = Map.groupBy(mine.grid.filter((tile) => tile.reward), (tile) => tile.reward.rewardID);
  const itemTilesPartitioned = new Map(itemTiles.entries().map(([itemId, tiles]) => {
    const partitioned = Object.groupBy(tiles, (tile) => tile.layerDepth > 0 ? "buried" : "mined");
    return [itemId, { buried: [], mined: [], ...partitioned }];
  }));
  const candidateTilesToDig = new Map(itemTilesPartitioned.entries().map(([itemId, partitionedTiles]) => [itemId, _getCandidateTiles(partitionedTiles)]));

  for (const [itemId, partitionedTiles] of itemTilesPartitioned) {
    for (const tile of partitionedTiles.buried) {
      ko.when(() => tile.layerDepth === 0, () => {
        partitionedTiles.buried.splice(partitionedTiles.buried.indexOf(tile), 1);
        partitionedTiles.mined.push(tile);

        candidateTilesToDig.set(itemId, _getCandidateTiles(partitionedTiles));
      });
    }
  }

  for (const [itemId, tiles] of itemTiles) {
    ko.when(() => tiles[0].reward.rewarded, () => {
      itemAnchors.delete(itemId);
      itemTiles.delete(itemId);
      itemTilesPartitioned.delete(itemId);
      candidateTilesToDig.delete(itemId);
    });
  }

  return App.game.statistics.secondsPlayed.subscribe(() => _digOnce(mine, itemAnchors, itemTilesPartitioned, candidateTilesToDig));
}

function _dig() {
  const _mine = App.game.underground._mine;
  let subscription;
  _whenReady(_mine, () => {
    subscription?.dispose();
    const mine = _mine();
    ko.when(() => mine.timeUntilDiscovery <= 0, () => {
      subscription = _digMine(mine);
    });
  });
}

function _flattenQuest(quest) {
  return quest instanceof MultipleQuestsQuest ? quest.quests : [quest];
}

function _getRemainingQuestAmount(quest) {
  return Math.max(0, quest.amount - (quest.focus() - quest.initial()));
}

function _sellGemPlates() {
  const gemPlates = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Gem);
  const activeGemQuests = ko.pureComputed(() => {
    const questLineQuests = App.game.quests.questLines()
      .filter((questLine) => questLine.state() === QuestLineState.started)
      .flatMap((questLine) => _flattenQuest(questLine.curQuestObject()));

    return [
      ...App.game.quests.questList(),
      ...questLineQuests,
    ].filter((quest) => quest instanceof GainGemsQuest && quest.inProgress() && quest.progress() < 1);
  });

  for (const gemPlate of gemPlates) {
    const amountToSell = ko.pureComputed(() => {
      if (gemPlate.sellLocked()) {
        return 0;
      }

      const gemsRemaining = activeGemQuests()
        .filter((quest) => quest.type === gemPlate.type)
        .reduce((maximum, quest) => Math.max(maximum, _getRemainingQuestAmount(quest)), 0);
      const availablePlates = player.itemList[gemPlate.itemName]();

      return Math.min(Math.ceil(gemsRemaining / gemPlate.value), availablePlates);
    });

    _whenReady(
      ko.pureComputed(() => amountToSell() > 0),
      () => UndergroundController.sellMineItem(gemPlate, amountToSell()),
    );
  }
}

function _sellUndergroundTreasures() {
  const treasures = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Diamond);
  const treasuresToSell = treasures.filter((treasure) => ItemList[treasure.itemName].basePrice === Infinity); // exclude Everstone
  for (const treasure of treasuresToSell) {
    const canSell = ko.pureComputed(() => treasure.isUnlocked() && !treasure.sellLocked() && player.itemList[treasure.itemName]() > 0);
    _whenReady(canSell, () => UndergroundTrading.quickSell(treasure));
  }
}

function _sellTreasures() {
  _sellGemPlates();
  _sellUndergroundTreasures();
}

function _automateUnderground() {
  _dig();
  _sellTreasures();
}

function automateUnderground() {
  ko.when(() => App.game.underground.canAccess(), _automateUnderground);
}
