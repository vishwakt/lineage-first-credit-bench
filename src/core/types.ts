// Unified credit-file model shared by both designs. Scores stay provider specific (no
// cross-provider equivalence); tradelines, alternative payments, and bank transactions
// share one shape whatever their source format.

import type { AccountKind, AltKind, PaymentStatus, SourceId } from "../generator/world.ts";

export type { SourceId };

export type Reason = { code: string; text: string | null };

export type Score = { provider: string; model: string; value: number; min: number; max: number; reasons: Reason[] };

export type Tradeline = {
  provider: string;
  ref: string;
  kind: AccountKind;
  opened: string;
  limitCents: number;
  balanceCents: number;
  history: string;
};

export type AltPayment = {
  provider: string;
  kind: AltKind;
  account: string;
  payee: string;
  period: string;
  due: string;
  paid: string | null;
  amountCents: number;
  status: PaymentStatus;
};

export type BankTxn = { provider: string; date: string; amountCents: number; counterparty: string; memo: string };

// What one source contributed to a credit file.
export type Part = {
  hit: boolean;
  scores: Score[];
  tradelines: Tradeline[];
  altPayments: AltPayment[];
  bankTxns: BankTxn[];
};

export type Quarantined = { source: string; account: string; period: string; rule: string };

// The model input: the credit file after the quality layer.
export type CreditFile = {
  consumerId: string;
  asOf: string;
  parts: Partial<Record<SourceId, Part>>;
  quarantined: Quarantined[];
};

export type Principal = {
  tenantId: string;
  userId: string;
  role: "loan_officer" | "auditor" | "admin" | "service";
  assignedConsumers?: readonly string[];
};

export type DecisionRequest = {
  decisionId: string;
  tenantId: string;
  requester: string;
  purpose: string;
  consumerId: string;
  asOf: string;
  sources: SourceId[];
};

export type Outcome = "APPROVE" | "DECLINE" | "REFER";

export type DecisionReason = { source: string; code: string; text: string | null };

export type Decision = { outcome: Outcome; modelVersion: string; reasons: DecisionReason[] };

export const emptyPart = (): Part => ({ hit: false, scores: [], tradelines: [], altPayments: [], bankTxns: [] });
