// The released recogniser in a REAL browser: raw logits from the browser's
// ONNX Runtime WASM, and the production recognition worker, both against the
// reference exported with the model. Blocking; the tolerance is the fixture's.
import { expect, test } from "@playwright/test";

test("the recogniser gives the reference answers in the browser", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one browser run is enough; it is the same WASM");
  test.setTimeout(120_000);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const probe = (await import(/* @vite-ignore */ "/tests/e2e/visionParityProbe.ts")) as {
      runParity: () => Promise<Record<string, unknown>>;
    };
    return probe.runParity();
  });
  expect(result.worstLogit as number).toBeLessThanOrEqual(result.tolerance as number);
  expect(result.sameTop3).toBe(true);
  expect(result.compared as number).toBeGreaterThanOrEqual(3);
  expect(result.worstP as number).toBeLessThanOrEqual(1e-4);
  expect(result.reading).toMatchObject({ decided: true, shift: 0 });
});
