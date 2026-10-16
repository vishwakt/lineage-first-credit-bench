// utility_y: JSON Lines, one bill per line; v2 marks each line and sends integer cents.

import type { AltPayment, Part } from "../core/types.ts";
import type { Adapter } from "./types.ts";

type Line = Record<string, any>;
const STATUS = { P: "ONTIME", L: "LATE", M: "MISSED" } as const;

export const utilityY: Adapter = {
  source: "utility_y",
  version: "1",
  dictionary: null,

  decode(bytes) {
    const lines = bytes.toString("utf8").split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Line);
    // An empty feed carries no version marker.
    const v = lines.length === 0 ? "none" : lines.some((l) => l.v === 2) ? "2" : "1";
    return { formatVersion: v, record: lines };
  },

  normalize({ formatVersion, record }) {
    const altPayments = (record as Line[]).map((l): AltPayment => ({
      provider: "utility_y", kind: "utility", account: l.acct, payee: l.biller, period: l.cycle, due: l.due, paid: l.paid,
      amountCents: formatVersion === "2" ? l.amt_cents : Math.round(l.amt * 100), status: STATUS[l.st as keyof typeof STATUS],
    }));
    const part: Part = { hit: altPayments.length > 0, scores: [], tradelines: [], altPayments, bankTxns: [] };
    return part;
  },
};
