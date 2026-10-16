// Contract every source adapter implements. Adapters are shared by both designs: the
// designs differ only in what they capture around an adapter and how they replay it.

import type { Part, SourceId } from "../core/types.ts";
import type { ReasonDictionary } from "../refdata/reasons.ts";

export type Decoded = { formatVersion: string; record: unknown };

export type Adapter = {
  source: SourceId;
  // Recorded by the lineage design with every retrieval; bump on any behaviour change.
  version: string;
  // Key into REASON_DICTIONARIES when the source's codes need a dictionary to get texts.
  dictionary: string | null;
  // Bytes to the provider's own record shape (JSON compatible), detecting the format version.
  decode(bytes: Buffer): Decoded;
  // Provider record to the unified model.
  normalize(decoded: Decoded, dict: ReasonDictionary | null): Part;
};
