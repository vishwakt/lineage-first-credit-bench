// bureau_a: JSON documents; v2 restructures the score and sends reason texts itself.

import type { Part, Tradeline } from "../core/types.ts";
import { textFor } from "../refdata/reasons.ts";
import type { Adapter } from "./types.ts";

const KIND = { R: "revolving", I: "installment", M: "mortgage", REVOLVING: "revolving", INSTALLMENT: "installment", MORTGAGE: "mortgage" } as const;
type Doc = Record<string, any>;

export const bureauA: Adapter = {
  source: "bureau_a",
  version: "1",
  dictionary: "bureau_a",

  decode(bytes) {
    const doc = JSON.parse(bytes.toString("utf8")) as Doc;
    return { formatVersion: String(doc.schemaVersion), record: doc };
  },

  normalize({ formatVersion, record }, dict) {
    const d = record as Doc;
    const part: Part = { hit: false, scores: [], tradelines: [], altPayments: [], bankTxns: [] };
    if (formatVersion === "1") {
      if (d.result !== "HIT") return part;
      part.hit = true;
      part.scores.push({
        provider: "bureau_a", model: "A-1", value: d.score.value, min: d.score.range[0], max: d.score.range[1],
        reasons: d.reasonCodes.map((code: string) => ({ code, text: dict ? textFor(dict, code) : null })),
      });
      part.tradelines = d.tradelines.map((t: Doc): Tradeline => ({
        provider: "bureau_a", ref: t.acct, kind: KIND[t.type as keyof typeof KIND], opened: t.opened,
        limitCents: Math.round(t.limit * 100), balanceCents: Math.round(t.balance * 100), history: t.history,
      }));
    } else {
      if (d.outcome !== "HIT") return part;
      part.hit = true;
      part.scores.push({
        provider: "bureau_a", model: d.riskScore.model, value: d.riskScore.value, min: d.riskScore.min, max: d.riskScore.max,
        reasons: d.reasons.map((r: Doc) => ({ code: r.code, text: r.text })),
      });
      part.tradelines = d.accounts.map((t: Doc): Tradeline => ({
        provider: "bureau_a", ref: t.id, kind: KIND[t.category as keyof typeof KIND], opened: t.openedOn,
        limitCents: t.limitCents, balanceCents: t.balanceCents, history: t.paymentPattern,
      }));
    }
    return part;
  },
};
