// bureau_b: fixed-width records with CRLF line ends; v2 adds an ownership flag and moves
// money to cents in wider fields. Reason texts come from the bureau's dictionary.

import type { Part } from "../core/types.ts";
import { textFor } from "../refdata/reasons.ts";
import type { Adapter } from "./types.ts";

const KIND = { R: "revolving", I: "installment", M: "mortgage" } as const;
const iso = (ymd: string) => `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;

type Trade = { ref: string; type: string; ecoa: string | null; opened: string; limit: number; balance: number; history: string };
type Rec = { subject: string; asOf: string; hit: boolean; score: number | null; codes: string[]; tradelines: Trade[] };

export const bureauB: Adapter = {
  source: "bureau_b",
  version: "1",
  dictionary: "bureau_b",

  decode(bytes) {
    const lines = bytes.toString("latin1").split("\r\n").filter((l) => l.length > 0);
    const h = lines[0];
    const v = String(Number(h.slice(3, 5)));
    const rec: Rec = { subject: h.slice(5, 17).trim(), asOf: iso(h.slice(17, 25)), hit: h[25] === "H", score: null, codes: [], tradelines: [] };
    for (const l of lines.slice(1)) {
      if (l.startsWith("SCR")) {
        rec.score = Number(l.slice(3, 6));
        for (let i = 6; i < 18; i += 3) if (l.slice(i, i + 3).trim()) rec.codes.push(l.slice(i, i + 3));
      } else if (l.startsWith("TRD")) {
        if (v === "1") {
          rec.tradelines.push({ ref: l.slice(3, 19).trim(), type: l[19], ecoa: null, opened: iso(l.slice(20, 28)),
            limit: Number(l.slice(28, 37)), balance: Number(l.slice(37, 46)), history: l.slice(46, 70) });
        } else {
          rec.tradelines.push({ ref: l.slice(3, 19).trim(), type: l[19], ecoa: l[20], opened: iso(l.slice(21, 29)),
            limit: Number(l.slice(29, 40)), balance: Number(l.slice(40, 51)), history: l.slice(51, 75) });
        }
      }
    }
    return { formatVersion: v, record: rec };
  },

  normalize({ formatVersion, record }, dict) {
    const r = record as Rec;
    const part: Part = { hit: r.hit, scores: [], tradelines: [], altPayments: [], bankTxns: [] };
    if (!r.hit) return part;
    const cents = (x: number) => (formatVersion === "1" ? x * 100 : x);
    part.scores.push({ provider: "bureau_b", model: "B", value: r.score!, min: 250, max: 900,
      reasons: r.codes.map((code) => ({ code, text: dict ? textFor(dict, code) : null })) });
    part.tradelines = r.tradelines.map((t) => ({ provider: "bureau_b", ref: t.ref, kind: KIND[t.type as keyof typeof KIND], opened: t.opened,
      limitCents: cents(t.limit), balanceCents: cents(t.balance), history: t.history }));
    return part;
  },
};
