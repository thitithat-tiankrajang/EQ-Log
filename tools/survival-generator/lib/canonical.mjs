// Canonical JSON and hashing, shared by the candidate schema and the source log.
import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level; arrays keep their order. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
