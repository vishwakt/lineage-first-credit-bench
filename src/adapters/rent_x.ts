// rent_x: CSV with a header row; v2 writes US-style dates and adds a channel column.

import type { AltPayment, Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

type Row = Record<string, string>;
const isoFromUs = (d: string) => (d ? `${d.slice(6, 10)}-${d.slice(0, 2)}-${d.slice(3, 5)}` : "");

export const rentX: Adapter = {
  source: "rent_x",
  version: "1",
  dictionary: null,

  decode(bytes) {
    const [header, ...lines] = bytes.toString("utf8").split("\n").filter((l) => l.length > 0);
    const cols = header.split(",");
    const rows: Row[] = lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v])));
    return { formatVersion: cols.includes("channel") ? "2" : "1", record: rows };
  },

  normalize({ formatVersion, record }) {
    const date = formatVersion === "1" ? (d: string) => d : isoFromUs;
    const altPayments = (record as Row[]).map((r): AltPayment => ({
      provider: "rent_x", kind: "rent", account: r.tenancy_ref, payee: r.landlord, period: r.period, due: date(r.due_date),
      paid: r.paid_date ? date(r.paid_date) : null, amountCents: Math.round(Number(r.amount) * 100), status: r.status as AltPayment["status"],
    }));
    const part: Part = { hit: altPayments.length > 0, scores: [], tradelines: [], altPayments, bankTxns: [] };
    return part;
  },
};
