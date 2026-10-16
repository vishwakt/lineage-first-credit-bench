// Entry point to the simulated outside world. Systems under test receive only the bytes
// and content type; the format version and injected faults are ground truth for the harness.

import { consumer, consumerIndex, type SourceId } from "../generator/world.ts";
import { bnplQ, bankZ, rentX, telecomT, utilityY, type InjectedFault } from "./alt.ts";
import { bureauA, bureauB, bureauC } from "./bureaus.ts";
import type { WorldConfig } from "./config.ts";

export type ProviderResponse = { bytes: Buffer; contentType: string };
export type ProviderTruth = { formatVersion: string; faults: InjectedFault[] };

const CONTENT_TYPE: Record<SourceId, string> = {
  bureau_a: "application/json",
  bureau_b: "text/plain; charset=latin1",
  bureau_c: "application/xml",
  rent_x: "text/csv",
  utility_y: "application/x-ndjson",
  bank_z: "application/json",
  telecom_t: "text/plain; charset=latin1",
  bnpl_q: "application/xml",
};

export function fetchFromProvider(
  cfg: WorldConfig,
  source: SourceId,
  consumerId: string,
  asOf: string,
): { response: ProviderResponse; truth: ProviderTruth } {
  const c = consumer(cfg.seed, consumerIndex(consumerId));
  let out: { bytes: Buffer; formatVersion: string; faults?: InjectedFault[] };
  switch (source) {
    case "bureau_a": out = bureauA(cfg.seed, c, asOf); break;
    case "bureau_b": out = bureauB(cfg.seed, c, asOf); break;
    case "bureau_c": out = bureauC(cfg.seed, c, asOf); break;
    case "rent_x": out = rentX(cfg, c, asOf); break;
    case "utility_y": out = utilityY(cfg, c, asOf); break;
    case "bank_z": out = bankZ(cfg, c, asOf); break;
    case "telecom_t": out = telecomT(cfg, c, asOf); break;
    case "bnpl_q": out = bnplQ(cfg, c, asOf); break;
  }
  return {
    response: { bytes: out.bytes, contentType: CONTENT_TYPE[source] },
    truth: { formatVersion: out.formatVersion, faults: out.faults ?? [] },
  };
}
