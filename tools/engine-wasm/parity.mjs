// Run one engine request through BOTH builds and compare.
//
// The WASM build and the native binary are the same C++ compiled twice. Where
// the work is bounded by sample count rather than wall clock, they should agree
// exactly — so a disagreement means a real difference, not a timing artifact.
//
//   node tools/engine-wasm/parity.mjs request.json [path/to/amath_cli]
//
// Development tool. Not imported by the application.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [, , requestPath, binaryArg] = process.argv;
if (!requestPath) {
  console.error("usage: node tools/engine-wasm/parity.mjs <request.json> [amath_cli]");
  process.exit(2);
}

const binary = binaryArg ?? "../amath-engine/build/amath_cli";
const request = JSON.parse(readFileSync(requestPath, "utf8"));
if (request.budgetMs && !request.sampleCap) {
  console.warn(
    "warning: this request is bounded by budgetMs, so the two builds may legitimately " +
      "stop at different sample counts. Add sampleCap for an exact comparison.",
  );
}

const native = JSON.parse(
  execFileSync(binary, ["worker"], { input: JSON.stringify(request), encoding: "utf8" }),
);

const require = createRequire(import.meta.url);
const createModule = (await import("./amath_engine.mjs")).default;
const module = await createModule();
const text = JSON.stringify(request);
const bytes = module.lengthBytesUTF8(text) + 1;
const inPtr = module._engine_alloc(bytes);
module.stringToUTF8(text, inPtr, bytes);
const outPtr = module._engine_handle(inPtr);
const wasm = JSON.parse(module.UTF8ToString(outPtr));
module._engine_free(inPtr);
module._engine_free(outPtr);
void require;

const describe = (result) =>
  result.type === "place"
    ? `place ${result.placements.map((p) => `${p.token}@${p.r},${p.c}`).join(" ")} = ${result.score}`
    : result.type === "exchange"
      ? `exchange ${result.exchange.join(" ")}`
      : "pass";

const agree =
  native.type === wasm.type &&
  native.score === wasm.score &&
  JSON.stringify(native.placements) === JSON.stringify(wasm.placements) &&
  JSON.stringify(native.exchange) === JSON.stringify(wasm.exchange);

console.log(`native: ${describe(native)}  (${native.solver}, ${native.stats.samples} samples)`);
console.log(`wasm:   ${describe(wasm)}  (${wasm.solver}, ${wasm.stats.samples} samples)`);
console.log(agree ? "AGREE" : "DISAGREE");
process.exit(agree ? 0 : 1);
