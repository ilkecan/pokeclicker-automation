# Simulators

Simulators provide reproducible performance and behavior tests for automation policies. They execute TypeScript from an official PokéClicker checkout instead of maintaining copies of game rules.

Each automation area has its own directory. Area-independent simulator-specific support lives in [`lib/`](lib/).

## Available simulators

The [Underground simulator](underground/) runs and compares mining policies:

```sh
just simulator underground run --mines 1000 --seed 42 --level 30
just simulator underground compare baseline.js candidate.js --mines 2000 --seed 42 --level 30
just simulator underground test
```

The [Dungeon simulator](dungeon/) runs and compares dungeon policies across paired official maps:

```sh
just simulator dungeon run --seed 42
just simulator dungeon compare baseline.js candidate.js --maps 2000 --seed 42
just simulator dungeon test
```

Both simulators report reproducible virtual outcomes, distribution statistics, policy timing, and official-source provenance.

Run these commands inside the repository's devenv environment.
