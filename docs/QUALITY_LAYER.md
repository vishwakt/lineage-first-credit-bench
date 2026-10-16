# Ingestion quality layer

The quality layer (`src/quality/layer.ts`) checks alternative-data records before the model sees them. A quarantined record is removed from the credit file and listed for stewardship review; the list is part of the model input, so replay reproduces it.

## Modes

| Mode | Checks |
|---|---|
| `off` | none |
| `xval` | duplicate detection, then cross-validation against bank statements |
| `xval_anomaly` | as `xval`, plus quarantine of an isolated adverse record that the bank could not confirm |

## Cross-validation

1. A record whose reported paid date, payee, and amount match a bank debit exactly is confirmed, and that debit is consumed.
2. Each remaining debit is assigned to the unconfirmed record of the same payee and amount with the latest due date on or before the debit, within 55 days of that due date. A record that receives a debit is contradicted by the bank: `bank_shows_payment` when the processor reported it missed, `bank_timing_conflict` when it reported a different paid date.
3. Debits dated on or after the due date that follows the last period the feed reported are ignored, because they belong to a period the feed has not reported yet.

The layer sees only what the systems see (payloads), never the injected-fault log.

## Refinements after the pilot run

The matching rules were refined twice after a pilot run of 5,000 decisions (`experiments/rq4_faults.ts 5000`), before any reported run. Both changes are generic and use no ground truth:

| Version | Rule | Pilot false quarantines (of 141,396 records) | Pilot faults caught by `xval` |
|---|---|---|---|
| First | Records scanned in period order; the first unmatched debit in a record's window contradicted it | 301 | 3,740 of 4,149 |
| Second | Rule 2 above (latest due date wins) | 258 | 3,778 of 4,149 |
| Reported | Rules 2 and 3 above | 14 | 3,771 of 4,149 |

The pilot exposed two ways a genuine record could be quarantined: a missed month claiming the next month's debit, and debits from the still-open current month matching the last reported month. These pilot figures are recorded for transparency; the reported results come from the final runs in `results/raw`.

## Limits

Faults on consumers without a bank account, and on payments made in cash, cannot be cross-validated; under `xval` they escape. `xval_anomaly` catches some of them at the price of quarantining genuine isolated late or missed payments, which can change decisions.
