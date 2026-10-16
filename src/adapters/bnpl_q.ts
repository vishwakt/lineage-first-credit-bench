// bnpl_q: XML plan with one Installment element per monthly payment.

import { XMLParser } from "fast-xml-parser";
import type { AltPayment, Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  isArray: (name) => name === "Installment",
});
type Node = Record<string, any>;
const STATUS = { ontime: "ONTIME", late: "LATE", missed: "MISSED" } as const;

export const bnplQ: Adapter = {
  source: "bnpl_q",
  version: "1",
  dictionary: null,

  decode(bytes) {
    return { formatVersion: "1", record: parser.parse(bytes.toString("utf8")) as Node };
  },

  normalize({ record }) {
    const items: Node[] = (record as Node).Plan?.Installment ?? [];
    const altPayments = items.map((i): AltPayment => ({
      provider: "bnpl_q", kind: "bnpl", account: i.plan, payee: i.merchant, period: i.period, due: i.due, paid: i.paid ?? null,
      amountCents: Math.round(Number(i.amount) * 100), status: STATUS[i.state as keyof typeof STATUS],
    }));
    const part: Part = { hit: altPayments.length > 0, scores: [], tradelines: [], altPayments, bankTxns: [] };
    return part;
  },
};
