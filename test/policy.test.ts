import assert from "node:assert/strict";
import { test } from "node:test";
import { authorize } from "../src/access/abac.ts";
import { decide } from "../src/decision/model.ts";
import { applyQuality } from "../src/quality/layer.ts";
import { emptyPart, type CreditFile, type Part } from "../src/core/types.ts";

test("ABAC: tenant mismatch always denied", () => {
  for (const role of ["admin", "service", "loan_officer", "auditor"] as const)
    for (const action of ["decision:create", "decision:read", "decision:replay"] as const)
      assert.equal(authorize({ tenantId: "a", userId: "u", role, assignedConsumers: ["C1"] }, action, { tenantId: "b", consumerId: "C1", outcome: "DECLINE" }).allow, false);
});

test("ABAC: officers see only assigned consumers; auditors only flagged decisions", () => {
  const officer = { tenantId: "a", userId: "o", role: "loan_officer" as const, assignedConsumers: ["C1"] };
  assert.equal(authorize(officer, "decision:read", { tenantId: "a", consumerId: "C1" }).allow, true);
  assert.equal(authorize(officer, "decision:read", { tenantId: "a", consumerId: "C2" }).allow, false);
  const auditor = { tenantId: "a", userId: "x", role: "auditor" as const };
  assert.equal(authorize(auditor, "decision:replay", { tenantId: "a", consumerId: "C2", outcome: "DECLINE" }).allow, true);
  assert.equal(authorize(auditor, "decision:replay", { tenantId: "a", consumerId: "C2", outcome: "APPROVE" }).allow, false);
});

const pay = (period: string, paid: string | null, status: "ONTIME" | "LATE" | "MISSED") => ({
  provider: "rent_x", kind: "rent" as const, account: "R1", payee: "LL1", period, due: period + "-01", paid, amountCents: 100000, status,
});

test("quality layer catches duplicates and bank-contradicted records", () => {
  const rent: Part = { ...emptyPart(), hit: true, altPayments: [
    pay("2025-01", "2025-01-03", "ONTIME"),
    pay("2025-01", "2025-01-03", "ONTIME"),
    pay("2025-02", null, "MISSED"),
    pay("2025-03", "2025-04-10", "LATE"),
    pay("2025-04", null, "MISSED"),
  ] };
  const bank: Part = { ...emptyPart(), hit: true, bankTxns: [
    { provider: "bank_z", date: "2025-01-03", amountCents: -100000, counterparty: "LL1", memo: "RENT" },
    { provider: "bank_z", date: "2025-02-04", amountCents: -100000, counterparty: "LL1", memo: "RENT" },
    { provider: "bank_z", date: "2025-03-02", amountCents: -100000, counterparty: "LL1", memo: "RENT" },
  ] };
  const q = applyQuality({ rent_x: rent, bank_z: bank }, "xval");
  assert.deepEqual(q.quarantined.map((x) => `${x.period}:${x.rule}`).sort(), ["2025-01:duplicate", "2025-02:bank_shows_payment", "2025-03:bank_timing_conflict"]);
  assert.deepEqual(q.parts.rent_x!.altPayments.map((p) => p.period), ["2025-01", "2025-04"]);
  assert.equal(applyQuality({ rent_x: rent, bank_z: bank }, "off").quarantined.length, 0);
});

test("model is deterministic and versioned", () => {
  const file: CreditFile = { consumerId: "C1", asOf: "2025-05-01", parts: {}, quarantined: [] };
  assert.deepEqual(decide(file, "m.1"), decide(file, "m.1"));
  assert.equal(decide(file, "m.1").outcome, "REFER");
  assert.throws(() => decide(file, "m.9"));
});
