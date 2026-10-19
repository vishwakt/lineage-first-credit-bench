# Analysis plan for the revision runs

Committed on 18 Oct 2026, before any revision run, so that the margins, seeds, and tests below were fixed before their results were known. The first full run (commit `2f37998`, results in the history of `results/raw`) is superseded by the revision runs.

## Changes from the first run

| Item | First run | Revision |
|---|---|---|
| Designs in RQ2 | lineage; baseline at parsed, normalized, raw | adds `baseline_hardened`: per-integration tables that keep raw bytes (binary), a SHA-256 hash, and the format, dictionary, and adapter versions, with append-only triggers, a model-input hash in the decision log, hash-verified replay, and a single query across all audit tables |
| Timing repetitions | 5 runs | 20 runs for RQ2 replay latency, RQ3 throughput, and RQ4 ingestion latency |
| Latency data kept | quantiles per run | every individual replay time, so quantile intervals can be bootstrapped |
| RQ4 worlds | the development seed 20261015 | five fresh evaluation seeds never used during development: 31001, 31002, 31003, 31004, 31005. The development seed is the pilot seed and is not reported as evaluation evidence |

## Statistics

* **Run-level summaries.** Mean, standard deviation, and t-based 95% confidence interval across runs, as before; every run's value is published in `results/raw`.
* **Paired differences.** Within a run every design replays the same sampled decisions, so latency differences between the lineage design and each baseline are paired by run: mean paired difference with a t-based 95% interval.
* **Quantile uncertainty.** Within each run, a percentile bootstrap (2,000 resamples, fixed seed) gives a 95% interval for the p50 and p99 of each design; the pooled interval across runs is reported alongside the run-level interval.
* **Throughput equivalence (RQ3).** Equivalence margin fixed in advance at plus or minus 10% of the pool mode's mean throughput at the same tenant count. Two one-sided tests at alpha 0.05: a mode is declared equivalent to pool when the 90% confidence interval of the mean difference (Welch) lies entirely inside the margin; if the interval crosses the margin, the result is reported as "equivalence not established", and if it excludes zero and lies outside the margin, as a difference.
* **RQ4 across worlds.** Escape share, false-quarantine share, and differing outcomes are reported per seed with exact counts, and as a mean with a t-based 95% interval across the five seeds. Record-level interception and the reduction in differing outcomes are reported separately.

## Not changed in this revision

RQ1 source order is not counterbalanced and no new noise types are added to the generator; both are reported as limitations.
