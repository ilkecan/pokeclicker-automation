"use strict";

const safari = (() => {
  const SETTINGS_SECTION = "safari";
  const OPTION_NAMES = Object.freeze([
    "berryReserve",
    "collectVisibleItems",
    "followRarerVisiblePokemon",
    "followVisiblePokemon",
  ]);
  const SAFARI_MODAL = $("#safariModal");
  const SAFARI_BATTLE_MODAL = $("#safariBattleModal");
  const DIRECTIONS = [
    { x: 0, y: -1, name: "up" },
    { x: 1, y: 0, name: "right" },
    { x: 0, y: 1, name: "down" },
    { x: -1, y: 0, name: "left" },
  ];
  const ActionType = Object.freeze({
    MOVE: "move",
    RUN: "run",
    THROW_BAIT: "throwBait",
    THROW_BALL: "throwBall",
    THROW_ROCK: "throwRock",
  });
  const ROCK_DURATIONS = Object.freeze([2, 3, 4, 5, 6]); // SafariBattle.throwRock
  const BAIT_DURATIONS = Object.freeze([2, 3, 4, 5, 6]); // BaitList.Bait
  const BERRY_DURATIONS = Object.freeze([2, 3, 4, 5, 6, 7]); // BaitList.Razz/Nanab
  const BERRIES = Object.freeze([
    { inventoryType: BerryType.Razz, bait: BaitType.Razz },
    { inventoryType: BerryType.Nanab, bait: BaitType.Nanab },
  ]);

  function createGrid(height, width, value) {
    return Array.from({ length: height }, () => Array(width).fill(value));
  }

  function createState(grid) {
    const height = grid.length;
    const width = grid[0].length;
    const region = Safari.activeRegion();
    const weights = createWeights(region);
    const chances = calculateChances(grid, weights, region);
    const environments = calculateEnvironments(grid);
    return {
      grid,
      width,
      height,
      position: { x: 0, y: 0 },
      inBattle: false,
      busy: false,
      balls: 0,
      enemy: null,
      options: {
        berryReserve: 0,
        collectVisibleItems: false,
        followRarerVisiblePokemon: false,
        followVisiblePokemon: false,
      },
      pokemons: [],
      items: [],
      distances: createGrid(height, width, Infinity),
      predecessors: createGrid(height, width, null),
      weights,
      region,
      chances,
      environments,
      environmentWork: calculateEnvironmentWork(chances, region, environments),
      medianChance: calculateMedianChance(chances, region),
    };
  }

  function isLegalTile(state, x, y) {
    return _and([
      x < state.width,
      x >= 0,
      y < state.height,
      y >= 0,
    ]) && GameConstants.SAFARI_LEGAL_WALK_BLOCKS.includes(state.grid[y][x]);
  }

  function buildRoute(state) {
    for (let y = 0; y < state.height; y++) {
      state.distances[y].fill(Infinity);
      state.predecessors[y].fill(null);
    }

    const queue = [];
    let queueHead = 0;
    const start = { ...state.position };

    state.distances[start.y][start.x] = 0;
    queue.push(start);
    while (queueHead < queue.length) {
      const current = queue[queueHead++];
      const nextDistance = state.distances[current.y][current.x] + 1;

      for (const direction of DIRECTIONS) {
        const nextX = current.x + direction.x;
        const nextY = current.y + direction.y;
        if (!isLegalTile(state, nextX, nextY)) {
          continue;
        }

        if (state.distances[nextY][nextX] !== Infinity) {
          // already discovered
          continue;
        }

        state.distances[nextY][nextX] = nextDistance;
        state.predecessors[nextY][nextX] = current;
        queue.push({ x: nextX, y: nextY });
      }
    }
  }

  function firstMove(state, target) {
    const start = { ...state.position };
    let current = target;
    let predecessor = state.predecessors[current.y][current.x];
    while (predecessor.x !== start.x || predecessor.y !== start.y) {
      current = predecessor;
      predecessor = state.predecessors[current.y][current.x];
    }

    const dx = current.x - start.x;
    const dy = current.y - start.y;
    const direction = DIRECTIONS.find((candidate) => candidate.x === dx && candidate.y === dy);
    return direction.name;
  }

  function createWeights(region) {
    const encounters = SafariPokemonList.list[region]();
    const weights = { grass: new Map(), water: new Map() };
    const totals = { grass: 0, water: 0 };

    for (const encounter of encounters) {
      if (!encounter.isAvailable()) {
        continue;
      }

      for (const environment of encounter.environments) {
        let key;
        switch (environment) {
          case SafariEnvironments.Grass:
            key = "grass";
            break;
          case SafariEnvironments.Water:
            key = "water";
            break;
          default:
            console.error("[pokeclicker-automation] safari: unknown encounter environment", environment);
            continue;
        }
        weights[key].set(encounter.name, encounter.weight);
        totals[key] += encounter.weight;
      }
    }

    for (const [key, values] of Object.entries(weights)) {
      for (const [name, weight] of values) {
        values.set(name, weight / totals[key]);
      }
    }

    return weights;
  }

  function updateState(state) {
    const previousInBattle = state.inBattle;

    const point = Safari.playerXY;
    state.position.x = point.x;
    state.position.y = point.y;
    state.inBattle = Safari.inBattle();
    state.busy = SafariBattle.busy();
    state.balls = Safari.balls();
    state.enemy = SafariBattle.enemy;
    for (const name of OPTION_NAMES) {
      state.options[name] = AutomationSettings.getValue(SETTINGS_SECTION, name);
    }
    state.pokemons = Safari.pokemonGrid();
    state.items = Safari.itemGrid();

    if (previousInBattle && !state.inBattle) {
      state.medianChance = calculateMedianChance(state.chances, state.region);
      state.environmentWork = calculateEnvironmentWork(state.chances, state.region, state.environments);
    }

    buildRoute(state);
  }

  function distanceTo(state, target) {
    return state.distances[target.y][target.x];
  }

  function probability(pool, pokemon) {
    return pool.get(pokemon.name) ?? 0;
  }

  function effectiveProbability(state, pokemon) {
    const speciesProbability = Object.values(state.weights).reduce((maximum, pool) => Math.max(maximum, probability(pool, pokemon)), 0);
    const chanceArgument = GameConstants.SHINY_CHANCE_SAFARI / App.game.multiplier.getBonus("shiny");
    const shinyProbability = chanceArgument >= 1 ? 1 / chanceArgument : chanceArgument;
    return speciesProbability * (pokemon.shiny ? shinyProbability : 1 - shinyProbability);
  }

  function bestCandidate(candidates, compare) {
    let best = { target: null, distance: Infinity, probability: Infinity };
    for (const candidate of candidates) {
      if (compare(candidate, best) < 0) {
        best = candidate;
      }
    }
    return best.target;
  }

  function compareDistance(candidate, best) {
    return candidate.distance - best.distance;
  }

  function comparePokemon(candidate, best) {
    if (candidate.probability !== best.probability) {
      return candidate.probability - best.probability;
    }

    return candidate.distance - best.distance;
  }

  function compareEncounterTile(candidate, best) {
    if (best.target === null) {
      return -1;
    }

    if (candidate.work !== best.work) {
      return best.work - candidate.work;
    }

    return compareDistance(candidate, best);
  }

  function* pokemonCandidates(state) {
    const { chances, medianChance, options, pokemons } = state;

    for (const pokemon of pokemons) {
      if (!_shouldCatchPokemon(pokemon)) {
        continue;
      }

      if (options.followRarerVisiblePokemon) {
        if (chances.get(pokemon.name) >= medianChance) {
          continue;
        }
      }

      const distance = distanceTo(state, pokemon);
      if (!Number.isFinite(distance)) {
        // unreachable target
        continue;
      }

      yield {
        target: pokemon,
        distance,
        probability: effectiveProbability(state, pokemon),
      };
    }
  }

  function bestPokemon(state) {
    return bestCandidate(pokemonCandidates(state), comparePokemon);
  }

  function* itemCandidates(state) {
    for (const target of state.items) {
      const distance = distanceTo(state, target);
      if (!Number.isFinite(distance)) {
        // unreachable target
        continue;
      }

      yield { target, distance };
    }
  }

  function bestItem(state) {
    return bestCandidate(itemCandidates(state), compareDistance);
  }

  function encounterEnvironment(tile) {
    if (tile === GameConstants.SafariTile.grass) {
      return SafariEnvironments.Grass;
    }

    if (GameConstants.SAFARI_WATER_BLOCKS.includes(tile)) {
      return SafariEnvironments.Water;
    }

    return null;
  }

  function calculateEnvironments(grid) {
    const environments = new Set();
    for (const row of grid) {
      for (const tile of row) {
        const environment = encounterEnvironment(tile);
        if (environment === null) {
          continue;
        }

        environments.add(environment);
      }
    }
    return environments;
  }

  function createEnemy(name) {
    return {
      name,
      baseCatchFactor: PokemonHelper.getPokemonByName(name).catchRate / 6,
      baseEscapeFactor: 30,
      levelModifier: (Safari.safariLevel() - 1) / 50,
    };
  }

  function calculateEnvironmentWork(chances, region, environments) {
    const work = new Map();
    for (const environment of environments) {
      work.set(environment, 0);
    }

    const battleState = { chances, enemy: null };
    for (const encounter of SafariPokemonList.list[region]()) {
      if (!encounter.isAvailable() || !encounter.environments.some((environment) => work.has(environment))) {
        continue;
      }

      let evs;
      const pokemon = App.game.party.getPokemonByName(encounter.name);
      if (pokemon) {
        if (pokemon.pokerus !== GameConstants.Pokerus.Contagious) {
          continue;
        }

        evs = pokemon.calculateEVs();
      } else {
        const power = App.game.challenges.list.slowEVs.active.peek() ? GameConstants.EP_CHALLENGE_MODIFIER : 1;
        evs = -1 / power;
      }
      battleState.enemy = createEnemy(encounter.name);
      const remainingWork = battleWeight(battleState, 50 - evs);
      for (const environment of encounter.environments) {
        if (work.has(environment)) {
          work.set(environment, work.get(environment) + remainingWork);
        }
      }
    }
    return work;
  }

  function* encounterTileCandidates(state) {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.grid[y].length; x++) {
        if (x === state.position.x && y === state.position.y) {
          // current position is not a target candidate
          continue;
        }

        const environment = encounterEnvironment(state.grid[y][x]);
        if (environment === null) {
          continue;
        }

        const target = { x, y };
        const distance = distanceTo(state, target);
        if (!Number.isFinite(distance)) {
          // unreachable target
          continue;
        }

        yield { target, distance, work: state.environmentWork.get(environment) };
      }
    }
  }

  function bestEncounterTile(state) {
    return bestCandidate(encounterTileCandidates(state), compareEncounterTile);
  }

  function chooseTarget(state) {
    if (state.options.collectVisibleItems) {
      const item = bestItem(state);
      if (item) {
        return item;
      }
    }

    if (state.options.followVisiblePokemon) {
      const pokemon = bestPokemon(state);
      if (pokemon) {
        return pokemon;
      }
    }

    const tile = bestEncounterTile(state);
    if (tile) {
      return tile;
    }

    console.error("[pokeclicker-automation] safari: no reachable target");
  }

  // Magic number pinned by sensitivity tests, not derived from step time.
  // Lower makes commons take berries, higher makes rares skip setups.
  const BATTLE_TURN_COST = 1;

  function readBerryAmount(type) {
    return App.game.farming.berryInventory[type]();
  }

  function createBattleState(state) {
    const enemy = state.enemy;
    return {
      balls: state.balls,
      angry: enemy.angry,
      eating: enemy.eating,
      eatingBait: enemy.eatingBait,
    };
  }

  // SafariPokemon.catchFactor (SafariPokemon.ts)
  function catchProbability(enemy, angry, eating, bait) {
    const { levelModifier } = enemy;
    const oakBonus = App.game.oakItems.calculateBonus(OakItemType.Magic_Ball);
    let factor = enemy.baseCatchFactor + oakBonus + levelModifier * 10;
    if (eating > 0) {
      factor /= 2 - levelModifier;
    }
    if (angry > 0) {
      factor *= 2 + levelModifier;
    }
    if (bait === BaitType.Razz) {
      // Razz persists for the rest of the encounter, independent of eating status
      factor *= 1.5 + levelModifier;
    }
    return Math.min(1, Math.max(0, factor / 100));
  }

  // SafariPokemon.escapeFactor (SafariPokemon.ts)
  function escapeProbability(enemy, angry, eating, bait) {
    const { levelModifier } = enemy;
    let factor = enemy.baseEscapeFactor;
    if (eating > 0) {
      factor /= 4 + levelModifier;
    }
    if (angry > 0) {
      factor *= 2 - levelModifier;
    }
    if (bait === BaitType.Nanab) {
      // Nanab persists for the rest of the encounter, independent of eating status
      factor /= 1.5 + levelModifier;
    }
    return Math.min(1, Math.max(0, factor / 100));
  }

  function ballContinuation(enemy, battle) {
    // Ball-only chain to absorption: exact eventual-catch value of throwing balls
    // every turn from here; no choices remain, statuses decay deterministically.
    let value = 0;
    let turns = 0;
    let survival = 1;
    for (let turn = 0; turn < battle.balls; turn++) {
      const angry = Math.max(0, battle.angry - turn);
      const eating = Math.max(0, battle.eating - turn);
      const catchChance = catchProbability(enemy, angry, eating, battle.eatingBait);
      const escapeChance = escapeProbability(enemy, angry, eating, battle.eatingBait);
      turns += survival;
      value += survival * catchChance;
      survival *= (1 - catchChance) * (1 - escapeChance);
      // remaining turns cannot change the decision
      if (survival < 1e-15) {
        break;
      }
    }
    return { value, turns };
  }

  function baitDurations(bait) {
    return bait === BaitType.Bait ? BAIT_DURATIONS : BERRY_DURATIONS;
  }

  function moveValue(enemy, battle, durations, setup) {
    let totalValue = 0;
    let totalTurns = 0;

    for (const duration of durations) {
      const { angry, eating, eatingBait } = setup(duration);
      const survive = 1 - escapeProbability(enemy, angry, eating, eatingBait);
      const continuation = ballContinuation(enemy, {
        ...battle,
        angry: Math.max(0, angry - 1),
        eating: Math.max(0, eating - 1),
        eatingBait,
      });
      totalValue += survive * continuation.value;
      totalTurns += survive * continuation.turns;
    }

    const value = totalValue / durations.length;
    // setup turn always happens
    const turns = 1 + totalTurns / durations.length;
    return { value, turns };
  }

  function rockValue(enemy, battle) {
    // Rock costs no ball, refresh angry, clear eating and preserve the berry slot.
    return moveValue(enemy, battle, ROCK_DURATIONS, (duration) => ({
      angry: Math.max(battle.angry, duration),
      eating: 0,
      eatingBait: battle.eatingBait,
    }));
  }

  function baitValue(enemy, battle, bait) {
    // Bait costs no ball, clear angry, refresh eating and replace the berry slot.
    return moveValue(enemy, battle, baitDurations(bait), (duration) => ({
      angry: 0,
      eating: Math.max(battle.eating, duration),
      eatingBait: bait,
    }));
  }

  function battleActionCandidates(state) {
    const { enemy } = state;
    const candidates = [
      { type: ActionType.THROW_BAIT, bait: BaitType.Bait },
      { type: ActionType.THROW_BALL },
      { type: ActionType.THROW_ROCK },
    ];
    for (const { inventoryType, bait } of BERRIES) {
      const amount = readBerryAmount(inventoryType);
      if (amount > state.options.berryReserve || (enemy.shiny && amount > 0)) {
        candidates.push({ type: ActionType.THROW_BAIT, bait });
      }
    }
    return candidates;
  }

  function actionScore(enemy, battle, action) {
    switch (action.type) {
      case ActionType.THROW_BAIT:
        return baitValue(enemy, battle, action.bait);
      case ActionType.THROW_BALL:
        return ballContinuation(enemy, battle);
      case ActionType.THROW_ROCK:
        return rockValue(enemy, battle);
    }
  }

  function progressValue(enemy) {
    const pokemon = App.game.party.getPokemonByName(enemy.name);
    // initial catch
    if (!pokemon) {
      return 1;
    }

    if (pokemon.pokerus !== GameConstants.Pokerus.Contagious) {
      // either uninfected, infected (still in hatchery) or already resisted
      return 0;
    }

    // gain EV for contagious pokemon
    return 1;
  }

  // How many background encounters this fight is worth.
  function battleWeight(state, progress) {
    // Plain encounter chance, fixed for the session.
    const chance = state.chances.get(state.enemy.name);
    // Neutral eventual catch over 30 balls, using live enemy base factors.
    const baseline = ballContinuation(state.enemy, { balls: 30, angry: 0, eating: 0, eatingBait: BaitType.Bait }).value;
    return progress / (chance * baseline);
  }

  // Counts visible-spawn pool surfaces. Tile kinds map many-to-one onto
  // environments (Safari.getEnvironmentTile). Occupancy and accessibility are
  // ignored on purpose.
  function tileCounts(grid) {
    const counts = { water: 0, grass: 0 };
    for (const row of grid) {
      for (const tile of row) {
        if (GameConstants.SAFARI_WATER_BLOCKS.includes(tile)) {
          counts.water++;
        } else if (GameConstants.SAFARI_LEGAL_WALK_BLOCKS.includes(tile)) {
          // every walkable non-water tile counts for the grass pool
          counts.grass++;
        }
      }
    }
    return counts;
  }

  // Potential score per species:
  // randomRate * max(terrainChance) + visibleRate * sum(placementFraction * terrainChance).
  //
  // NormalizeD across listed species. Random availability ignores terrain area.
  // Visible availability assumes successful placement and harvest.
  function encounterChances(terrains, randomRate, visibleRate) {
    const rates = new Map();
    const bestTerrainChances = new Map();
    for (const { terrainChances, placementFraction } of terrains) {
      for (const [name, terrainChance] of terrainChances) {
        if (terrainChance > (bestTerrainChances.get(name) ?? 0)) {
          bestTerrainChances.set(name, terrainChance);
        }
        const rate = visibleRate * placementFraction * terrainChance;
        rates.set(name, (rates.get(name) ?? 0) + rate);
      }
    }

    for (const [name, rate] of rates) {
      rates.set(name, rate + randomRate * (bestTerrainChances.get(name) ?? 0));
    }

    const total = rates.values().reduce((sum, rate) => sum + rate, 0);
    for (const [name, rate] of rates) {
      rates.set(name, rate / total);
    }
    return rates;
  }

  function calculateMedianChance(chances, region) {
    const unfinished = new Set();
    for (const encounter of SafariPokemonList.list[region]()) {
      if (encounter.isAvailable() && _shouldCatchPokemon(encounter)) {
        unfinished.add(encounter.name);
      }
    }

    const values = Array.from(unfinished).map((name) => chances.get(name)).sort((a, b) => a - b);

    if (values.length === 0) {
      return null;
    }

    const middle = Math.floor(values.length / 2);
    if (values.length % 2) {
      return values[middle];
    }

    return (values[middle - 1] + values[middle]) / 2;
  }

  // One random roll per eligible step without a visible collision.
  // `checkBattle` rolls on arrival and again only while walking. But the bot
  // calls stop after every move (`executeAction`), draining the queue.
  function randomEncounterRate(region) {
    // SeededRand.chance(n > 1) is 1-in-n, not percent.
    let chance;
    switch (region) {
      case GameConstants.Region.alola:
        chance = GameConstants.SAFARI_MJ_BATTLE_CHANCE;
        break;
      default:
        chance = GameConstants.SAFARI_BATTLE_CHANCE;
        break;
    }
    return 1 / chance;
  }

  function calculateTerrains(grid, weights) {
    const counts = tileCounts(grid);
    const placeable = counts.grass + counts.water;
    return [
      {
        terrainChances: weights.grass,
        placementFraction: counts.grass / placeable,
      },
      {
        terrainChances: weights.water,
        placementFraction: counts.water / placeable,
      },
    ];
  }

  function calculateChances(grid, weights, region) {
    const terrains = calculateTerrains(grid, weights);
    const randomRate = randomEncounterRate(region);
    // spawnPokemonCheck: every 10th step coin flip
    const visibleRate = 0.5 / 10;

    return encounterChances(terrains, randomRate, visibleRate);
  }

  function chooseBattleAction(state) {
    const { enemy } = state;
    let turnCost;
    let weight;
    if (enemy.shiny) {
      // always catch-max shinies, since catching them has value
      // (quest/achievement) apart from the EV gain
      turnCost = 0;
      weight = 1;
    } else {
      const progress = progressValue(enemy);
      if (progress === 0) {
        return { type: ActionType.RUN };
      }

      turnCost = BATTLE_TURN_COST;
      weight = battleWeight(state, progress);
    }

    const battle = createBattleState(state);
    let bestAction = null;
    let bestScore = -Infinity;
    let bestTurns = Infinity;

    // Try each first action once, then balls to the end; re-decide every turn (one-ply).
    for (const action of battleActionCandidates(state)) {
      const { value, turns } = actionScore(enemy, battle, action);
      const score = weight * value - turnCost * turns;
      if (score > bestScore || (score === bestScore && turns < bestTurns)) {
        bestAction = action;
        bestScore = score;
        bestTurns = turns;
      }
    }
    return bestAction;
  }

  function chooseAction(state) {
    if (state.inBattle && !state.busy && state.enemy) {
      return chooseBattleAction(state);
    }

    const target = chooseTarget(state);
    return { type: ActionType.MOVE, direction: firstMove(state, target) };
  }

  function selectBait(type) {
    switch (type) {
      case BaitType.Razz:
        return BaitList.Razz;
      case BaitType.Nanab:
        return BaitList.Nanab;
      default:
        return BaitList.Bait;
    }
  }

  function executeAction(action) {
    switch (action.type) {
      case ActionType.MOVE:
        Safari.move(action.direction);
        Safari.stop(action.direction);
        break;
      case ActionType.RUN:
        SafariBattle.run();
        break;
      case ActionType.THROW_BAIT:
        SafariBattle.selectedBait(selectBait(action.bait));
        SafariBattle.throwBait();
        break;
      case ActionType.THROW_BALL:
        SafariBattle.throwBall();
        break;
      case ActionType.THROW_ROCK:
        SafariBattle.throwRock();
        break;
    }
  }

  function scheduleNextAction(session, action) {
    switch (action.type) {
      case ActionType.MOVE:
        // re-evaluate after the movement is expected to finish
        scheduleAction(session, runAction, Safari.moveSpeed);
        break;
      case ActionType.RUN:
      case ActionType.THROW_BAIT:
      case ActionType.THROW_BALL:
      case ActionType.THROW_ROCK:
        break;
    }
  }

  function createSession(map) {
    const session = {
      state: createState(map),
      timer: null,
    };
    return session;
  }

  function clearSessionTimer(session) {
    clearTimeout(session.timer);
    session.timer = null;
  }

  function scheduleAction(session, action, delay) {
    // coalesce pending wake-ups
    clearSessionTimer(session);

    session.timer = setTimeout(() => {
      session.timer = null;
      action(session);
    }, delay);
  }

  function isSafariModalOpen() {
    return SAFARI_MODAL.hasClass("show");
  }

  function isSafariBattleModalOpen() {
    return SAFARI_BATTLE_MODAL.hasClass("show");
  }

  function wake(session) {
    // defer and coalesce wake-ups.
    scheduleAction(session, runAction, 0);
  }

  function runAction(session) {
    if (_or([
      !Safari.inProgress(),
      !isSafariModalOpen(),
      Safari.balls() <= 0,
    ])) {
      return;
    }

    if (Safari.inBattle()) {
      if (!isSafariBattleModalOpen()) {
        // battle modal is still opening
        return;
      }

      if (SafariBattle.busy()) {
        // battle action is still processing
        return;
      }
    }

    if (Safari.isMoving) {
      scheduleAction(session, runAction, 25);
      return;
    }

    updateState(session.state);
    const action = chooseAction(session.state);
    executeAction(action);
    scheduleNextAction(session, action);
  }

  function runSession(map) {
    const session = createSession(map);
    const battleShown = () => wake(session);
    SAFARI_BATTLE_MODAL.on("shown.bs.modal", battleShown);

    const inBattleSubscription = Safari.inBattle.subscribe((inBattle) => {
      if (!inBattle) {
        wake(session);
      }
    });

    const busySubscription = SafariBattle.busy.subscribe((busy) => {
      if (!busy && Safari.inBattle()) {
        wake(session);
      }
    });

    const pokemonGridSubscription = Safari.pokemonGrid.subscribe(() => wake(session));
    const itemGridSubscription = Safari.itemGrid.subscribe(() => wake(session));

    const optionSubscriptions = OPTION_NAMES.map((name) => {
      const option = AutomationSettings.value(SETTINGS_SECTION, name);
      return option.subscribe(() => wake(session));
    });

    wake(session);

    const disposeSession = {
      dispose() {
        clearSessionTimer(session);
        SAFARI_BATTLE_MODAL.off("shown.bs.modal", battleShown);
      }
    }

    return [
      busySubscription,
      disposeSession,
      inBattleSubscription,
      itemGridSubscription,
      pokemonGridSubscription,
      ...optionSubscriptions,
    ];
  }

  function runSafari() {
    const modalOpen = ko.observable(isSafariModalOpen());
    const shouldRun = ko.pureComputed(() => _and([
      Safari.inProgress(),
      modalOpen(),
    ]));

    const onShown = () => modalOpen(true);
    const onHide = () => modalOpen(false);
    SAFARI_MODAL.on("shown.bs.modal", onShown);
    SAFARI_MODAL.on("hide.bs.modal", onHide);

    let subscriptions = [];
    const subscription = _runAndSubscribe(shouldRun, (ready) => {
      if (ready) {
        subscriptions = runSession(Safari.grid);
      } else {
        _disposeAll(subscriptions);
      }
    });

    const disposeDynamicValues = {
      dispose() {
        // event handlers
        SAFARI_MODAL.off("shown.bs.modal", onShown);
        SAFARI_MODAL.off("hide.bs.modal", onHide);

        _disposeAll(subscriptions);
      }
    }

    return [
      disposeDynamicValues,
      subscription,
    ];
  }

  function isSafariTown(town) {
    return town.content.some((content) => content instanceof SafariTownContent);
  }

  function autoEnterSafari() {
    const ready = ko.pureComputed(() => _and([
      AutomationSettings.getValue(SETTINGS_SECTION, "autoEnter"),
      !Safari.inProgress(),
      DisplayObservables.modalState.safariModal === "hidden",
      App.game.gameState === GameConstants.GameState.town,
      isSafariTown(player.town),
      Safari.canPay(),
    ]));

    const enter = () => {
      disposeEventHandler();
      Safari.payEntranceFee();
    };
    const disposeEventHandler = () => SAFARI_MODAL.off("shown.bs.modal", enter);
    const subscription = _whenReady(ready, () => {
      SAFARI_MODAL.on("shown.bs.modal", enter);
      Safari.openModal();
    });

    return [
      subscription,
      { dispose: disposeEventHandler },
    ];
  }

  function automate() {
    _automate(AutomationSettings.enabled(SETTINGS_SECTION), [
      autoEnterSafari,
      runSafari,
    ]);
  }

  return {
    actionScore,
    automate,
    baitValue,
    ballContinuation,
    battleActionCandidates,
    battleWeight,
    calculateChances,
    calculateEnvironmentWork,
    calculateEnvironments,
    calculateMedianChance,
    chooseAction,
    chooseBattleAction,
    createWeights,
    encounterChances,
    escapeProbability,
    executeAction,
    progressValue,
    randomEncounterRate,
    rockValue,
    updateState,
  };
})();
