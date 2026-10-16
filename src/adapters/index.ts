// Registry of source adapters. Adding a source adds one adapter module and one line here.

import type { SourceId } from "../core/types.ts";
import type { Adapter } from "./types.ts";
import { bureauA } from "./bureau_a.ts";
import { bureauB } from "./bureau_b.ts";
import { bureauC } from "./bureau_c.ts";
import { rentX } from "./rent_x.ts";
import { utilityY } from "./utility_y.ts";
import { bankZ } from "./bank_z.ts";

export const ADAPTERS: Partial<Record<SourceId, Adapter>> = {
  bureau_a: bureauA,
  bureau_b: bureauB,
  bureau_c: bureauC,
  rent_x: rentX,
  utility_y: utilityY,
  bank_z: bankZ,
};

export function adapterFor(source: SourceId): Adapter {
  const a = ADAPTERS[source];
  if (!a) throw new Error(`no adapter registered for ${source}`);
  return a;
}
