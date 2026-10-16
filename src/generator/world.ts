// Ground truth of the synthetic world: consumers, their credit accounts, and their
// payment behaviour. Providers (src/providers) observe this truth, imperfectly, and
// serialize it in their own formats. Nothing here resembles any real data set.

import { addDays, firstOfPeriod, periodOf, shiftPeriod } from "./calendar.ts";
import { hash32, rngFor, sigmoid } from "./rng.ts";
import type { Factor } from "../refdata/reasons.ts";

export const SOURCES = [
  "bureau_a",
  "bureau_b",
  "bureau_c",
  "rent_x",
  "utility_y",
  "bank_z",
  "telecom_t",
  "bnpl_q",
] as const;
export type SourceId = (typeof SOURCES)[number];

export type AltKind = "rent" | "utility" | "telecom" | "bnpl";
export const ALT_KIND: Partial<Record<SourceId, AltKind>> = {
  rent_x: "rent",
  utility_y: "utility",
  telecom_t: "telecom",
  bnpl_q: "bnpl",
};

export type AccountKind = "revolving" | "installment" | "mortgage";

export type Account = {
  ref: string;
  kind: AccountKind;
  opened: string;
  limitCents: number;
  seenBy: { bureau_a: boolean; bureau_b: boolean; bureau_c: boolean };
};

export type Consumer = {
  index: number;
  id: string;
  quality: number; // latent creditworthiness, standard normal
  thin: boolean;
  has: Record<AltKind, boolean>;
  banked: boolean;
  accounts: Account[];
};

export type PaymentStatus = "ONTIME" | "LATE" | "MISSED";

export type Payment = {
  kind: AltKind;
  account: string;
  payee: string;
  period: string;
  due: string;
  paid: string | null;
  amountCents: number;
  status: PaymentStatus;
  viaBank: boolean;
};

export type BankTxn = {
  date: string;
  amountCents: number;
  direction: "debit" | "credit";
  counterparty: string;
  memo: string;
};

export function consumerId(index: number): string {
  return "C" + String(index).padStart(8, "0");
}

export function consumerIndex(id: string): number {
  return Number(id.slice(1));
}

const ALT_KINDS: AltKind[] = ["rent", "utility", "telecom", "bnpl"];
const ALT_PREVALENCE: Record<AltKind, number> = { rent: 0.45, utility: 0.85, telecom: 0.8, bnpl: 0.25 };

export function consumer(seed: number, index: number): Consumer {
  const r = rngFor(seed, "consumer", index);
  const quality = r.normal();
  const thin = r.bool(0.12);
  const has = {} as Record<AltKind, boolean>;
  for (const k of ALT_KINDS) has[k] = r.bool(ALT_PREVALENCE[k]);
  const banked = r.bool(0.9);
  const n = thin ? r.int(0, 1) : r.int(2, 7);
  const accounts: Account[] = [];
  for (let i = 0; i < n; i++) {
    const u = r.next();
    const kind: AccountKind = u < 0.6 ? "revolving" : u < 0.9 ? "installment" : "mortgage";
    const openedYear = thin ? r.int(2023, 2024) : r.int(2008, 2024);
    const opened = `${openedYear}-${String(r.int(1, 12)).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`;
    const limitCents =
      kind === "revolving" ? r.int(5, 250) * 10_000 : kind === "installment" ? r.int(20, 600) * 10_000 : r.int(1000, 6000) * 10_000;
    accounts.push({
      ref: `${index.toString(36).toUpperCase()}${i}${(hash32(`${seed}|acct|${index}|${i}`) % 9000) + 1000}`,
      kind,
      opened,
      limitCents,
      seenBy: { bureau_a: r.bool(0.95), bureau_b: r.bool(0.9), bureau_c: r.bool(0.85) },
    });
  }
  return { index, id: consumerId(index), quality, thin, has, banked, accounts };
}

// Monthly status of an account: 0 current, 1 thirty days late, 2 sixty, 3 ninety or more.
export function accountStatus(seed: number, c: Consumer, a: Account, period: string): "0" | "1" | "2" | "3" | "-" {
  if (period < periodOf(a.opened)) return "-";
  const r = rngFor(seed, "status", c.index, a.ref, period);
  const p = sigmoid(-3.6 - 1.3 * c.quality);
  const u = r.next();
  if (u < p * 0.15) return "3";
  if (u < p * 0.35) return "2";
  if (u < p) return "1";
  return "0";
}

export function accountBalance(seed: number, c: Consumer, a: Account, period: string): number {
  const r = rngFor(seed, "balance", c.index, a.ref, period);
  const base = sigmoid(-0.3 - 0.9 * c.quality); // weaker consumers carry higher utilization
  const share = Math.min(1, Math.max(0, base + 0.15 * r.normal()));
  return Math.round(a.limitCents * share);
}

// Factors behind a bureau's score, ranked by severity; bureaus encode them as reason codes.
export function scoreFactors(
  history: { status: string }[][],
  utilization: number,
  oldestYears: number,
  accounts: number,
  revolving: number,
): Factor[] {
  const out: Factor[] = [];
  const recent = history.some((h) => h.slice(-12).some((s) => s.status !== "0" && s.status !== "-"));
  const severe = history.some((h) => h.some((s) => s.status === "3"));
  if (severe) out.push("DELINQ_SEVERE");
  if (recent) out.push("DELINQ_RECENT");
  if (utilization > 0.5) out.push("HIGH_UTIL");
  if (oldestYears < 3) out.push("SHORT_HISTORY");
  if (accounts < 3) out.push("FEW_ACCOUNTS");
  if (utilization > 0.8) out.push("HIGH_BALANCE");
  if (revolving === 0) out.push("NO_REVOLVING");
  return out.slice(0, 4);
}

const GRACE_DAYS = 9;

function payee(seed: number, c: Consumer, kind: AltKind): string {
  const tag = { rent: "LL", utility: "UT", telecom: "TC", bnpl: "IN" }[kind];
  return `${tag}${(hash32(`${seed}|payee|${c.index}|${kind}`) % 90000) + 10000}`;
}

export function truePayment(seed: number, c: Consumer, kind: AltKind, period: string): Payment | null {
  if (!c.has[kind]) return null;
  const r = rngFor(seed, "pay", kind, c.index, period);
  const base = rngFor(seed, "payamt", kind, c.index);
  const amountCents =
    kind === "rent"
      ? base.int(700, 2600) * 100
      : kind === "utility"
        ? base.int(40, 180) * 100 + r.int(-3000, 3000)
        : kind === "telecom"
          ? base.int(35, 140) * 100
          : base.int(25, 120) * 100;
  const due = firstOfPeriod(period);
  const pMissed = sigmoid(-4.4 - 1.0 * c.quality);
  const pLate = sigmoid(-2.9 - 0.9 * c.quality);
  const u = r.next();
  let paid: string | null;
  if (u < pMissed) paid = null;
  else if (u < pMissed + pLate) paid = addDays(due, r.int(15, 50));
  else paid = addDays(due, r.int(0, 6));
  const cash = kind === "rent" ? 0.06 : kind === "utility" ? 0.02 : 0;
  return {
    kind,
    account: `${kind.slice(0, 1).toUpperCase()}${c.index}`,
    payee: payee(seed, c, kind),
    period,
    due,
    paid,
    amountCents,
    status: statusFor(due, paid),
    viaBank: c.banked && !r.bool(cash),
  };
}

export function statusFor(due: string, paid: string | null): PaymentStatus {
  if (paid === null) return "MISSED";
  return paid <= addDays(due, GRACE_DAYS) ? "ONTIME" : "LATE";
}

// Bank transactions dated within the given period: payroll, the consumer's own bill
// payments that went through the bank (whatever period they were due in), and noise.
export function bankTxns(seed: number, c: Consumer, period: string): BankTxn[] {
  if (!c.banked) return [];
  const r = rngFor(seed, "bank", c.index, period);
  const out: BankTxn[] = [];
  const payroll = rngFor(seed, "payroll", c.index).int(2200, 9000) * 100;
  out.push({ date: firstOfPeriod(period).slice(0, 8) + "15", amountCents: payroll, direction: "credit", counterparty: "EMPLOYER", memo: "PAYROLL" });
  // A bill paid in this period may have been due in this period or up to two before it.
  for (const back of [0, -1, -2]) {
    const due = shiftPeriod(period, back);
    for (const k of ALT_KINDS) {
      const p = truePayment(seed, c, k, due);
      if (p && p.paid && p.viaBank && periodOf(p.paid) === period) {
        out.push({ date: p.paid, amountCents: p.amountCents, direction: "debit", counterparty: p.payee, memo: k.toUpperCase() });
      }
    }
  }
  const noise = r.int(1, 2);
  for (let i = 0; i < noise; i++) {
    out.push({
      date: `${period}-${String(r.int(1, 28)).padStart(2, "0")}`,
      amountCents: r.int(5, 400) * 100,
      direction: "debit",
      counterparty: `M${r.int(1000, 9999)}`,
      memo: "CARD",
    });
  }
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.counterparty < y.counterparty ? -1 : 1));
  return out;
}
