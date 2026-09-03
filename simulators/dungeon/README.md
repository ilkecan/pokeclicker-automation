# Dungeon simulator

This simulator runs `src/dungeon.js` against the official PokeClicker dungeon map and runner sources. Official map generation, movement, visibility, chest reveals, timers, ladder bonuses, and win/loss transitions stay in the game source. Unrelated rewards, UI, and combat are mocked; simulated regular and boss battle durations are configurable.

## Run

The official checkout must have its npm dependencies installed. Select it with `POKECLICKER_DIR` or `--game-dir PATH`.

```sh
just simulator dungeon run --seed 42
just simulator dungeon run --single --maps 100 --size 5 --json
just simulator dungeon test
```

Matrix mode is the default. It runs the eight combinations of `fightAllBattles`, `openAccessibleChests`, and `searchAllChests` at sizes 5, 10, and 14, with 1000 maps per scenario. Use `--sizes` to select matrix sizes. Use `--single` with policy flags for one configuration; all policy booleans default to false in single mode.

## Compare policies

```sh
just simulator dungeon compare baseline.js candidate.js --maps 2000 --sizes 5,10,14 --seed 42
```

Each policy receives the same generated map for every scenario and map index. The comparison verifies map hashes, reports both distributions, and summarizes candidate-minus-baseline deltas for pairs that both complete. Timeout transitions are reported separately. No composite score is used.

## Metrics and fidelity

Reports include completion count and rate, simulated completion seconds, regular battles completed, boss battles completed, chests opened, virtual ticks, policy CPU time, process runtime, source hashes, and official Git provenance. Completion-time distributions use successful maps. Battle, boss, and chest distributions include partial work from timed-out maps. Median and p95 use the shared simulator statistics helper.

Each map is seeded through the official `Rand` and `SeededRand` implementation. The runtime uses the official 100 ms game tick and deferred Knockout updates with a virtual clock, and drives battle completion before `DungeonRunner.tick`, matching the game loop. Battle simulation is a deterministic strength model, not a replacement for the full Pokemon combat stack.
