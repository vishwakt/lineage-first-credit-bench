# Baseline design: per-integration audit logs

The baseline implements the pattern the lineage-first design is compared against: every integration writes its own audit log next to its adapter, and the decision service keeps its own decision log. The author built both designs, so the baseline could end up weaker than a real team would build it. This document records each design choice so readers can judge that risk, and replications that strengthen the baseline are welcome.

## What both designs share

Both designs share the provider adapters (decoding and normalization), the quality layer, the decision model, the tenancy routing, and the access policy. For the same request they produce byte-identical model inputs and identical decisions; `test/designs.test.ts` checks this. Differences in the results therefore come only from what each design captures and how it replays.

## Choices made to keep the baseline strong

| Concern | Baseline choice | Why |
|---|---|---|
| Correlation | Every audit row and the decision log carry the decision id; replay looks rows up by it | Correlation identifiers are standard practice; without them replay would rest on timestamp matching, an easy straw man |
| Shared helper | One generic insert routine; each integration only declares its table, its text encoding, and its own extra columns | A competent team factors out common logging code |
| Tenant isolation | Every audit table has a tenant column, row-level security, and a policy, created in the integration's own migration | Required for a fair comparison of isolation; the isolation suite checks every table |
| Decision log | Records model version, quality mode, source list, outcome, reasons, and quarantined records | A decision log without the model version would be an obvious defect |
| Capture discipline | Three levels, run separately: `parsed`, `normalized`, `raw` (see below) | Teams differ in how much they log; the results report all three instead of choosing one |

## Capture levels

| Level | What each integration keeps | Typical motivation |
|---|---|---|
| `parsed` | The parsed provider response, as JSONB | "Log the response object" |
| `normalized` | The normalized output the model consumed, as JSONB | "Log what we used" |
| `raw` | The raw payload as text in the integration's encoding, its format version, and the normalized output | A disciplined team that anticipated audits |

## What the baseline does not do, and why

| Not done | Reason |
|---|---|
| Content hashes of payloads | Not part of the common pattern; integrity checking is one of the properties the lineage substrate adds |
| Recording the adapter or reference-data version | In the common pattern, adapters and their reference data (here, reason-code dictionaries) are updated in place. A `parsed` replay must therefore normalize again with the dictionary held at replay time. The `normalized` and `raw` levels store the normalized output and do not need the version |
| Append-only enforcement | Audit tables are ordinary tables with ordinary data manipulation grants |

## Adding a source

| Design | Work per new source |
|---|---|
| Baseline | Shared adapter module and registry line; an audit module (`src/baseline/audit/<source>.ts`); a migration creating its audit table, index, row-level security policy, and grants (`migrations/baseline/1NN_<source>.sql`); a registry line |
| Lineage-first | Shared adapter module and registry line only |

Sources 1 to 8 were added to both designs one source per commit, tagged `rq1-s1` to `rq1-s8` after the zero-source frameworks at `rq1-s0`. `experiments/rq1_footprint.ts` measures each step with `git diff --numstat`.
