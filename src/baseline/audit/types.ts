// Contract for one integration's own audit log in the baseline design. Each integration
// owns a table (created by its own migration) with columns chosen for that source.

import type { Retrieval } from "../../core/pipeline.ts";
import type { SourceId } from "../../core/types.ts";

export type SourceAudit = {
  source: SourceId;
  table: string;
  // Text encoding this integration uses when it keeps the raw payload (capture mode "raw").
  encoding: BufferEncoding;
  // Integration-specific columns, beyond the shared ones every audit table carries.
  columns(r: Retrieval): Record<string, unknown>;
};
