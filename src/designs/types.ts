// What both designs implement. Persist captures a finished decision run; replay
// reconstructs a past decision from whatever the design captured.

import type pg from "pg";
import type { DecisionRun } from "../core/pipeline.ts";
import type { Decision, SourceId } from "../core/types.ts";
import type { QualityMode } from "../quality/layer.ts";

export type Replay = {
  decisionId: string;
  raw: Partial<Record<SourceId, Buffer | null>>; // null when the design kept no raw bytes
  modelInput: Buffer | null;
  decision: Decision | null;
  integrity: "verified" | "mismatch" | "unchecked";
};

export type StoredDecision = { decisionId: string; tenantId: string; consumerId: string; outcome: string };

export interface Design {
  readonly name: string;
  persist(c: pg.ClientBase, run: DecisionRun, quality: QualityMode): Promise<void>;
  // now: the moment of replay; a design may only use reference data it holds at that moment.
  replay(c: pg.ClientBase, decisionId: string, now: string): Promise<Replay | null>;
  readDecision(c: pg.ClientBase, decisionId: string): Promise<StoredDecision | null>;
}
