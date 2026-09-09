# Tests

Tests execute automation in isolated script contexts using official PokéClicker code and constants where practical. Plain game-state fixtures cover modules, such as Safari, whose game classes cannot load in the Node harness.

The shared test harness and its tests live in [`lib/`](lib/).

Run the suite with:

```sh
just test
just coverage
```

The tests require an official PokéClicker checkout. Set `POKECLICKER_DIR` when it is not at the default sibling path:

```sh
POKECLICKER_DIR=/path/to/pokeclicker just test
```
