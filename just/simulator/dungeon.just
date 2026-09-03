set working-directory := "../.."
set positional-arguments

[private]
@default:
  just --list simulator dungeon

[script]
run *args:
  exec ./simulators/dungeon/cli.cjs "$@"

test:
  ./simulators/dungeon/test.cjs

[script]
compare baseline candidate *args:
  baseline="$1"
  candidate="$2"
  shift 2
  exec ./simulators/dungeon/compare.cjs "$baseline" "$candidate" "$@"
