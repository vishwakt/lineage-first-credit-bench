// telecom_t: fixed-width records with CRLF line ends after a TELHDR header.

import type { AltPayment, Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

type Rec = { account: string; payee: string; period: string; due: string; paid: string; amount: number; status: string };
const iso = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
const STATUS = { O: "ONTIME", L: "LATE", M: "MISSED" } as const;

export const telecomT: Adapter = {
  source: "telecom_t",
  version: "1",
  dictionary: null,

  decode(bytes) {
    const lines = bytes.toString("latin1").split("\r\n").filter((l) => l.startsWith("TEL") && !l.startsWith("TELHDR"));
    const recs: Rec[] = lines.map((l) => ({
      account: l.slice(3, 13).trim(), payee: l.slice(13, 21).trim(), period: l.slice(21, 27), due: l.slice(27, 35),
      paid: l.slice(35, 43).trim(), amount: Number(l.slice(43, 51)), status: l[51],
    }));
    return { formatVersion: "1", record: recs };
  },

  normalize({ record }) {
    const altPayments = (record as Rec[]).map((r): AltPayment => ({
      provider: "telecom_t", kind: "telecom", account: r.account, payee: r.payee, period: `${r.period.slice(0, 4)}-${r.period.slice(4)}`,
      due: iso(r.due), paid: r.paid ? iso(r.paid) : null, amountCents: r.amount, status: STATUS[r.status as keyof typeof STATUS],
    }));
    const part: Part = { hit: altPayments.length > 0, scores: [], tradelines: [], altPayments, bankTxns: [] };
    return part;
  },
};
