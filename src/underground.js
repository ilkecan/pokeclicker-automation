"use strict";

const automateUnderground = (() => {
  const DIG_INTERVAL_SECONDS = 1;

  // from src/modules/underground/tools/UndergroundTools.ts
  const ToolStrength = Object.freeze({
    BOMB: 2,
    CHISEL: 2,
    HAMMER: 1,
  });

  const BASE_BOMB_TILE_COUNT = 10;

  function bombTileCount() {
    const oak_item_type = OakItemType.Explosive_Charge;
    const explosiveCharge = App.game.oakItems.isActive(oak_item_type)
      ? App.game.oakItems.calculateBonus(oak_item_type)
      : 0;

    return BASE_BOMB_TILE_COUNT + explosiveCharge;
  }

  const Side = Object.freeze({
    EMPTY: 0b0000,
    NORTH: 0b0001,
    EAST: 0b0010,
    SOUTH: 0b0100,
    WEST: 0b1000,
  });

  function isFilledCell(shape, x, y) {
    return shape[y]?.[x] === 1;
  }

  // An item's outline is drawn inside its own tiles rather than along the grid
  // lines, so an uncovered tile shows which of its four sides the item stops at.
  function edgeSignature(shape, x, y) {
    const north = isFilledCell(shape, x, y - 1) ? Side.EMPTY : Side.NORTH;
    const east  = isFilledCell(shape, x + 1, y) ? Side.EMPTY : Side.EAST;
    const south = isFilledCell(shape, x, y + 1) ? Side.EMPTY : Side.SOUTH;
    const west  = isFilledCell(shape, x - 1, y) ? Side.EMPTY : Side.WEST;

    return north | east | south | west;
  }

  const shapeVariantsByItem = new Map();

  // The four rotations of an item, each as the cells it fills and the signature
  // each of those cells shows. Item shapes never change, so this is built once.
  function getShapeVariants(undergroundItemID) {
    const cached = shapeVariantsByItem.get(undergroundItemID);
    if (cached) {
      return cached;
    }

    const { space } = UndergroundItems.getById(undergroundItemID);
    const variants = Array.from({ length: 4 }, (_, rotations) => {
      const shape = UndergroundController.rotateMatrix90Clockwise(space, rotations);
      const cells = [];
      for (let y = 0; y < shape.length; y++) {
        const row = shape[y];
        for (let x = 0; x < row.length; x++) {
          if (isFilledCell(shape, x, y)) {
            cells.push({ x, y, signature: edgeSignature(shape, x, y) });
          }
        }
      }

      return cells;
    });

    shapeVariantsByItem.set(undergroundItemID, variants);
    return variants;
  }

  // whether a tile could be part of an item of this kind
  function couldBelongTo(record, undergroundItemID) {
    if (!record) {
      // hangs off the edge of the mine
      return false;
    }

    const { tile } = record;

    if (tile.layerDepth > 0) {
      // still buried
      return true;
    }

    const { reward } = tile;
    if (!reward) {
      // bare ground
      return false;
    }

    if (reward.rewarded) {
      // an item already dug out and taken
      return false;
    }

    if (reward.undergroundItemID !== undergroundItemID) {
      // a different kind item
      return false;
    }

    // An uncovered tile of the same kind, which may or may not be a tile of
    // this very item.
    return true;
  }

  // Every placement of this item that would render the uncovered tile exactly
  // as it appears and that no other tile on screen contradicts. Keyed so the
  // sets deduced from two uncovered tiles of one item can be intersected.
  function consistentPlacements(tileRecords, record) {
    const { reward } = record.tile;
    const variants = getShapeVariants(reward.undergroundItemID);
    const { x: localX, y: localY } = reward.localCoordinate;
    const observed = variants[reward.rotations].find((cell) => cell.x === localX && cell.y === localY).signature;

    const placements = new Map();
    for (let rotations = 0; rotations < 4; rotations++) {
      const cells = variants[rotations];
      for (const cell of cells) {
        if (cell.signature !== observed) {
          continue;
        }

        const originX = record.x - cell.x;
        const originY = record.y - cell.y;
        const covered = [];
        for (const other of cells) {
          const target = tileRecords[originY + other.y]?.[originX + other.x];
          if (!couldBelongTo(target, reward.undergroundItemID)) {
            // reaches over invalid space the player can see
            covered.length = 0;
            break;
          }

          covered.push(target);
        }

        if (covered.length > 0) {
          placements.set(`${rotations}:${originX}:${originY}`, covered);
        }
      }
    }

    return placements;
  }

  // a single uncovered tile and the placements it alone allows
  function createItem(record, placements) {
    return {
      undergroundItemID: record.tile.reward.undergroundItemID,
      placements,
      uncovered: new Set([record]),
      covered: new Map(),
      remainingDepth: 0,
    };
  }

  // Groups uncovered item tiles into items, then puts odds on every tile that
  // could still be covering one. Only uncovered tiles are read here, so
  // nothing off screen can reach a decision.
  function deduceItems(tileRecords, allTileRecords) {
    const items = [];

    for (const record of allTileRecords) {
      if (record.tile.layerDepth > 0) {
        continue;
      }

      const { reward } = record.tile;
      if (!reward || reward.rewarded) {
        continue;
      }

      const placements = consistentPlacements(tileRecords, record);
      // Two uncovered tiles belong to the same item when one placement explains
      // both. Sharing no placement makes them separate items, even when they are
      // the same kind of item.
      const item = items.find((candidate) => candidate.undergroundItemID === reward.undergroundItemID
        && candidate.placements.keys().some((key) => placements.has(key)));

      if (!item) {
        items.push(createItem(record, placements));
        continue;
      }

      for (const key of item.placements.keys()) {
        if (!placements.has(key)) {
          item.placements.delete(key);
        }
      }
      item.uncovered.add(record);
    }

    const result = [];
    for (const item of items) {
      // couldBelongTo already rejects most invalid placements. What is left to
      // refute needs the grouping: a placement reaching over an uncovered tile
      // of this same kind that belongs to a different item of it.
      for (const [key, covered] of item.placements) {
        if (covered.some((record) => record.tile.layerDepth === 0 && !item.uncovered.has(record))) {
          item.placements.delete(key);
        }
      }

      if (item.placements.size === 0) {
        // The greedy grouping above can join uncovered tiles that do not
        // really belong together (i.e. two different items of the same kind
        // sharing a placement key by coincidence) and refutation then narrows
        // their combined set to nothing.
        //
        // So it is split back into separate groups for each uncovered tile,
        // where each start over from their own placements and go through this
        // same refutation on their own.
        if (item.uncovered.size > 1) {
          for (const record of item.uncovered) {
            items.push(createItem(record, consistentPlacements(tileRecords, record)));
          }
          continue;
        }

        // Down to one tile and still empty: refutation ruled out even its true
        // placement, for reaching over another uncovered tile of this same
        // item that grouping put somewhere else. E.g. the split just above or
        // a wrong merge into an earlier group.
        //
        // A tile's raw placements can never be empty, so falling back to the
        // unrefuted set trades the refutation that just contradicted itself
        // for never leaving an item untracked.
        const [record] = item.uncovered;
        item.placements = consistentPlacements(tileRecords, record);
      }

      const total = item.placements.size;
      const share = 1 / total;
      let depthSum = 0;
      for (const covered of item.placements.values()) {
        for (const record of covered) {
          depthSum += record.tile.layerDepth;
          if (record.tile.layerDepth > 0) {
            item.covered.set(record, (item.covered.get(record) ?? 0) + share);
          }
        }
      }

      // the expectation over the per-tile odds is the mean of the
      // per-placement depths
      item.remainingDepth = depthSum / total;

      result.push(item);
    }

    return result;
  }

  function buildTileRecords(mine) {
    return Array.from({ length: mine.height }, (_, y) =>
      Array.from({ length: mine.width }, (_, x) => ({
        tile: mine.grid[mine.getGridIndexForCoordinate({ x, y })],
        x,
        y,
      })));
  }

  function averageItemTileCount(items) {
    const tiles = items.reduce((sum, item) => sum + item.space.flat().filter((cell) => cell === 1).length, 0);
    return tiles / items.length;
  }

  // How far a box reaches: it is placed by shifting it off one of the item's
  // tiles by up to half its width, so a tile this far from that one falls
  // inside on this many of the shifts.
  function boxReach(distance, range) {
    return Math.max(range - Math.abs(distance), 0) / range;
  }

  // How many of an item's tiles a box of this range is expected to cover, given
  // it is guaranteed to cover one of them. Summed over the item's own tiles from
  // each in turn, since which one the box was placed off is not visible.
  //
  // Rotation drops out: it swaps the two axes, which the box measures alike.
  function averageItemTilesInBox(state, range) {
    const { availableItems } = state;
    let total = 0;
    for (const item of availableItems) {
      const cells = getShapeVariants(item.id)[0];

      let covered = 0;
      for (const chosen of cells) {
        for (const cell of cells) {
          covered += boxReach(cell.x - chosen.x, range) * boxReach(cell.y - chosen.y, range);
        }
      }

      total += covered / cells.length;
    }

    return total / availableItems.length;
  }

  function collapseFrames(frames) {
    const tiles = new Map();
    for (const frame of frames) {
      for (const { coordinate: { x, y }, depth } of frame ?? []) {
        const key = `${x}:${y}`;
        const tile = tiles.get(key);
        if (!tile) {
          tiles.set(key, { x, y, depth });
        } else {
          tile.depth += depth;
        }
      }
    }

    return [...tiles.values()];
  }

  function trackDischargePatterns() {
    const unlocked = { patterns: [], totalWeight: 0 };

    for (const pattern of App.game.underground.battery.patterns) {
      ko.when(() => pattern.canAccess(), () => {
        unlocked.patterns.push({ weight: pattern.weight, tiles: collapseFrames(pattern.pattern) });
        unlocked.totalWeight += pattern.weight;
      });
    }

    return unlocked;
  }

  function createDigState(mine, tools, dischargePatterns) {
    const tileRecords = buildTileRecords(mine);
    const allTileRecords = tileRecords.flat();
    // how often an item spawns is not visible, so the spawn weights stay out
    // of this
    const availableItems = MineConfigs.find(mine.mineType).getAvailableItems();

    return {
      mine,
      tools,
      dischargePatterns,
      tileRecords,
      allTileRecords,
      availableItems,
      averageItemTileCount: averageItemTileCount(availableItems),
      // by box range, which changes only with the underground level
      itemTilesInBox: new Map(),
      items: [],
      surveyCenters: ko.pureComputed(() => allTileRecords.filter((record) => record.tile.survey > 0)),
      // per tile chance a survey box gives it of hiding that box's item
      surveyed: Array.from({ length: mine.height }, () => new Float64Array(mine.width)),
      // per tile room left over once every deduced item has staked its claim
      unclaimed: Array.from({ length: mine.height }, () => new Float64Array(mine.width)),
      // how much of an item one removed layer of this tile is worth
      weights: Array.from({ length: mine.height }, () => new Float64Array(mine.width)),
      rowWeights: Array.from({ length: mine.height }, () => new Float64Array(mine.width)),
    };
  }

  function refreshWeights(state) {
    const { mine, tileRecords, allTileRecords, averageItemTileCount, surveyed, unclaimed, weights } = state;
    const items = deduceItems(tileRecords, allTileRecords);
    state.items = items;

    for (const row of weights) {
      row.fill(0);
    }

    // Items are treated one at a time, so a tile that two of them could be
    // hiding under collects both their claims even though only one can be
    // true. The exact fix is to enumerate placements jointly for items whose
    // placement sets overlap, which is worth doing only if that turns out to
    // happen often.
    const claimed = new Map();
    for (const item of items) {
      for (const [record, probability] of item.covered) {
        weights[record.y][record.x] += probability / item.remainingDepth;
        claimed.set(record, (claimed.get(record) ?? 0) + probability);
      }
    }

    // whatever probability a tile has left over belongs to an item nobody has
    // seen yet
    const unseenItemCount = mine.itemsBuried - mine.itemsPartiallyFound;
    if (unseenItemCount === 0) {
      return;
    }

    for (const row of unclaimed) {
      row.fill(0);
    }

    let unclaimedTiles = 0;
    let unclaimedDepth = 0;
    for (const record of allTileRecords) {
      if (record.tile.layerDepth === 0) {
        continue;
      }

      const leftover = 1 - Math.min(claimed.get(record) ?? 0, 1);
      unclaimed[record.y][record.x] = leftover;
      unclaimedTiles += leftover;
      unclaimedDepth += leftover * record.tile.layerDepth;
    }

    if (unclaimedTiles === 0) {
      return;
    }

    // A tile near an edge really is less likely to hide an item than one in
    // the middle, since fewer placements can reach it. Spreading the unseen
    // items evenly like this ignores that. A coverage map computed from the
    // mine's dimensions and the shapes would price it, at the cost of another
    // pass.
    const unseenItemTiles = unseenItemCount * averageItemTileCount;
    const unseenProbability = Math.min(unseenItemTiles / unclaimedTiles, 1);
    const unseenRemainingDepth = averageItemTileCount * (unclaimedDepth / unclaimedTiles);
    for (const record of allTileRecords) {
      if (record.tile.layerDepth === 0) {
        continue;
      }

      // A survey box and the unseen estimate are two readings of the same
      // thing. Use the stronger one rather than using both.
      const probability = Math.max(unseenProbability, surveyed[record.y][record.x]);
      weights[record.y][record.x] += unclaimed[record.y][record.x] * probability / unseenRemainingDepth;
    }
  }

  function rebuildSurveyedTiles(state, centers) {
    const { mine, surveyed, itemTilesInBox } = state;
    for (const row of surveyed) {
      row.fill(0);
    }

    const maxX = mine.width - 1;
    const maxY = mine.height - 1;
    for (const record of centers) {
      // A survey marks its center tile with the range of the box drawn around
      // it, which is exactly the area highlighted for the player. The box is
      // placed off one tile of an item, so it holds that one and however many
      // of the item's others it happens to reach, spread over its own area.
      const range = record.tile.survey;
      if (!itemTilesInBox.has(range)) {
        itemTilesInBox.set(range, averageItemTilesInBox(state, range));
      }

      const probability = itemTilesInBox.get(range) / (range * range);
      const reach = Math.floor(range / 2);
      const fromX = Math.max(record.x - reach, 0);
      const toX = Math.min(record.x + reach, maxX);
      const toY = Math.min(record.y + reach, maxY);
      for (let y = Math.max(record.y - reach, 0); y <= toY; y++) {
        const row = surveyed[y];
        for (let x = fromX; x <= toX; x++) {
          // Two boxes can point at the same item but this is not visible to
          // the user. So the stronger box stands rather than the two being
          // added as independent promises.
          row[x] = Math.max(row[x], probability);
        }
      }
    }
  }

  function trySurvey(state) {
    const { mine, tools } = state;
    if (!tools.survey.canUseTool()) {
      return false;
    }

    if (mine.itemsPartiallyFound >= mine.itemsBuried) {
      // not because survey has no value when all items are partially found,
      // but because `refreshWeights` never utilize in that case
      return false;
    }

    App.game.underground.tools.useTool(tools.survey.id, 0, 0);
    return true;
  }

  function batteryCandidate(state) {
    const { tileRecords, weights, dischargePatterns } = state;
    const { battery } = App.game.underground;
    if (!battery.canDischarge()) {
      return null;
    }

    let total = 0;
    for (const { weight, tiles } of dischargePatterns.patterns) {
      let value = 0;
      for (const { x, y, depth } of tiles) {
        value += weights[y][x] * Math.min(tileRecords[y][x].tile.layerDepth, depth);
      }

      total += weight * value;
    }

    return {
      value: total / dischargePatterns.totalWeight,
      use: () => battery.discharge(),
    };
  }

  // The chance one bomb clears every tile of `needs` at once, each wanting
  // that many throws. A throw lands on any tile of the mine, repeats included,
  // so the first tile's share is binomial and the rest split what it leaves
  // over one tile fewer.
  //
  // Tile and throws left is the whole state, so each pair is worked out once
  // as the ways to split the throws are walked.
  function clearanceChance(needs, throws, mineTileCount) {
    const stride = throws + 1;
    const known = new Float64Array(needs.length * stride).fill(NaN);

    function clearanceFrom(index, throwsLeft) {
      if (index === needs.length) {
        return 1;
      }

      const key = index * stride + throwsLeft;
      if (!Number.isNaN(known[key])) {
        return known[key];
      }

      const p = 1 / (mineTileCount - index);
      let chance = 0;
      let exactly = Math.pow(1 - p, throwsLeft); // exactly none of them landing here
      for (let taken = 0; taken <= throwsLeft; taken++) {
        if (taken >= needs[index]) {
          chance += exactly * clearanceFrom(index + 1, throwsLeft - taken);
        }

        exactly *= (throwsLeft - taken) / (taken + 1) * p / (1 - p);
      }

      known[key] = chance;
      return chance;
    }

    return clearanceFrom(0, throws);
  }

  // An item is only finished off when one of its placements is cleared outright,
  // so the chance of that is averaged over the placements still standing.
  function completionChance(item, bombTiles, mineTileCount) {
    let total = 0;
    for (const covered of item.placements.values()) {
      const needs = [];
      for (const record of covered) {
        const { layerDepth } = record.tile;
        if (layerDepth > 0) {
          needs.push(Math.ceil(layerDepth / ToolStrength.BOMB));
        }
      }

      total += clearanceChance(needs, bombTiles, mineTileCount);
    }

    return total / item.placements.size;
  }

  function bombCandidate(state) {
    const { mine, tools, items, allTileRecords, weights } = state;
    // the other tools are preferable when every item is seen, so early return
    // to avoid extra work
    if (mine.itemsPartiallyFound >= mine.itemsBuried || !tools.bomb.canUseTool()) {
      return null;
    }

    // It lands where it likes, so its worth is what an average tile is worth,
    // over as many tiles as it breaks.
    let total = 0;
    for (const record of allTileRecords) {
      total += weights[record.y][record.x] * Math.min(record.tile.layerDepth, ToolStrength.BOMB);
    }

    const bombTiles = bombTileCount();

    // It can destroy items, so that is priced in rather than guarded against.
    // An item nobody has seen would need its whole shape hit at once, which is
    // too unlikely to be worth counting.
    let destroyed = 0;
    for (const item of items) {
      destroyed += completionChance(item, bombTiles, allTileRecords.length);
    }

    const value = bombTiles * total / allTileRecords.length - tools.bomb.itemDestroyChance * destroyed;
    if (value <= 0) {
      return null; // only use it when the expected value is positive
    }

    return {
      value,
      use: () => App.game.underground.tools.useTool(tools.bomb.id, 0, 0),
    };
  }

  function hammerCandidate(state) {
    const { mine, tools, tileRecords, weights, rowWeights } = state;
    if (!tools.hammer.canUseTool()) {
      return null;
    }

    const { width, height } = mine;

    // A 3x3 sum is separable: summing each row of three first and then adding
    // three of those together costs 4 additions per tile instead of 8.
    for (let y = 0; y < height; y++) {
      const row = weights[y];
      const records = tileRecords[y];
      const sums = rowWeights[y];
      const value = (x) => row[x] * Math.min(records[x].tile.layerDepth, ToolStrength.HAMMER);

      let left = value(0);
      let middle = value(1);
      for (let x = 1; x < width - 1; x++) {
        const right = value(x + 1);
        sums[x] = left + middle + right;
        left = middle;
        middle = right;
      }
    }

    let bestValue = 0;
    let bestRecord = null;
    for (let y = 1; y < height - 1; y++) {
      const above = rowWeights[y - 1];
      const middle = rowWeights[y];
      const below = rowWeights[y + 1];
      const records = tileRecords[y];
      for (let x = 1; x < width - 1; x++) {
        const value = above[x] + middle[x] + below[x];
        if (value > bestValue) {
          bestValue = value;
          bestRecord = records[x];
        }
      }
    }

    if (!bestRecord) {
      console.error("underground: the hammer has nothing to break, digging should have stopped when the mine completed");
      return null;
    }

    return {
      value: bestValue,
      use: () => App.game.underground.tools.useTool(tools.hammer.id, bestRecord.x, bestRecord.y),
    };
  }

  // Uniform pick among the tiles tied for the most item per use. Reservoir
  // sampling keeps this to a single pass without collecting the pool.
  function pickTileToChisel(allTileRecords, weights) {
    let bestValue = 0;
    let tieCount = 0;
    let best = null;

    for (const record of allTileRecords) {
      const { layerDepth } = record.tile;
      if (layerDepth === 0) {
        continue;
      }

      const value = weights[record.y][record.x] * Math.min(layerDepth, ToolStrength.CHISEL);
      if (value < bestValue) {
        continue;
      }

      if (value > bestValue) {
        bestValue = value;
        tieCount = 1;
        best = record;
        continue;
      }

      tieCount += 1;
      if (Rand.floor(tieCount) === 0) {
        best = record;
      }
    }

    return best;
  }

  function chiselCandidate(state) {
    const { tools, allTileRecords, weights } = state;
    if (!tools.chisel.canUseTool()) {
      return null;
    }

    const record = pickTileToChisel(allTileRecords, weights);
    if (!record) {
      console.error("underground: the chisel has nothing to dig, digging should have stopped when the mine completed");
      return null;
    }

    return {
      value: weights[record.y][record.x] * Math.min(record.tile.layerDepth, ToolStrength.CHISEL),
      use: () => App.game.underground.tools.useTool(tools.chisel.id, record.x, record.y),
    };
  }

  function tryDig(state) {
    let best = { value: 0 };
    for (const candidate of [batteryCandidate(state), bombCandidate(state), hammerCandidate(state), chiselCandidate(state)]) {
      if (candidate && candidate.value > best.value) {
        best = candidate;
      }
    }

    if (best.value === 0) {
      return false;
    }

    best.use();
    return true;
  }

  // The survey digs nothing, but it does spend the tick. It pays in information
  // about later digs, which does not convert into what a dig is worth, so it
  // goes first for want of a common unit.
  const digStrategies = [trySurvey, tryDig];

  function digOnce(state) {
    // Read from the mine each tick because with `deferUpdates` on, anything
    // cached through a subscription lags the digs made in this same tick.
    refreshWeights(state);

    for (const strategy of digStrategies) {
      if (strategy(state)) {
        return;
      }
    }
  }

  function digMine(mine, tools, dischargePatterns) {
    const state = createDigState(mine, tools, dischargePatterns);
    const digTick = ko.pureComputed(() => {
      return Math.floor(App.game.statistics.secondsPlayed() / DIG_INTERVAL_SECONDS);
    });
    const digSubscription = digTick.subscribe(() => digOnce(state));

    return [
      _runAndSubscribe(state.surveyCenters, (centers) => rebuildSurveyedTiles(state, centers)),
      digSubscription,
      ko.when(() => mine.completed, () => digSubscription.dispose()), // in case `Settings.getSetting('autoRestartUndergroundMine')` is false
    ];
  }

  function dig() {
    const tools = {
      chisel: App.game.underground.tools.getTool(UndergroundToolType.Chisel),
      hammer: App.game.underground.tools.getTool(UndergroundToolType.Hammer),
      bomb: App.game.underground.tools.getTool(UndergroundToolType.Bomb),
      survey: App.game.underground.tools.getTool(UndergroundToolType.Survey),
    };
    const dischargePatterns = trackDischargePatterns();
    const mineObservable = App.game.underground._mine;
    const subscriptions = [];

    _whenReady(mineObservable, () => {
      _disposeAll(subscriptions);

      const mine = mineObservable();
      subscriptions.push(ko.when(() => mine.timeUntilDiscovery <= 0, () => {
        subscriptions.push(...digMine(mine, tools, dischargePatterns));
      }));
    });
  }

  function flattenQuest(quest) {
    return quest instanceof MultipleQuestsQuest ? quest.quests : [quest];
  }

  function getRemainingQuestAmount(quest) {
    return Math.max(0, quest.amount - (quest.focus() - quest.initial()));
  }

  function sellGemPlates() {
    const gemPlates = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Gem);
    const activeGemQuests = ko.pureComputed(() => {
      const questLineQuests = App.game.quests.questLines()
        .filter((questLine) => questLine.state() === QuestLineState.started)
        .flatMap((questLine) => flattenQuest(questLine.curQuestObject()));

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
          .reduce((maximum, quest) => Math.max(maximum, getRemainingQuestAmount(quest)), 0);
        const availablePlates = player.itemList[gemPlate.itemName]();

        return Math.min(Math.ceil(gemsRemaining / gemPlate.value), availablePlates);
      });

      _whenReady(
        ko.pureComputed(() => amountToSell() > 0),
        () => UndergroundController.sellMineItem(gemPlate, amountToSell()),
      );
    }
  }

  function sellUndergroundTreasures() {
    const treasures = UndergroundItems.list.filter((item) => item.valueType === UndergroundItemValueType.Diamond);
    const treasuresToSell = treasures.filter((treasure) => ItemList[treasure.itemName].basePrice === Infinity); // exclude Everstone
    for (const treasure of treasuresToSell) {
      const canSell = ko.pureComputed(() => treasure.isUnlocked() && !treasure.sellLocked() && player.itemList[treasure.itemName]() > 0);
      _whenReady(canSell, () => UndergroundTrading.quickSell(treasure));
    }
  }

  function sellTreasures() {
    sellGemPlates();
    sellUndergroundTreasures();
  }

  function automate() {
    dig();
    sellTreasures();
  }

  return function automateUnderground() {
    ko.when(() => App.game.underground.canAccess(), automate);
  };
})();
