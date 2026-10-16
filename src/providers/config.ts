// Provider-side configuration of the synthetic world: wire-format versions over time
// (format drift) and fault rates for the alternative-data processors.

import type { SourceId } from "../generator/world.ts";

export type FaultType = "missed" | "double" | "timing";

export type WorldConfig = {
  seed: number;
  faults: Record<FaultType, number>; // probability per alternative-data record
};

export const DEFAULT_WORLD: WorldConfig = {
  seed: 20261015,
  faults: { missed: 0.01, double: 0.01, timing: 0.01 },
};

export const NO_FAULTS: WorldConfig["faults"] = { missed: 0, double: 0, timing: 0 };

export const FORMAT_VERSIONS: Record<SourceId, readonly { version: string; effective: string }[]> = {
  bureau_a: [
    { version: "1", effective: "2020-01-01" },
    { version: "2", effective: "2025-09-01" },
  ],
  bureau_b: [
    { version: "1", effective: "2020-01-01" },
    { version: "2", effective: "2025-03-01" },
  ],
  bureau_c: [
    { version: "1", effective: "2020-01-01" },
    { version: "2", effective: "2025-04-01" },
  ],
  rent_x: [
    { version: "1", effective: "2020-01-01" },
    { version: "2", effective: "2025-05-01" },
  ],
  utility_y: [
    { version: "1", effective: "2020-01-01" },
    { version: "2", effective: "2025-07-01" },
  ],
  bank_z: [{ version: "1", effective: "2020-01-01" }],
  telecom_t: [{ version: "1", effective: "2020-01-01" }],
  bnpl_q: [{ version: "1", effective: "2020-01-01" }],
};
