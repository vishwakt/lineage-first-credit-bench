// Simulators for the three fictional bureaus. Each serializes the same kind of
// information in a deliberately different wire format: JSON (bureau_a), fixed-width
// text (bureau_b), and XML (bureau_c). Formats are documented in DATA_SPEC.md.

import { effectiveAt, toDay, windowBefore } from "../generator/calendar.ts";
import { rngFor } from "../generator/rng.ts";
import { accountBalance, accountStatus, scoreFactors, type Account, type Consumer } from "../generator/world.ts";
import { REASON_DICTIONARIES } from "../refdata/reasons.ts";
import { FORMAT_VERSIONS } from "./config.ts";

type Bureau = "bureau_a" | "bureau_b" | "bureau_c";

type BureauView = {
  accounts: { a: Account; history: string; balanceCents: number }[];
  score: number;
  codes: string[];
  texts: string[];
} | null;

const SCALES: Record<Bureau, [number, number, number, number]> = {
  // min, max, centre, spread
  bureau_a: [1, 999, 600, 120],
  bureau_b: [250, 900, 575, 110],
  bureau_c: [0, 100, 55, 18],
};

function view(seed: number, c: Consumer, bureau: Bureau, asOf: string): BureauView {
  const seen = c.accounts.filter((a) => a.seenBy[bureau] && a.opened < asOf);
  if (seen.length === 0) return null;
  const window = windowBefore(asOf, 24);
  const last = window[window.length - 1];
  const accounts = seen.map((a) => ({
    a,
    history: window.map((p) => accountStatus(seed, c, a, p)).join(""),
    balanceCents: accountBalance(seed, c, a, last),
  }));
  const rev = accounts.filter((x) => x.a.kind === "revolving");
  const limit = rev.reduce((s, x) => s + x.a.limitCents, 0);
  const util = limit > 0 ? rev.reduce((s, x) => s + x.balanceCents, 0) / limit : 0;
  const oldest = Math.min(...seen.map((a) => toDay(a.opened)));
  const factors = scoreFactors(
    accounts.map((x) => [...x.history].map((s) => ({ status: s }))),
    util,
    (toDay(asOf) - oldest) / 365,
    seen.length,
    rev.length,
  );
  const recent = accounts.reduce((s, x) => s + [...x.history.slice(-12)].filter((h) => h !== "0" && h !== "-").length, 0);
  const quarter = asOf.slice(0, 4) + "Q" + (Math.floor((Number(asOf.slice(5, 7)) - 1) / 3) + 1);
  const noise = rngFor(seed, "score", bureau, c.index, quarter).normal();
  const z = c.quality - 0.35 * recent - 0.6 * (util - 0.3) + 0.25 * noise;
  const [min, max, centre, spread] = SCALES[bureau];
  const score = Math.max(min, Math.min(max, Math.round(centre + spread * z)));
  const dict = effectiveAt(REASON_DICTIONARIES[bureau], asOf);
  return {
    accounts,
    score,
    codes: factors.map((f) => dict.codes[f].code),
    texts: factors.map((f) => dict.codes[f].text),
  };
}

const KIND_LETTER = { revolving: "R", installment: "I", mortgage: "M" } as const;
const KIND_WORD = { revolving: "REVOLVING", installment: "INSTALLMENT", mortgage: "MORTGAGE" } as const;

export function bureauA(seed: number, c: Consumer, asOf: string): { bytes: Buffer; formatVersion: string } {
  const v = effectiveAt(FORMAT_VERSIONS.bureau_a, asOf).version;
  const bv = view(seed, c, "bureau_a", asOf);
  let doc: unknown;
  if (v === "1") {
    doc = bv
      ? {
          schemaVersion: "1",
          inquiry: { subjectRef: c.id, asOf },
          result: "HIT",
          score: { value: bv.score, range: [1, 999] },
          reasonCodes: bv.codes,
          tradelines: bv.accounts.map((x) => ({
            acct: x.a.ref,
            type: KIND_LETTER[x.a.kind],
            opened: x.a.opened,
            limit: x.a.limitCents / 100,
            balance: x.balanceCents / 100,
            history: x.history,
          })),
        }
      : { schemaVersion: "1", inquiry: { subjectRef: c.id, asOf }, result: "NO_HIT" };
  } else {
    doc = bv
      ? {
          schemaVersion: "2",
          subject: { ref: c.id, asOf },
          outcome: "HIT",
          riskScore: { model: "A-2", value: bv.score, min: 1, max: 999 },
          reasons: bv.codes.map((code, i) => ({ code, text: bv.texts[i] })),
          accounts: bv.accounts.map((x) => ({
            id: x.a.ref,
            category: KIND_WORD[x.a.kind],
            openedOn: x.a.opened,
            limitCents: x.a.limitCents,
            balanceCents: x.balanceCents,
            paymentPattern: x.history,
          })),
        }
      : { schemaVersion: "2", subject: { ref: c.id, asOf }, outcome: "NO_HIT" };
  }
  return { bytes: Buffer.from(JSON.stringify(doc), "utf8"), formatVersion: v };
}

const pad = (s: string | number, n: number) => String(s).padEnd(n, " ").slice(0, n);
const num = (x: number, n: number) => String(x).padStart(n, "0").slice(-n);
const ymd = (iso: string) => iso.replaceAll("-", "");

export function bureauB(seed: number, c: Consumer, asOf: string): { bytes: Buffer; formatVersion: string } {
  const v = effectiveAt(FORMAT_VERSIONS.bureau_b, asOf).version;
  const bv = view(seed, c, "bureau_b", asOf);
  const lines: string[] = [];
  lines.push("HDR" + num(Number(v), 2) + pad(c.id, 12) + ymd(asOf) + (bv ? "H" : "N"));
  if (bv) {
    lines.push("SCR" + num(bv.score, 3) + bv.codes.map((code) => pad(code, 3)).join("").padEnd(12, " "));
    for (const x of bv.accounts) {
      if (v === "1") {
        lines.push(
          "TRD" + pad(x.a.ref, 16) + KIND_LETTER[x.a.kind] + ymd(x.a.opened) +
            num(Math.round(x.a.limitCents / 100), 9) + num(Math.round(x.balanceCents / 100), 9) + x.history,
        );
      } else {
        lines.push(
          "TRD" + pad(x.a.ref, 16) + KIND_LETTER[x.a.kind] + "I" + ymd(x.a.opened) +
            num(x.a.limitCents, 11) + num(x.balanceCents, 11) + x.history,
        );
      }
    }
  }
  lines.push("END" + num(lines.length + 1, 5));
  return { bytes: Buffer.from(lines.join("\r\n") + "\r\n", "latin1"), formatVersion: v };
}

const esc = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function bureauC(seed: number, c: Consumer, asOf: string): { bytes: Buffer; formatVersion: string } {
  const v = effectiveAt(FORMAT_VERSIONS.bureau_c, asOf).version;
  const bv = view(seed, c, "bureau_c", asOf);
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  if (v === "1") {
    xml += `<CreditReport version="1" subject="${c.id}" asOf="${asOf}" status="${bv ? "HIT" : "NO_HIT"}">`;
    if (bv) {
      xml += `<Score value="${bv.score}" min="0" max="100">`;
      bv.codes.forEach((code, i) => (xml += `<Reason code="${code}">${esc(bv.texts[i])}</Reason>`));
      xml += "</Score><Tradelines>";
      for (const x of bv.accounts) {
        xml += `<Tradeline ref="${x.a.ref}" kind="${x.a.kind}" opened="${x.a.opened}" limit="${x.a.limitCents / 100}" balance="${x.balanceCents / 100}" history="${x.history}"/>`;
      }
      xml += "</Tradelines>";
    }
    xml += "</CreditReport>\n";
  } else {
    xml += `<Report schema="2" subject="${c.id}" asOf="${asOf}" hit="${bv ? "true" : "false"}">`;
    if (bv) {
      xml += `<Score value="${bv.score}" min="0" max="100">`;
      bv.codes.forEach((code, i) => (xml += `<Reason code="${code}">${esc(bv.texts[i])}</Reason>`));
      xml += "</Score><Accounts>";
      for (const x of bv.accounts) {
        xml += `<Account id="${x.a.ref}" type="${x.a.kind}" openedOn="${x.a.opened}" limitCents="${x.a.limitCents}" balanceCents="${x.balanceCents}" pattern="${x.history}"/>`;
      }
      xml += "</Accounts>";
    }
    xml += "</Report>\n";
  }
  return { bytes: Buffer.from(xml, "utf8"), formatVersion: v };
}
