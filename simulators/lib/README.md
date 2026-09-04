# Simulator libraries

This directory contains shared support for deterministic simulator execution.
`virtual-clock.cjs` provides a virtual clock without real-time waits,
`statistics.cjs` summarizes numeric samples with mean, median, and nearest-rank
p95 values, `report.cjs` serializes validated minified or pretty JSON reports,
and `seeding.cjs` derives stable configuration seeds.
