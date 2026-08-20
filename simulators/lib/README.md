# Simulator libraries

Shared Node.js support for simulator runtimes lives here. `runtime.cjs` provides TypeScript loading, deterministic randomness and source provenance; `virtual-clock.cjs` provides deterministic timer scheduling without real-time waits.

Feature-specific behavior belongs in its simulator directory rather than this library.
