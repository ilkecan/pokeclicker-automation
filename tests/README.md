# Tests

Tests validate automation behavior against official PokéClicker code rather than copied game rules.

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
