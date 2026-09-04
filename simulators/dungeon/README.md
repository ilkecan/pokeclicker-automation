# Dungeon simulator

This simulator runs `src/dungeon.js` against the official PokeClicker dungeon map and runner sources. Official map generation, movement, visibility, chest reveals, timers, ladder bonuses, and win/loss transitions stay in the game source. Unrelated rewards, UI, and combat are mocked; simulated regular and boss battle durations are configurable.

## Run

The official checkout must have its npm dependencies installed. Select it with `POKECLICKER_DIR` or `--game-dir PATH`.

```sh
just simulator dungeon run --seed 42
just simulator dungeon run --single --maps 100 --size 5 --flash-tier 1 --pretty
just simulator dungeon test
```

Successful commands emit minified JSON by default; `--pretty` indents it. `--per-map` adds individual map results. Matrix mode runs `3 sizes × 4 flash tiers × 8 policy configurations = 96` configurations, with 250 maps per configuration by default. Use `--sizes` and `--flash-tiers` to select matrix dimensions. Use `--single` with `--size`, `--flash-tier`, and policy flags for one configuration.

Flash tier values are `0` (no flash), `1` (100 clears), `2` (250 clears), and `3` (400 clears). Each configuration has an independent reproducible map stream; comparison runs pair baseline and candidate maps by configuration.

## Compare policies

```sh
just simulator dungeon compare baseline.js candidate.js --maps 2000 --sizes 5,10,14 --seed 42
```

Each baseline/candidate pair receives the same generated map for every configuration and map index. Different configurations use independent reproducible map streams. The comparison emits one overall aggregate plus per-configuration distributions, paired deltas, and candidate/baseline ratios. `--per-map` includes paired map results.

## Metrics and fidelity

Reports include completion counts, simulated completion seconds, regular battles, boss battles, chests opened, virtual ticks, policy CPU time, process runtime, source hashes, and official Git provenance. Completion-time distributions use successful maps; battle, boss, and chest distributions include partial work from timed-out maps. The `mean` field is the average. Median and p95 use the shared simulator statistics helper.

Each map is seeded through the official `Rand` and `SeededRand` implementation. The runtime uses the official 100 ms game tick and deferred Knockout updates with a virtual clock, and drives battle completion before `DungeonRunner.tick`, matching the game loop. Battle simulation is a deterministic strength model, not a replacement for the full Pokemon combat stack.
