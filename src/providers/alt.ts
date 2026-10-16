// Simulators for the alternative-data processors (rent_x, utility_y, telecom_t, bnpl_q)
// and the bank-statement provider (bank_z). The processors inject reporting faults at
// configured rates; every injected fault is returned so the harness can log ground truth.

import { addDays, effectiveAt, windowBefore } from "../generator/calendar.ts";
import { rngFor } from "../generator/rng.ts";
import { bankTxns, statusFor, truePayment, type AltKind, type Consumer, type Payment } from "../generator/world.ts";
import { FORMAT_VERSIONS, type FaultType, type WorldConfig } from "./config.ts";

export const ALT_WINDOW_MONTHS = 12;

export type InjectedFault = { source: string; consumerId: string; period: string; type: FaultType };

// What the processor knew on asOf: a payment made on or after asOf has not arrived yet.
function observed(seed: number, c: Consumer, kind: AltKind, period: string, asOf: string): Payment | null {
  const p = truePayment(seed, c, kind, period);
  if (!p) return null;
  if (p.paid !== null && p.paid >= asOf) return { ...p, paid: null, status: "MISSED" };
  return p;
}

export function processorRecords(
  cfg: WorldConfig,
  source: string,
  kind: AltKind,
  c: Consumer,
  asOf: string,
): { records: Payment[]; faults: InjectedFault[] } {
  const records: Payment[] = [];
  const faults: InjectedFault[] = [];
  for (const period of windowBefore(asOf, ALT_WINDOW_MONTHS)) {
    const p = observed(cfg.seed, c, kind, period, asOf);
    if (!p) continue;
    const r = rngFor(cfg.seed, "fault", source, c.index, period);
    const u = r.next();
    const { missed, double, timing } = cfg.faults;
    if (u < missed) {
      if (p.paid !== null) {
        records.push({ ...p, paid: null, status: "MISSED" });
        faults.push({ source, consumerId: c.id, period, type: "missed" });
        continue;
      }
    } else if (u < missed + double) {
      records.push(p, { ...p });
      faults.push({ source, consumerId: c.id, period, type: "double" });
      continue;
    } else if (u < missed + double + timing) {
      if (p.paid !== null) {
        const paid = addDays(p.paid, r.int(31, 45));
        records.push({ ...p, paid, status: statusFor(p.due, paid) });
        faults.push({ source, consumerId: c.id, period, type: "timing" });
        continue;
      }
    }
    records.push(p);
  }
  return { records, faults };
}

const money = (cents: number) => (cents / 100).toFixed(2);
const usDate = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const pad = (s: string, n: number) => s.padEnd(n, " ").slice(0, n);
const num = (x: number, n: number) => String(x).padStart(n, "0").slice(-n);
const ymd = (iso: string) => iso.replaceAll("-", "");

export function rentX(cfg: WorldConfig, c: Consumer, asOf: string) {
  const v = effectiveAt(FORMAT_VERSIONS.rent_x, asOf).version;
  const { records, faults } = processorRecords(cfg, "rent_x", "rent", c, asOf);
  const rows: string[] = [];
  if (v === "1") {
    rows.push("tenancy_ref,landlord,period,due_date,paid_date,amount,status");
    for (const p of records) rows.push([p.account, p.payee, p.period, p.due, p.paid ?? "", money(p.amountCents), p.status].join(","));
  } else {
    rows.push("tenancy_ref,landlord,period,due_date,paid_date,amount,status,channel");
    for (const p of records) {
      const channel = p.paid === null ? "" : p.viaBank ? "ACH" : "CASH";
      rows.push([p.account, p.payee, p.period, usDate(p.due), p.paid ? usDate(p.paid) : "", money(p.amountCents), p.status, channel].join(","));
    }
  }
  return { bytes: Buffer.from(rows.join("\n") + "\n", "utf8"), formatVersion: v, faults };
}

const ST = { ONTIME: "P", LATE: "L", MISSED: "M" } as const;

export function utilityY(cfg: WorldConfig, c: Consumer, asOf: string) {
  const v = effectiveAt(FORMAT_VERSIONS.utility_y, asOf).version;
  const { records, faults } = processorRecords(cfg, "utility_y", "utility", c, asOf);
  const lines = records.map((p) =>
    v === "1"
      ? JSON.stringify({ acct: p.account, biller: p.payee, cycle: p.period, due: p.due, paid: p.paid, amt: Number(money(p.amountCents)), st: ST[p.status] })
      : JSON.stringify({ v: 2, acct: p.account, biller: p.payee, cycle: p.period, due: p.due, paid: p.paid, amt_cents: p.amountCents, st: ST[p.status] }),
  );
  return { bytes: Buffer.from(lines.map((l) => l + "\n").join(""), "utf8"), formatVersion: v, faults };
}

export function telecomT(cfg: WorldConfig, c: Consumer, asOf: string) {
  const { records, faults } = processorRecords(cfg, "telecom_t", "telecom", c, asOf);
  const lines = ["TELHDR" + pad(c.id, 12) + ymd(asOf)];
  for (const p of records) {
    lines.push(
      "TEL" + pad(p.account, 10) + pad(p.payee, 8) + p.period.replace("-", "") + ymd(p.due) +
        (p.paid ? ymd(p.paid) : " ".repeat(8)) + num(p.amountCents, 8) + p.status[0],
    );
  }
  return { bytes: Buffer.from(lines.join("\r\n") + "\r\n", "latin1"), formatVersion: "1", faults };
}

export function bnplQ(cfg: WorldConfig, c: Consumer, asOf: string) {
  const { records, faults } = processorRecords(cfg, "bnpl_q", "bnpl", c, asOf);
  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Plan provider="bnpl_q" holder="${c.id}" asOf="${asOf}">`;
  for (const p of records) {
    xml += `<Installment plan="${p.account}" merchant="${p.payee}" period="${p.period}" due="${p.due}"${p.paid ? ` paid="${p.paid}"` : ""} amount="${money(p.amountCents)}" state="${p.status.toLowerCase()}"/>`;
  }
  xml += "</Plan>\n";
  return { bytes: Buffer.from(xml, "utf8"), formatVersion: "1", faults };
}

export function bankZ(cfg: WorldConfig, c: Consumer, asOf: string) {
  const window = windowBefore(asOf, ALT_WINDOW_MONTHS);
  const doc: Record<string, unknown> = { version: 1, holder: c.id, from: window[0] + "-01", to: asOf };
  if (!c.banked) doc.status = "NO_ACCOUNT";
  else {
    const txns = [...window, asOf.slice(0, 7)]
      .flatMap((p) => bankTxns(cfg.seed, c, p))
      .filter((t) => t.date < asOf);
    doc.txns = txns.map((t) => ({ d: t.date, a: t.direction === "debit" ? -t.amountCents : t.amountCents, cp: t.counterparty, m: t.memo }));
  }
  return { bytes: Buffer.from(JSON.stringify(doc), "utf8"), formatVersion: "1", faults: [] as InjectedFault[] };
}
