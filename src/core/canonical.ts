// Canonical JSON: object keys sorted, no whitespace. Model inputs are compared as the
// bytes of their canonical form, so two semantically equal files always match.

import { createHash } from "node:crypto";

export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(obj[k])).join(",") + "}";
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonical(value), "utf8");
}

export function sha256(bytes: Buffer | string): Buffer {
  return createHash("sha256").update(bytes).digest();
}

export function sha256hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
