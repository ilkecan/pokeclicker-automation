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

Run these commands inside the repository's devenv environment.
