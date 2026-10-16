# Environment

Written by `experiments/environment.ts` at the end of `scripts/reproduce.sh`; it describes the run whose results are in `results/raw`.

| Item | Value |
|---|---|
| Commit | `2f37998f402f621c3f2db2cf2da3bcba948e649a` |
| Date (UTC) | 2026-10-16 09:13 |
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
