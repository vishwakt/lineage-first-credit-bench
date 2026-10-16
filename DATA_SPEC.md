# Synthetic data specification

Every byte of data in this repository is produced by seeded code in `src/generator` and `src/providers`. No real consumer data, no scraped data, and no credentials of any real provider are used. All provider names, wire formats, field names, and reason codes below were invented for this benchmark.

## 1. Determinism

Every random value is drawn from a stream derived from the seed and a list of labels (`rngFor(seed, ...labels)` in `src/generator/rng.ts`: FNV-1a hash of the labels seeds a mulberry32 generator). Any record can therefore be regenerated on its own, and the same seed always yields byte-identical payloads. The default seed is `20261015` (`src/providers/config.ts`). `experiments/generator_check.ts` verifies determinism and fault rates and writes `results/raw/generator_check.json`.

## 2. Ground truth (`src/generator/world.ts`)

**Consumers.** Consumer `i` has identifier `C` followed by `i` padded to eight digits, a latent creditworthiness `quality` drawn from a standard normal distribution, and these attributes:

| Attribute | Rule |
|---|---|
| Thin file | probability 0.12; such consumers hold 0 or 1 credit accounts opened in 2023 or 2024 |
| Credit accounts | 2 to 7 for other consumers; 60 percent revolving, 30 percent installment, 10 percent mortgage |
| Bureau coverage | each account is visible to bureau_a, bureau_b, bureau_c with probability 0.95, 0.90, 0.85 |
| Renter, utility, telecom, buy now pay later | probability 0.45, 0.85, 0.80, 0.25 |
| Bank account | probability 0.90 |

**Account status** per month is current, 30, 60, or 90 or more days late. The probability of any delinquency in a month is `sigmoid(minus 3.6 minus 1.3 quality)`, so weaker consumers are late more often. **Balances** follow a utilization share centred on `sigmoid(minus 0.3 minus 0.9 quality)`.

**Bill payments** (rent, utility, telecom, buy now pay later) are due on the first of each month. A payment is missed with probability `sigmoid(minus 4.4 minus quality)`, late (paid 15 to 50 days after the due date) with probability `sigmoid(minus 2.9 minus 0.9 quality)`, and otherwise paid within 6 days. A payment is on time when paid within 9 days of the due date. Rent is paid in cash 6 percent of the time and utilities 2 percent of the time; cash payments leave no bank record.

**Bank transactions** for banked consumers: a payroll credit on the 15th, a debit for every bill paid through the bank on its paid date (counterparty is the payee code), and one or two card purchases of noise per month.

## 3. Providers and wire formats

Each provider observes the truth as of the inquiry date `asOf`. Bureaus report 24 months of account history; the alternative-data processors and the bank report the 12 completed months before the month of `asOf` (the bank also includes earlier days of the current month). A payment made on or after `asOf` is reported as missed, since the processor has not received it.

| Source | Kind | Format | Versions (effective date) |
|---|---|---|---|
| bureau_a | bureau | JSON document | v1; v2 from 2025-09-01 |
| bureau_b | bureau | fixed-width text, CRLF lines, Latin-1 | v1; v2 from 2025-03-01 |
| bureau_c | bureau | XML | v1; v2 from 2025-04-01 |
| rent_x | rent processor | CSV with header | v1; v2 from 2025-05-01 |
| utility_y | utility processor | JSON Lines | v1; v2 from 2025-07-01 |
| bank_z | bank statements | JSON document | v1 only |
| telecom_t | telecom processor | fixed-width text, CRLF lines, Latin-1 | v1 only |
| bnpl_q | instalment processor | XML | v1 only |

### bureau_a (JSON)

v1: `{"schemaVersion":"1","inquiry":{"subjectRef","asOf"},"result":"HIT"|"NO_HIT","score":{"value","range":[1,999]},"reasonCodes":[code...],"tradelines":[{"acct","type":"R"|"I"|"M","opened","limit","balance","history"}]}` with money in dollars.

v2: `{"schemaVersion":"2","subject":{"ref","asOf"},"outcome","riskScore":{"model":"A-2","value","min","max"},"reasons":[{"code","text"}],"accounts":[{"id","category":"REVOLVING"|"INSTALLMENT"|"MORTGAGE","openedOn","limitCents","balanceCents","paymentPattern"}]}`. From v2 the bureau sends reason texts itself; under v1 only codes arrive.

`history` and `paymentPattern` hold 24 characters, oldest month first: `0` current, `1` 30 days late, `2` 60 days, `3` 90 or more, `-` account not yet open.

### bureau_b (fixed width)

Records, one per line, ending with CRLF:

| Record | v1 layout (column widths) | v2 change |
|---|---|---|
| Header `HDR` | version 2, subject 12, asOf `YYYYMMDD` 8, hit flag `H` or `N` 1 | version field reads `02` |
| Score `SCR` | score 3, up to four reason codes of 3 each | none |
| Tradeline `TRD` | account 16, type 1, opened 8, limit in dollars 9, balance in dollars 9, history 24 | an ownership flag 1 follows type; limit and balance become cents, 11 wide |
| Trailer `END` | record count 5 | none |

### bureau_c (XML)

v1: `<CreditReport version="1" subject asOf status>` containing `<Score value min="0" max="100">` with `<Reason code>text</Reason>` children, and `<Tradelines>` of `<Tradeline ref kind opened limit balance history/>` (dollars).

v2: root renamed `<Report schema="2" subject asOf hit>`, `<Tradelines>` renamed `<Accounts>`, and each `<Account id type openedOn limitCents balanceCents pattern/>` carries cents.

### rent_x (CSV)

v1 header `tenancy_ref,landlord,period,due_date,paid_date,amount,status` with ISO dates, dollars with two decimals, and status `ONTIME`, `LATE`, or `MISSED`. v2 writes dates as `MM/DD/YYYY` and adds a final `channel` column (`ACH`, `CASH`, or empty when unpaid).

### utility_y (JSON Lines)

v1 lines: `{"acct","biller","cycle","due","paid"|null,"amt":dollars,"st":"P"|"L"|"M"}`. v2 lines add `"v":2` and replace `amt` with integer `amt_cents`.

### bank_z (JSON)

`{"version":1,"holder","from","to","txns":[{"d":date,"a":signed cents,"cp":counterparty,"m":memo}]}`; unbanked consumers get `"status":"NO_ACCOUNT"` and no `txns`.

### telecom_t (fixed width)

Header `TELHDR` + subject 12 + asOf 8. Each payment record is `TEL` + account 10 + payee 8 + period `YYYYMM` 6 + due 8 + paid 8 (blank when unpaid) + amount in cents 8 + status 1 (`O`, `L`, `M`).

### bnpl_q (XML)

`<Plan provider="bnpl_q" holder asOf>` containing `<Installment plan merchant period due [paid] amount state/>` with state `ontime`, `late`, or `missed`.

## 4. Reason-code dictionaries (reference-data drift)

Bureaus encode the factors behind a score as reason codes from a published dictionary (`src/refdata/reasons.ts`). Dictionary changes are the second kind of drift, distinct from format changes:

| Bureau | Versions (effective date) | Nature of change |
|---|---|---|
| bureau_a | a.1; a.2 from 2025-06-01 | codes renumbered and reworded; some codes reused for different factors (for example `A04`) |
| bureau_b | b.1; b.2 from 2025-08-15 | codes kept, texts reworded |
| bureau_c | c.1 only | none; texts travel inside the XML |

## 5. Fault injection

The four alternative-data processors inject reporting faults into their records. For each (source, consumer, period) one uniform draw `u` decides the fault:

| Fault | Condition | Effect on the reported record | Default rate |
|---|---|---|---|
| missed | `u` below the missed rate, and the payment was paid | paid date removed, status `MISSED` | 0.01 |
| double | next band of width equal to the double rate | the record is reported twice | 0.01 |
| timing | next band, and the payment was paid | paid date moved 31 to 45 days later, status recomputed | 0.01 |

Faults are a property of the processor's records, so the same fault appears in every inquiry whose window covers that period. Every injected fault is returned to the harness as ground truth and is never visible to the systems under test. Rates are measured against eligible records (all records for double; paid records for missed and timing). `NO_FAULTS` produces the fault-free counterfactual world used to judge whether a fault changed a decision.

## 6. Ground truth versus system view

Systems under test receive only the payload bytes and a content type. The format version, the dictionary version, and the injected faults are available only to the experiment harness.
