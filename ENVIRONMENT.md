# Environment

Written by `experiments/environment.ts` at the end of `scripts/reproduce.sh`; it describes the run whose results are in `results/raw`.

| Item | Value |
|---|---|
| Commit | `40133a5c15661d53762956fae9423550e00b39af` (working tree had uncommitted changes) |
| Date (UTC) | 2026-10-31 02:14 |
| CPU | Apple M5, 10 logical cores |
| Memory | 32 GiB |
| Operating system | darwin 25.2.0 (macOS 26.2) |
| Node.js | v24.14.0 |
| PostgreSQL | 17.6 (container image postgres:17.6-alpine) |
| Docker | Docker version 29.6.2, build dfc4efb |
| Python | Python 3.12.12 |
| PostgreSQL max_connections | 500 |
| PostgreSQL shared_buffers | 131072 |
| PostgreSQL synchronous_commit | on |
| PostgreSQL work_mem | 16384 |

Corpus databases for the replay experiments are loaded with `synchronous_commit = off`; replay itself is read only. The throughput experiment runs with the server default.

## Which commit produced which result

Added by hand on 30 Oct 2026, because the results in `results/raw` come from two runs on the same machine and database settings:

| Results | Commit | Date (UTC) |
|---|---|---|
| `generator_check`, `rq1_footprint`, `rq2_10000`, `rq2_100000`, `rq2_1000000`, their latency samples, `rq2_code_drift_100000`, `rq4_faults` | `b1d8de1` (clean tree) | 2026-10-19 |
| `rq2_write`, `rq2_plans_1000000`, `rq3_tenancy` | `40133a5` | 2026-10-31 |

The "uncommitted changes" flag above refers to `analysis/verify_numbers.py`, which was being extended while the second run was in progress; no experiment, source, migration, or script file differed from `40133a5` (`git diff --stat 40133a5 -- experiments src migrations scripts test package.json` is empty). `results/raw/superseded/rq3_tenancy_28fb3ec.json` keeps the RQ3 result of the first run (2,000 persists per timed run), which the second run replaces.
