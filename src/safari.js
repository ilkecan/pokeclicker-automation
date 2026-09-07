"use strict";

const safari = (() => {
  const SETTINGS_SECTION = "safari";
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

  function createGrid(height, width, value) {
    return Array.from({ length: height }, () => Array(width).fill(value));
  }

  function createState(grid) {
    const height = grid.length;
    const width = grid[0].length;
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
        followVisiblePokemon: false,
        collectVisibleItems: false,
      },
      pokemons: [],
      items: [],
      distances: createGrid(height, width, Infinity),
      predecessors: createGrid(height, width, null),
      weights: createWeights(),
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

  function createWeights() {
    const region = Safari.activeRegion();
    const encounters = SafariPokemonList.list[region]();
    const weights = {
      grass: { total: 0, weights: new Map() },
      water: { total: 0, weights: new Map() },
    };

    for (const encounter of encounters) {
      if (!encounter.isAvailable()) {
        continue;
      }

      for (const environment of encounter.environments) {
        let summary;
        switch (environment) {
          case SafariEnvironments.Grass:
            summary = weights.grass;
            break;
          case SafariEnvironments.Water:
            summary = weights.water;
            break;
          default:
            console.error("[pokeclicker-automation] safari: unknown encounter environment", environment);
            continue;
        }
        summary.total += encounter.weight;
        summary.weights.set(encounter.name, encounter.weight);
      }
    }

    return weights;
  }

  function updateState(state) {
    const point = Safari.playerXY;
    state.position.x = point.x;
    state.position.y = point.y;
    state.inBattle = Safari.inBattle();
    state.busy = SafariBattle.busy();
    state.balls = Safari.balls();
    state.enemy = SafariBattle.enemy;
    state.options.followVisiblePokemon = AutomationSettings.getValue(SETTINGS_SECTION, "followVisiblePokemon");
    state.options.collectVisibleItems = AutomationSettings.getValue(SETTINGS_SECTION, "collectVisibleItems");
    state.pokemons = Safari.pokemonGrid();
    state.items = Safari.itemGrid();
    buildRoute(state);
  }

  function distanceTo(state, target) {
    return state.distances[target.y][target.x];
  }

  function probability(summary, pokemon) {
    if (summary.total === 0) {
      return 0;
    }

    return (summary.weights.get(pokemon.name) ?? 0) / summary.total;
  }

  function effectiveProbability(state, pokemon) {
    const speciesProbability = Object.values(state.weights).reduce((maximum, summary) => Math.max(maximum, probability(summary, pokemon)), 0);
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

  function* pokemonCandidates(state) {
    for (const pokemon of state.pokemons) {
      if (!_shouldCatchPokemon(pokemon)) {
        continue;
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

  function* grassCandidates(state) {
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.grid[y].length; x++) {
        if (x === state.position.x && y === state.position.y) {
          // current position is not a target candidate
          continue;
        }

        if (state.grid[y][x] !== GameConstants.SafariTile.grass) {
          // only consider grass tiles for now
          continue;
        }

        const target = { x, y };
        const distance = distanceTo(state, target);
        if (!Number.isFinite(distance)) {
          // unreachable target
          continue;
        }

        yield { target, distance };
      }
    }
  }

  function bestGrass(state) {
    return bestCandidate(grassCandidates(state), compareDistance);
  }

  function chooseTarget(state) {
    if (state.options.followVisiblePokemon) {
      const pokemon = bestPokemon(state);
      if (pokemon) {
        return pokemon;
      }
    }

    if (state.options.collectVisibleItems) {
      const item = bestItem(state);
      if (item) {
        return item;
      }
    }

    const grass = bestGrass(state);
    if (grass) {
      return grass;
    }

    console.error("[pokeclicker-automation] safari: no reachable target");
  }

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
    // Exact eventual-catch value of throwing balls every turn from here: no choices
    // remain, statuses decay deterministically, so this is one chain over the balls left.
    let value = 0;
    let survival = 1;
    for (let turn = 0; turn < battle.balls; turn++) {
      const angry = Math.max(0, battle.angry - turn);
      const eating = Math.max(0, battle.eating - turn);
      const catchChance = catchProbability(enemy, angry, eating, battle.eatingBait);
      const escapeChance = escapeProbability(enemy, angry, eating, battle.eatingBait);
      value += survival * catchChance;
      survival *= (1 - catchChance) * (1 - escapeChance);
      // remaining turns cannot change the decision
      if (survival < 1e-15) {
        break;
      }
    }
    return value;
  }

  function baitDurations(bait) {
    return bait === BaitType.Bait ? BAIT_DURATIONS : BERRY_DURATIONS;
  }

  function average(values) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function rockValue(enemy, battle) {
    // Rock costs no ball: angry becomes the duration, eating clears, berry slot is kept.
    return average(ROCK_DURATIONS.map((duration) => {
      const angry = Math.max(battle.angry, duration);
      const survive = 1 - escapeProbability(enemy, angry, 0, battle.eatingBait);
      return survive * ballContinuation(enemy, { ...battle, angry: angry - 1, eating: 0 });
    }));
  }

  function baitValue(enemy, battle, bait) {
    // Bait costs no ball: eating becomes the duration, angry clears, slot takes the new bait.
    return average(baitDurations(bait).map((duration) => {
      const eating = Math.max(battle.eating, duration);
      const survive = 1 - escapeProbability(enemy, 0, eating, bait);
      return survive * ballContinuation(enemy, { ...battle, angry: 0, eating: eating - 1, eatingBait: bait });
    }));
  }

  function battleActionCandidates(shiny) {
    const candidates = [
      { type: ActionType.THROW_BAIT, bait: BaitType.Bait },
      { type: ActionType.THROW_BALL },
      { type: ActionType.THROW_ROCK },
    ];
    // only spend berries on shinies
    if (shiny) {
      if (readBerryAmount(BerryType.Razz) > 0) {
        candidates.push({ type: ActionType.THROW_BAIT, bait: BaitType.Razz });
      }
      if (readBerryAmount(BerryType.Nanab) > 0) {
        candidates.push({ type: ActionType.THROW_BAIT, bait: BaitType.Nanab });
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

  function chooseBattleAction(state) {
    // One-ply search with exact ball-only rollout: score each first action assuming
    // balls every turn afterwards; re-decided each turn, within ~0.03 of optimal.
    const enemy = state.enemy;
    const battle = createBattleState(state);
    let bestAction = null;
    let bestScore = -Infinity;
    for (const action of battleActionCandidates(enemy.shiny)) {
      const score = actionScore(enemy, battle, action);
      if (score > bestScore) {
        bestAction = action;
        bestScore = score;
      }
    }
    return bestAction;
  }

  function chooseAction(state) {
    if (state.inBattle && !state.busy && state.enemy) {
      if (!_shouldCatchPokemon(state.enemy)) {
        return { type: ActionType.RUN };
      }

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

    const optionSubscriptions = ["followVisiblePokemon", "collectVisibleItems"].map((name) => {
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

    const subscription = _whenReady(ready, () => {
      const enter = () => {
        SAFARI_MODAL.off("shown.bs.modal", enter);
        Safari.payEntranceFee();
      };
      SAFARI_MODAL.on("shown.bs.modal", enter);
      Safari.openModal();
    });

    return [subscription];
  }

  function automate() {
    _automate(AutomationSettings.enabled(SETTINGS_SECTION), [
      autoEnterSafari,
      runSafari,
    ]);
  }

  return {
    automate,
    chooseAction,
    createWeights,
    executeAction,
    updateState,
  };
})();
