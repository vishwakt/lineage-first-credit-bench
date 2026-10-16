// bank_z: one JSON statement document with signed amounts in cents.

import type { Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

type Doc = Record<string, any>;

export const bankZ: Adapter = {
  source: "bank_z",
  version: "1",
  dictionary: null,

  decode(bytes) {
    const doc = JSON.parse(bytes.toString("utf8")) as Doc;
    return { formatVersion: String(doc.version), record: doc };
  },

  normalize({ record }) {
    const d = record as Doc;
    const part: Part = { hit: d.status !== "NO_ACCOUNT", scores: [], tradelines: [], altPayments: [], bankTxns: [] };
    part.bankTxns = (d.txns ?? []).map((t: Doc) => ({ provider: "bank_z", date: t.d, amountCents: t.a, counterparty: t.cp, memo: t.m }));
    return part;
  },
};
