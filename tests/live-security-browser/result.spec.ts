import { expect, test } from "@playwright/test";
import { available, browserCall, call, player, policy, settings, signIn } from "./fixtures";

test.skip(!available, "Disposable local stack required");

test("terminal Result holds private Notes through archive notification until explicit Replay", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const a = await player(),
    b = await player();
  const created = await call(a, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("private"),
    settings: settings(a, b),
  });
  expect(created.status).toBe(200);
  const id = created.body.id;
  await call(a, { operation: "ready", id });
  const started = await call(b, { operation: "ready", id });
  expect(started.status).toBe(200);
  expect(started.body.match.status).toBe("playing");
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1440, height: 790 });
    page.setDefaultTimeout(15_000);
    await signIn(page, a);
    await page.goto(`/#/play/${id}`);
    await expect(page.locator(".lg-shell")).toBeVisible();
    await page.getByLabel("Private notes").fill("RESULT-LOCAL-NOTE-91");
    await page.getByRole("button", { name: "Match controls" }).click();
    await page.getByRole("button", { name: /^Surrender/ }).click();
    await page
      .getByRole("dialog", { name: "Surrender this game?" })
      .getByRole("button", { name: "Surrender", exact: true })
      .click();
    await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "finished");
    await expect(page.getByLabel("Private notes")).toHaveValue("RESULT-LOCAL-NOTE-91");
    const replay = await browserCall(page, a, { gameId: id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(JSON.stringify(replay.body)).not.toContain("RESULT-LOCAL-NOTE-91");
    // The same event raised by a late live read must not replace an on-screen Result.
    await page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent("eq-lab:archive-replay-ready", { detail }));
      window.dispatchEvent(new Event("focus"));
    }, replay.body);
    await expect(page.locator(".lg-shell")).toHaveAttribute("data-turn", "finished");
    await expect(page.getByLabel("Private notes")).toHaveValue("RESULT-LOCAL-NOTE-91");
    await page.getByRole("button", { name: "Open Replay", exact: true }).click();
    await expect(page.getByRole("region", { name: "Completed game replay" })).toBeVisible();
    await expect(page.locator(".lg-shell")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage)
            .filter((key) => key.startsWith("eq-lab:live-ws:v1:"))
            .some((key) => localStorage.getItem(key)?.includes("RESULT-LOCAL-NOTE-91")),
        ),
      )
      .toBe(false);
  } finally {
    await context.close();
  }
});
