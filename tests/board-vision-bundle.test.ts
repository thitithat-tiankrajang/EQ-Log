// @vitest-environment node
//
// ONNX Runtime and the recogniser reach the browser only when someone imports
// a board from a photo — the same leash tests/engine-in-browser.test.ts puts
// on the Super engine:
//
//   1. nothing of it is in the first load (index.html names none of it);
//   2. ONNX Runtime is inside the recognition worker's graph and nowhere else,
//      so the UI thread never runs inference;
//   3. the worker is started only from the photo-import flow's lazy chunk.
//
// Checked against `dist/` when a build is present (either with the photo
// import enabled or not).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const assets = join(process.cwd(), "dist/assets");
const built = existsSync(assets);
const files = built ? readdirSync(assets).filter((f) => f.endsWith(".js")) : [];
const read = (f: string) => readFileSync(join(assets, f), "utf8");

describe.runIf(built)("the recogniser in the production bundle", () => {
  it("is not part of the first load", () => {
    const html = readFileSync(join(process.cwd(), "dist/index.html"), "utf8");
    for (const name of [
      "ort.wasm",
      "ort-wasm",
      "recognizer.worker",
      "ImageImportFlow",
      ".wasm",
      "classifier.onnx",
    ]) {
      expect(html).not.toContain(name);
    }
  });

  it("keeps ONNX Runtime inside the recognition worker's graph", () => {
    const holders = files.filter((f) => read(f).includes("InferenceSession"));
    for (const f of holders) expect(f).toMatch(/^(recognizer\.worker|ort\.wasm\.bundle)/);
    const importers = files.filter((f) => /ort\.wasm\.bundle[^"']*\.js/.test(read(f)));
    for (const f of importers) expect(f).toMatch(/^recognizer\.worker/);
  });

  it("starts the worker only from the photo-import flow", () => {
    const starters = files.filter(
      (f) => !f.startsWith("recognizer.worker") && read(f).includes("recognizer.worker"),
    );
    for (const f of starters) expect(f).toMatch(/^ImageImportFlow/);
  });
});
