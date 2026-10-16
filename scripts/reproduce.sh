#!/bin/sh
# Reproduces every raw result, number, and figure from a clean clone.
# Needs the database from `docker compose up -d db` (or PG* variables pointing elsewhere).
# Roughly two to three hours on a 10 core laptop, most of it the 1,000,000 decision corpus.
set -eu
cd "$(dirname "$0")/.."
export FRESH=1
node experiments/generator_check.ts
node experiments/rq1_footprint.ts
node experiments/rq2_replay.ts 10000 100000 1000000
node experiments/rq3_tenancy.ts 10 50 100
node experiments/rq4_faults.ts 50000
node experiments/environment.ts
python3 analysis/verify_numbers.py
python3 analysis/plot_figures.py
