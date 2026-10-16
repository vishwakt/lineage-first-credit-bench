// The decision pipeline both designs share: retrieve each source, decode and normalize it,
// apply the quality layer, and run the model. Designs wrap this with their own capture
// (what they persist) and replay (how they reconstruct a past decision).

import { effectiveAt } from "../generator/calendar.ts";
import { adapterFor } from "../adapters/index.ts";
import type { Decoded } from "../adapters/types.ts";
import { decide, modelVersionAt } from "../decision/model.ts";
import { applyQuality, type QualityMode } from "../quality/layer.ts";
import { REASON_DICTIONARIES, type ReasonDictionary } from "../refdata/reasons.ts";
import { canonicalBytes } from "./canonical.ts";
import type { CreditFile, Decision, DecisionRequest, Part, Quarantined, SourceId } from "./types.ts";

export type Fetch = (source: SourceId, consumerId: string, asOf: string) => { bytes: Buffer; contentType: string };

export type Retrieval = {
  source: SourceId;
  bytes: Buffer;
  contentType: string;
  decoded: Decoded;
  refdataVersion: string | null;
  part: Part;
};

export type DecisionRun = {
  request: DecisionRequest;
  retrievals: Retrieval[];
  file: CreditFile;
  modelInput: Buffer;
  decision: Decision;
};

// The dictionary a running system has loaded at a given moment: the one in force then.
export function dictionaryAt(key: string | null, date: string): ReasonDictionary | null {
  return key ? effectiveAt(REASON_DICTIONARIES[key], date) : null;
}

export function retrieve(source: SourceId, bytes: Buffer, contentType: string, dict: ReasonDictionary | null): Retrieval {
  const adapter = adapterFor(source);
  const decoded = adapter.decode(bytes);
  return { source, bytes, contentType, decoded, refdataVersion: dict?.version ?? null, part: adapter.normalize(decoded, dict) };
}

export function assemble(
  consumerId: string,
  asOf: string,
  parts: Partial<Record<SourceId, Part>>,
  quality: QualityMode,
  modelVersion: string,
): { file: CreditFile; modelInput: Buffer; decision: Decision } {
  const q = applyQuality(parts, quality);
  const quarantined: Quarantined[] = q.quarantined;
  const file: CreditFile = { consumerId, asOf, parts: q.parts, quarantined };
  return { file, modelInput: canonicalBytes(file), decision: decide(file, modelVersion) };
}

export function runDecision(request: DecisionRequest, fetch: Fetch, quality: QualityMode): DecisionRun {
  const retrievals = request.sources.map((source) => {
    const { bytes, contentType } = fetch(source, request.consumerId, request.asOf);
    return retrieve(source, bytes, contentType, dictionaryAt(adapterFor(source).dictionary, request.asOf));
  });
  const parts: Partial<Record<SourceId, Part>> = {};
  for (const r of retrievals) parts[r.source] = r.part;
  const { file, modelInput, decision } = assemble(request.consumerId, request.asOf, parts, quality, modelVersionAt(request.asOf));
  return { request, retrievals, file, modelInput, decision };
}
