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

## Deviation recorded on 19 Oct 2026, after the revision runs

The plan above specified a percentile bootstrap within each run and a pooled interval across runs, and the first analysis of the revision runs reported the pooled interval, a bootstrap over all replays of a corpus. A reviewer pointed out that pooling treats the 20,000 replays of a corpus as independent and ignores variation between runs, so it understates uncertainty (for the lineage median at 1,000,000 decisions it gave 2.34 to 2.35 ms). The reported quantile intervals now come from a two-stage paired bootstrap: 2,000 resamples, each drawing runs with replacement and then replays with replacement within every drawn run, with the same replay indices for every design, because within a run all designs replayed the same decisions in the same order. Each resample's statistic is the mean over runs of the per-run quantile; paired differences are taken within each resample. The run-level t intervals are unchanged and are reported alongside. No data were rerun; only `analysis/verify_numbers.py` changed.

## Amendment of 30 Oct 2026, before the write-side and sustained runs

Committed before any of the runs below, after a pre-submission review for *Distributed and Parallel Databases*. Results already reported are not reanalysed except where stated.

**New experiment: write-side cost (`experiments/rq2_write.ts`).** The lineage design and the hardened baseline, which keep the same raw bytes, hashes and versions, each persist the same decision runs into their own pooled database (10 tenants, as in RQ2) with synchronous commit on (the server default), so every persist is durable. Concurrency (requests in flight, each with its own connection) is 1, 4 and 16. At each concurrency there are 20 timed runs of 5,000 persists, generated before timing; within a run both designs persist the same decisions, and the order of the two designs alternates between runs. The databases are not emptied between runs, so later runs write into tables that already hold up to 300,000 decisions. Every persist time is kept.

* Outcomes per design and concurrency: throughput (decisions per second) and the p50, p95 and p99 persist latency of each run; mean and t-based 95% interval across the 20 runs.
* Comparison: the paired difference between designs (hardened minus lineage) of each outcome, with a t-based 95% interval over runs, and the two-stage paired bootstrap of the latency quantiles described in the 19 Oct deviation (2,000 resamples).
* Equivalence: the throughput of the hardened baseline is compared with the lineage design using the RQ3 rule (two one-sided tests at alpha 0.05, margin plus or minus 10% of the lineage mean at the same concurrency). No direction is predicted.

**Changed experiment: sustained RQ3 throughput.** RQ3 is rerun with 20,000 persists per timed run instead of 2,000 (about 9 seconds per run instead of about 1 second at the observed rate), still 20 runs per mode and tenant count, with all other settings unchanged. The number of checkpoints completed during the timed runs of each configuration is recorded from `pg_stat_checkpointer`. These results replace the RQ3 throughput, equivalence and storage results of commit b1d8de1; onboarding and isolation results are deterministic and are rerun unchanged. The decision rule and margin are those above.

**New descriptive evidence: replay query plans (`experiments/rq2_plans.ts`).** On the existing 1,000,000-decision corpora, the statements issued by one replay of each of 20 sampled decisions are captured and run under `EXPLAIN (ANALYZE, BUFFERS)` for the lineage design and the hardened baseline; table, TOAST and index sizes, index definitions and column compression settings are recorded. This is descriptive and has no test.

**New derived values from existing results.** Relative differences (lineage versus hardened baseline) of storage per decision and of the mean run-level median and p99 replay latency, computed in `analysis/verify_numbers.py` from the committed RQ2 results.
