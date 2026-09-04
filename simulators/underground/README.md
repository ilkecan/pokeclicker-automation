# Underground simulator

This simulator runs `src/underground.js` against the official PokéClicker mining implementation. Mine generation, items, tools, surveys, rewards and battery patterns therefore stay aligned with the game.

## Run

The official checkout must have its npm dependencies installed. Select it with `POKECLICKER_DIR` or `--game-dir PATH`.

```sh
just simulator underground run --seed 42
just simulator underground run --single --mines 100 --seed 42 --level 30 --mine-type Fossil --pretty
just simulator underground test
```

Successful commands emit minified JSON by default; `--pretty` indents it. `--per-mine` adds individual mine results. Matrix mode runs seven mine types at levels 0, 10, 20, 30, 40, and 50: 42 configurations with 25 mines per configuration by default. Use `--mine-types` and `--levels` to select matrix dimensions. Use `--single` with `--mine-type` and `--level` for one configuration.

## Compare policies

Both files must export `underground.dig`:

```sh
just simulator underground compare baseline.js candidate.js --single --mines 2000 --seed 42 --level 30 --mine-type Fossil
```

The comparison gives both policies the same generated board for each mine and configuration. It emits one overall aggregate plus per-configuration distributions, paired deltas, and candidate/baseline ratios. `--per-mine` includes paired mine results. Generation and policy randomness use separate seeded streams so different policy decisions do not change later boards. Comparison mode rejects `--shared-rng`.

Use a large mine count to reduce timing noise. The report separates policy setup, policy actions, combined policy time and total simulator runtime. Action time per tick helps distinguish callback cost from policies that take different numbers of ticks.

## Fidelity and provenance

The simulator transpiles and executes the official TypeScript at runtime. A virtual clock preserves game ticks, discovery recovery, Knockout update ordering and battery animation timing without real-time waits. Tools and battery state persist across sequential mines.

Mocks are limited to surrounding services such as notifications, settings, inventory storage and statistics. Oak items are inactive, and Underground level and highest region are fixed by the run options.

JSON reports include the official Git revision, dirty-worktree state and hashes for every loaded TypeScript module. This makes local or upstream source differences visible when results are compared.

A browser-derived golden fixture could provide additional end-to-end validation, but exact state capture and replay are intentionally deferred until that complexity is justified.
