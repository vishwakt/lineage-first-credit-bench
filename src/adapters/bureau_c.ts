// bureau_c: XML; v2 renames the root and the account elements and moves money to cents.
// Reason texts travel inside the document.

import { XMLParser } from "fast-xml-parser";
import type { Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  isArray: (name) => name === "Reason" || name === "Tradeline" || name === "Account",
});
type Node = Record<string, any>;

export const bureauC: Adapter = {
  source: "bureau_c",
  version: "1",
  dictionary: null,

  decode(bytes) {
    const doc = parser.parse(bytes.toString("utf8")) as Node;
    return { formatVersion: doc.Report ? "2" : "1", record: doc };
  },

  normalize({ formatVersion, record }) {
    const v1 = formatVersion === "1";
    const root = v1 ? (record as Node).CreditReport : (record as Node).Report;
    const hit = v1 ? root.status === "HIT" : root.hit === "true";
    const part: Part = { hit, scores: [], tradelines: [], altPayments: [], bankTxns: [] };
    if (!hit) return part;
    const s = root.Score;
    part.scores.push({ provider: "bureau_c", model: "C", value: Number(s.value), min: Number(s.min), max: Number(s.max),
      reasons: (s.Reason ?? []).map((r: Node) => ({ code: r.code, text: r["#text"] ?? null })) });
    const accounts: Node[] = v1 ? root.Tradelines?.Tradeline ?? [] : root.Accounts?.Account ?? [];
    part.tradelines = accounts.map((a) =>
      v1
        ? { provider: "bureau_c", ref: a.ref, kind: a.kind, opened: a.opened, limitCents: Math.round(Number(a.limit) * 100),
            balanceCents: Math.round(Number(a.balance) * 100), history: a.history }
        : { provider: "bureau_c", ref: a.id, kind: a.type, opened: a.openedOn, limitCents: Number(a.limitCents),
            balanceCents: Number(a.balanceCents), history: a.pattern },
    );
    return part;
  },
};
