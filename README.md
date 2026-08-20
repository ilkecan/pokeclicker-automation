# PokéClicker automation

Userscript automation for various tasks in [PokéClicker](https://www.pokeclicker.com/).

## Use

The userscript entry point is `src/index.user.js`. Install it with a userscript manager, or inject it into an Electron build such as `pokeclicker-desktop`:

```sh
NODE_OPTIONS="--require=$(pwd)/inject.cjs" pokeclicker
```

`inject.cjs` reads the userscript metadata and reloads its local sources when the game page reloads.

## Development

The devenv environment provides Node.js, `just` and repository checks:

```sh
devenv shell
just --list
```

Performance simulators live in [`simulators/`](simulators/). They run automation against official game code so policy changes can be compared on reproducible inputs.
