set working-directory := "../.."
set positional-arguments

[private]
@default:
    just --list simulator underground

[script]
run *args:
    exec ./simulators/underground/cli.cjs "$@"

test:
    ./simulators/underground/test.cjs

[script]
compare baseline candidate *args:
    baseline="$1"
    candidate="$2"
    shift 2
    exec ./simulators/underground/compare.cjs --baseline "$baseline" --candidate "$candidate" "$@"
