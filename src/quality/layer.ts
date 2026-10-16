// Ingestion quality layer for alternative data. Quarantined records are removed from the
// credit file before the model sees it and listed for stewardship review.
//
//   off           no checks
//   xval          duplicate detection plus cross-validation against bank statements
//   xval_anomaly  also quarantines isolated anomalies that the bank cannot confirm

import { addDays, firstOfPeriod, shiftPeriod } from "../generator/calendar.ts";
import type { AltPayment, Part, Quarantined, SourceId } from "../core/types.ts";

export type QualityMode = "off" | "xval" | "xval_anomaly";
export const QUALITY_MODES: readonly QualityMode[] = ["off", "xval", "xval_anomaly"];

const MATCH_WINDOW_DAYS = 55;

export function applyQuality(
  parts: Partial<Record<SourceId, Part>>,
  mode: QualityMode,
): { parts: Partial<Record<SourceId, Part>>; quarantined: Quarantined[] } {
  if (mode === "off") return { parts, quarantined: [] };
  const quarantined: Quarantined[] = [];
  const out: Partial<Record<SourceId, Part>> = {};

  // Bank debits available for cross-validation, keyed by counterparty.
  const debits = new Map<string, { date: string; amountCents: number; used: boolean }[]>();
  for (const t of parts.bank_z?.bankTxns ?? []) {
    if (t.amountCents >= 0) continue;
    const list = debits.get(t.counterparty) ?? [];
    list.push({ date: t.date, amountCents: -t.amountCents, used: false });
    debits.set(t.counterparty, list);
  }
  const banked = parts.bank_z?.hit === true;

  for (const [source, part] of Object.entries(parts) as [SourceId, Part][]) {
    if (part.altPayments.length === 0) {
      out[source] = part;
      continue;
    }
    // 1. Duplicates: one record per account and period.
    const seen = new Set<string>();
    const unique: AltPayment[] = [];
    for (const p of part.altPayments) {
      const key = p.account + "|" + p.period;
      if (seen.has(key)) quarantined.push({ source, account: p.account, period: p.period, rule: "duplicate" });
      else {
        seen.add(key);
        unique.push(p);
      }
    }
    // 2. Cross-validation. First consume debits that confirm a reported paid date exactly;
    // a record that the bank contradicts is one with a leftover matching debit in its window.
    const confirmed = new Set<AltPayment>();
    for (const p of unique) {
      if (p.paid === null) continue;
      const d = debits.get(p.payee)?.find((x) => !x.used && x.date === p.paid && x.amountCents === p.amountCents);
      if (d) {
        d.used = true;
        confirmed.add(p);
      }
    }
    // Each leftover debit belongs to the unconfirmed record with the latest due date before it.
    // Debits from after the next due date following the last reported period belong to a
    // period this feed has not reported yet, so they cannot contradict it.
    const lastPeriod = unique.reduce((m, p) => (p.period > m ? p.period : m), "");
    const horizon = firstOfPeriod(shiftPeriod(lastPeriod, 1));
    const contradicted = new Set<AltPayment>();
    for (const [payee, list] of debits)
      for (const d of list) {
        if (d.used || d.date >= horizon) continue;
        let best: AltPayment | undefined;
        for (const p of unique)
          if (p.payee === payee && !confirmed.has(p) && !contradicted.has(p) && p.amountCents === d.amountCents &&
              d.date >= p.due && d.date < addDays(p.due, MATCH_WINDOW_DAYS) && (!best || p.due > best.due)) best = p;
        if (best) {
          d.used = true;
          contradicted.add(best);
        }
      }
    const kept: AltPayment[] = [];
    const unverified: AltPayment[] = [];
    for (const p of unique) {
      if (contradicted.has(p)) {
        quarantined.push({ source, account: p.account, period: p.period, rule: p.paid === null ? "bank_shows_payment" : "bank_timing_conflict" });
      } else {
        kept.push(p);
        if (!confirmed.has(p)) unverified.push(p);
      }
    }
    // 3. Isolated anomalies the bank could not settle: one adverse record in an otherwise clean stream.
    let final = kept;
    if (mode === "xval_anomaly" && kept.length >= 6) {
      const adverse = kept.filter((p) => p.status !== "ONTIME");
      if (adverse.length === 1 && (!banked || unverified.includes(adverse[0]))) {
        const p = adverse[0];
        quarantined.push({ source, account: p.account, period: p.period, rule: "isolated_anomaly" });
        final = kept.filter((x) => x !== p);
      }
    }
    out[source] = { ...part, altPayments: final };
  }
  return { parts: out, quarantined };
}
