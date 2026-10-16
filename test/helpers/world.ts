import { ADAPTERS } from "../../src/adapters/index.ts";
import type { Fetch } from "../../src/core/pipeline.ts";
import type { DecisionRequest, Principal, SourceId } from "../../src/core/types.ts";
import { consumerId } from "../../src/generator/world.ts";
import { DEFAULT_WORLD, type WorldConfig } from "../../src/providers/config.ts";
import { fetchFromProvider } from "../../src/providers/index.ts";

export const fetchWorld = (cfg: WorldConfig = DEFAULT_WORLD): Fetch => (s, c, a) => fetchFromProvider(cfg, s, c, a).response;

export const registered = () => Object.keys(ADAPTERS) as SourceId[];

export const service = (tenantId: string): Principal => ({ tenantId, userId: "svc", role: "service" });
export const admin = (tenantId: string): Principal => ({ tenantId, userId: "adm", role: "admin" });

// Decision dates spread over 2025 so that every drift event falls inside the corpus.
export function request(i: number, tenantId: string): DecisionRequest {
  const day = Math.floor((i * 37) % 365);
  const asOf = new Date(Date.UTC(2025, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
  return { decisionId: `${tenantId}-d${i}`, tenantId, requester: "svc", purpose: "credit_application", consumerId: consumerId(i), asOf, sources: registered() };
}
