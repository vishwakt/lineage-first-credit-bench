// Which drift events separate a decision date from the replay date. The harness knows the
// provider configuration; the designs do not.

import { ADAPTERS } from "../../src/adapters/index.ts";
import { dictionaryAt } from "../../src/core/pipeline.ts";
import type { SourceId } from "../../src/core/types.ts";
import { effectiveAt } from "../../src/generator/calendar.ts";
import { FORMAT_VERSIONS } from "../../src/providers/config.ts";

export type Exposure = "refdata_drift" | "format_drift_only" | "no_drift";

export function exposure(sources: readonly SourceId[], asOf: string, now: string): Exposure {
  const refdata = sources.some((s) => {
    const key = ADAPTERS[s]!.dictionary;
    return key !== null && dictionaryAt(key, asOf)!.version !== dictionaryAt(key, now)!.version;
  });
  if (refdata) return "refdata_drift";
  const format = sources.some((s) => effectiveAt(FORMAT_VERSIONS[s], asOf).version !== effectiveAt(FORMAT_VERSIONS[s], now).version);
  return format ? "format_drift_only" : "no_drift";
}
