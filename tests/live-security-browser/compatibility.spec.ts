import { expect, test } from "@playwright/test";
import { available, call, observe, player, policy, signIn } from "./fixtures";
test.skip(!available, "Disposable stack required");
test.use({ actionTimeout: 15000 });
for (const mobile of [false, true])
  test(`draft drag, reorder, swap, return, own Replay/practice and Coffee Return (${mobile ? "touch" : "mouse"})`, async ({
    browser,
  }) => {
    const a = await player(),
      b = await player();
    const created = await call(a, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Draft compatibility",
        playerA: "A",
        playerB: "B",
        playerAUserId: a.id,
        playerBUserId: b.id,
        emailPlayMode: "hosted",
        tileDrawMode: "manual",
        startingSide: "A",
        untimed: true,
      },
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    await call(a, { operation: "ready", id });
    await call(b, { operation: "ready", id });
    const context = await browser.newContext(
      mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
    );
    try {
      const page = await context.newPage(),
        seen = observe(page);
      await signIn(page, a);
      await page.goto(`/#/play/${id}`);
      // Phones keep the game tools in a Sheet opened from below the board.
      if (mobile) await page.getByRole("button", { name: "Game tools", exact: true }).click();
      for (const side of ["A", "B"]) {
        await page.getByLabel("Physical player", { exact: true }).selectOption(side);
        await page.getByLabel("Physical tiles", { exact: true }).fill("1 + 2 = 3 4 5 6");
        await page.getByRole("button", { name: "Record physical draw", exact: true }).click();
        await expect(page.getByLabel(`Current rack ${side}`, { exact: true })).toContainText(
          "1 · + · 2 · = · 3 · 4 · 5 · 6",
        );
      }
      if (mobile) await page.getByRole("button", { name: "Close", exact: true }).click();
      const tiles = page.locator(".rack-tiles [data-draft-tile-id]");
      await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
      const first = await tiles.first().getAttribute("data-draft-tile-id");
      async function drag(
        source: import("@playwright/test").Locator,
        target: import("@playwright/test").Locator,
      ) {
        if (mobile) {
          const touch = await context.newCDPSession(page);
          await source.evaluate((el) => el.scrollIntoView({ block: "center" }));
          const start = await source.boundingBox();
          await touch.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [{ x: start!.x + start!.width / 2, y: start!.y + start!.height / 2 }],
          });
          await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
          const end = await target.boundingBox();
          const point = { x: end!.x + end!.width / 2, y: end!.y + end!.height / 2 };
          await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
          await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          await touch.detach();
        } else {
          await source.evaluate((el) => el.scrollIntoView({ block: "center" }));
          const start = await source.boundingBox();
          await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
          await page.mouse.down();
          await target.evaluate((el) => el.scrollIntoView({ block: "center" }));
          const end = await target.boundingBox();
          await page.mouse.move(end!.x + end!.width / 2, end!.y + end!.height / 2, { steps: 8 });
          await page.mouse.up();
        }
      }
      const cell = (col: number) => page.locator(`[data-board-row="7"][data-board-col="${col}"]`);
      await drag(tiles.first(), cell(7));
      await expect(cell(7)).toHaveAttribute("data-draft-tile-id", first!);
      await drag(cell(7), cell(8));
      await expect(cell(8)).toHaveAttribute("data-draft-tile-id", first!);
      const second = await tiles.first().getAttribute("data-draft-tile-id");
      await drag(tiles.first(), cell(7));
      await drag(cell(8), cell(7));
      await expect(cell(7)).toHaveAttribute("data-draft-tile-id", first!);
      await expect(cell(8)).toHaveAttribute("data-draft-tile-id", second!);
      await drag(cell(7), page.locator('.rack-tiles [data-rack-slot="0"]'));
      await expect(cell(7)).not.toHaveAttribute("data-draft-tile-id", first!);
      await page
        .getByRole("button", { name: mobile ? "Cancel placement" : "Cancel", exact: true })
        .first()
        .click();
      await page.getByRole("button", { name: "Pass", exact: true }).click();
      await page
        .getByRole("button", { name: mobile ? "Confirm pass" : "Submit Pass", exact: true })
        .click();
      await expect(page.locator(".turn-record-summary")).toHaveCount(1);
      await page.locator(".turn-record-summary").click();
      await page.getByRole("button", { name: "Before this turn", exact: true }).click();
      await page.getByRole("button", { name: "Practice this position", exact: true }).click();
      await expect(page.getByRole("region", { name: "Own-rack live practice" })).toBeVisible();
      await page.getByRole("button", { name: "Close practice", exact: true }).click();
      await page.getByRole("button", { name: "Game menu", exact: true }).click();
      await page.getByRole("button", { name: "Coffee Break", exact: true }).click();
      await expect(page.getByRole("button", { name: "Return to game", exact: true })).toBeVisible();
      expect((await call(a, { operation: "read", id })).body.match.paused).toBe(false);
      await page.getByRole("button", { name: "Return to game", exact: true }).click();
      await expect(page.locator(".topbar-status")).toBeVisible({ timeout: 20000 });
      await seen.flush();
      expect(JSON.stringify(seen.responses)).not.toMatch(
        /"(?:tilebag|canonical|history|rngStep)"\s*:/,
      );
    } finally {
      await context.close();
    }
  });
