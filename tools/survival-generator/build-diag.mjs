// A diagnostics view of the SAME compiled rules bundle the simulator runs.
//
// The Scoring Opportunity diagnostics need three functions the simulator bundle
// compiles but does not export (the move generator's rich output, the premium
// layout and tile points). Rebuilding from source would risk a different
// program, so this copies `.vendor/authur-rules.mjs` byte for byte and appends
// one export line. The code the diagnostics call is therefore exactly the code
// the experiments ran.
//
// Run: node tools/survival-generator/build-diag.mjs
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const vendor = resolve(import.meta.dirname, ".vendor");
const base = await readFile(resolve(vendor, "authur-rules.mjs"), "utf8");
for (const name of ["async function generateMovesIncremental(", "function slotAt(", "var TOKENS = {"]) {
  if (!base.includes(name)) throw new Error(`base bundle has no top-level ${name}`);
}
const out = `${base}\nexport { generateMovesIncremental, slotAt, TOKENS };\n`;
await writeFile(resolve(vendor, "authur-rules-diag.mjs"), out);
const sha = (text) => createHash("sha256").update(text).digest("hex");
const codeOnly = (text) => text.split("\n").filter((line) => !line.startsWith("//")).join("\n");
console.log(JSON.stringify({
  baseSha256: sha(base),
  baseCodeSha256: sha(codeOnly(base)),
  diagSha256: sha(out),
}, null, 2));
