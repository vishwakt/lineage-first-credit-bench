// Registry of source adapters. Adding a source adds one adapter module and one line here.

import type { SourceId } from "../core/types.ts";
import type { Adapter } from "./types.ts";
import { bureauA } from "./bureau_a.ts";

export const ADAPTERS: Partial<Record<SourceId, Adapter>> = {
  bureau_a: bureauA,
};

export function adapterFor(source: SourceId): Adapter {
  const a = ADAPTERS[source];
  if (!a) throw new Error(`no adapter registered for ${source}`);
  return a;
}
