// In-process API layer: every call is checked by the ABAC policy and runs inside the
// caller's tenant scope, so a cross-tenant request meets both barriers.

import { authorize } from "../access/abac.ts";
import { runDecision, type DecisionRun, type Fetch } from "../core/pipeline.ts";
import type { DecisionRequest, Principal } from "../core/types.ts";
import type { Design, Replay, StoredDecision } from "../designs/types.ts";
import type { QualityMode } from "../quality/layer.ts";
import type { Tenancy } from "../tenancy/tenancy.ts";

export type Result<T> = { status: "ok"; value: T } | { status: "forbidden"; rule: string } | { status: "not_found" };

export class CreditService {
  readonly design: Design;
  readonly tenancy: Tenancy;
  readonly fetch: Fetch;
  readonly quality: QualityMode;

  constructor(design: Design, tenancy: Tenancy, fetch: Fetch, quality: QualityMode) {
    this.design = design;
    this.tenancy = tenancy;
    this.fetch = fetch;
    this.quality = quality;
  }

  async decide(p: Principal, req: DecisionRequest): Promise<Result<DecisionRun>> {
    const v = authorize(p, "decision:create", { tenantId: req.tenantId, consumerId: req.consumerId });
    if (!v.allow) return { status: "forbidden", rule: v.rule };
    const run = runDecision(req, this.fetch, this.quality);
    await this.tenancy.withTenant(p.tenantId, (c) => this.design.persist(c, run, this.quality));
    return { status: "ok", value: run };
  }

  async getDecision(p: Principal, decisionId: string): Promise<Result<StoredDecision>> {
    const d = await this.tenancy.withTenant(p.tenantId, (c) => this.design.readDecision(c, decisionId));
    if (!d) return { status: "not_found" };
    const v = authorize(p, "decision:read", d);
    return v.allow ? { status: "ok", value: d } : { status: "forbidden", rule: v.rule };
  }

  async replay(p: Principal, decisionId: string, now: string): Promise<Result<Replay>> {
    return this.tenancy.withTenant(p.tenantId, async (c) => {
      const d = await this.design.readDecision(c, decisionId);
      if (!d) return { status: "not_found" } as const;
      const v = authorize(p, "decision:replay", d);
      if (!v.allow) return { status: "forbidden", rule: v.rule } as const;
      const r = await this.design.replay(c, decisionId, now);
      return r ? ({ status: "ok", value: r } as const) : ({ status: "not_found" } as const);
    });
  }
}
