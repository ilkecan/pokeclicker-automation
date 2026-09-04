# Simulators

Simulators provide reproducible performance and behavior tests for automation policies. They execute TypeScript from an official PokéClicker checkout instead of maintaining copies of game rules.

Each automation area has its own directory. Area-independent simulator-specific support lives in [`lib/`](lib/).

## Available simulators

The [Underground simulator](underground/) runs and compares mining policies across mine-type and level configurations:

```sh
just simulator underground run --seed 42
just simulator underground compare baseline.js candidate.js --seed 42
just simulator underground test
```

The [Dungeon simulator](dungeon/) runs and compares dungeon policies across paired official maps:

```sh
just simulator dungeon run --seed 42
just simulator dungeon compare baseline.js candidate.js --maps 2000 --seed 42
just simulator dungeon test
```

Both simulators emit one minified JSON report for successful runs and comparisons by default. Use `--pretty` for human-readable indentation and the simulator-specific `--per-map` or `--per-mine` flag for individual results.

Run these commands inside the repository's devenv environment.
