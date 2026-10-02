import { expect, test } from "@playwright/test";
import { available, browserCall, call, observe, player, policy, service, signIn } from "./fixtures";
import { decodeGame } from "../../src/codec";
test.skip(!available, "Disposable local stack required");

for (const seat of ["host", "A+host", "B+host"])
  test(`Physical ${seat}: authorized two-rack browser view, ordinary-player payload denial and no predictive bag`, async ({
    browser,
  }) => {
    const host = await player(),
      a = seat === "A+host" ? host : await player(),
      b = seat === "B+host" ? host : await player();
    const created = await call(host, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Physical browser capability",
        gameMode: "versus",
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
    const hc = await browser.newContext(),
      pc = await browser.newContext();
    try {
      const hp = await hc.newPage(),
        pp = await pc.newPage(),
        ordinary = host.id !== a.id ? a : b;
      const hs = observe(hp),
        ps = observe(pp);
      await signIn(hp, host);
      await signIn(pp, ordinary);
      await hp.goto(`/#/play/${id}`, { waitUntil: "domcontentloaded" });
      await pp.goto(`/#/play/${id}`, { waitUntil: "domcontentloaded" });
      const controls = hp.getByRole("region", { name: "Physical game controls" });
      await expect(controls).toBeVisible();
      for (const side of ["A", "B"]) {
        await hp.getByLabel("Physical player", { exact: true }).selectOption(side);
        await hp.getByLabel("Physical tiles", { exact: true }).fill("1 + 2 = 3 4 5 6");
        await hp.getByRole("button", { name: "Record physical draw", exact: true }).click();
        await expect(hp.getByLabel(`Current rack ${side}`, { exact: true })).toContainText(
          "1 · + · 2 · = · 3 · 4 · 5 · 6",
        );
      }
      await expect(pp.getByRole("region", { name: "Physical game controls" })).toHaveCount(0);
      const hostView = await browserCall(hp, host, { operation: "read", id });
      expect(hostView.body.match.hostRacks.A).toHaveLength(8);
      expect(hostView.body.match.hostRacks.B).toHaveLength(8);
      const denied = await browserCall(pp, ordinary, {
        operation: "read",
        id,
        role: "Host",
        host: true,
      });
      expect(denied.body.match.hostRacks).toBeUndefined();
      await Promise.all([hs.flush(), ps.flush()]);
      const privateState = decodeGame(
        (await service.from("room_live").select("state").eq("room_id", id).single()).data!.state,
      );
      const hostTraffic = JSON.stringify(hs.responses),
        playerTraffic = JSON.stringify(ps.responses);
      expect(hostTraffic).toContain('"hostRacks"');
      expect(hostTraffic + playerTraffic).not.toMatch(
        /"(?:tilebag|tilebagBefore|tilebagAfter|canonical|history|seed|rngStep)"\s*:/,
      );
      const otherRack = ordinary.id === a.id ? privateState.rackB : privateState.rackA;
      for (const tile of otherRack) expect(playerTraffic).not.toContain(`"${tile.id}"`);
      for (const tile of privateState.tilebag)
        expect(hostTraffic + playerTraffic).not.toContain(`"${tile.id}"`);
      hp.on("dialog", (d) => d.accept());
      await hp.getByRole("button", { name: "Finish game", exact: true }).click();
      await expect
        .poll(async () => (await call(a, { gameId: id }, "archive-replay")).status)
        .toBe(200);
    } finally {
      await hc.close();
      await pc.close();
    }
  });

test("Pass & Play UI conceals outgoing rack before confirmation, clears drafts and requires reload/second-tab handoff", async ({
  browser,
}) => {
  const owner = await player();
  const created = await call(owner, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("private"),
    settings: {
      name: "Pass & Play browser",
      gameMode: "versus",
      playerA: "A",
      playerB: "B",
      tileDrawMode: "play",
      startingSide: "A",
      untimed: true,
    },
  });
  expect(created.status).toBe(200);
  const id = created.body.id;
  await call(owner, { operation: "ready", id });
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const seen = observe(page);
    await signIn(page, owner);
    await page.goto(`/#/play/${id}`, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("button", { name: "A — confirm handoff", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "A — confirm handoff", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Pass", exact: true }).click();
    await page.getByRole("button", { name: "Submit Pass", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "B — confirm handoff", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".rack-slots")).toHaveCount(0);
    const plain = await browserCall(page, owner, { operation: "read", id });
    expect(plain.body.match.yourRack).toEqual([]);
    await page.getByRole("button", { name: "B — confirm handoff", exact: true }).click();
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    const tab = await context.newPage();
    await tab.goto(`/#/play/${id}`, { waitUntil: "domcontentloaded" });
    await expect(
      tab.getByRole("button", { name: "B — confirm handoff", exact: true }),
    ).toBeVisible();
    await tab.close();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "B — confirm handoff", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "B — confirm handoff", exact: true }).click();
    await page.getByRole("button", { name: "Pass", exact: true }).click();
    await page.getByRole("button", { name: "Submit Pass", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "A — confirm handoff", exact: true }),
    ).toBeVisible();
    await seen.flush();
    for (const response of seen.responses as any[])
      if (response.match) {
        expect(response.match.hostRacks).toBeUndefined();
        expect(response.match.yourRack.length).toBeLessThanOrEqual(8);
        if (!response.match.localConfirmed) expect(response.match.yourRack).toEqual([]);
      }
    const captured = await page.evaluate(() => (window as any).captured);
    expect(JSON.stringify(seen.responses) + JSON.stringify(captured)).not.toMatch(
      /"(?:rackA|rackB|tilebag|canonical|history|rngStep|seed)"\s*:/,
    );
    const view = (await call(owner, { operation: "read", id })).body.match;
    expect(
      (
        await call(owner, {
          operation: "admin",
          id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "finish" },
        })
      ).status,
    ).toBe(200);
    expect((await call(owner, { gameId: id }, "archive-replay")).status).toBe(200);
  } finally {
    await context.close();
  }
});

test("ArchBot browser Stage5B64 completes a real practice turn, with only the explicit current-bot-rack exception", async ({
  browser,
}) => {
  const human = await player();
  const created = await call(human, {
    operation: "create",
    requestId: crypto.randomUUID(),
    policy: policy("private"),
    settings: {
      name: "Client ArchBot practice",
      gameMode: "versus",
      playerA: "Human",
      playerB: "ArchBot",
      playerAUserId: human.id,
      botSide: "B",
      botEngine: "stage5b",
      botDifficulty: "stage5b64",
      startingSide: "A",
      tileDrawMode: "play",
      untimed: true,
    },
  });
  expect(created.status).toBe(200);
  const id = created.body.id;
  await call(human, { operation: "ready", id });
  const context = await browser.newContext();
  try {
    const page = await context.newPage(),
      seen = observe(page);
    await signIn(page, human);
    await page.goto(`/#/play/${id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Pass", exact: true }).click();
    await page.getByRole("button", { name: "Submit Pass", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await call(human, { operation: "read", id })).body.match.logs.some(
            (log: any) => log.side === "B",
          ),
        { timeout: 120000 },
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await seen.flush();
    const privateGame = decodeGame(
      (await service.from("room_live").select("state").eq("room_id", id).single()).data!.state,
    );
    const stored = await page.evaluate(() => (window as any).captured);
    const traffic = JSON.stringify(seen.responses) + JSON.stringify(stored);
    expect(traffic).not.toMatch(/"(?:rackA|rackB|tilebag|canonical|history|rngStep)"\s*:/);
    for (const tile of privateGame.tilebag) expect(traffic).not.toContain(`"${tile.id}"`);
    expect(
      seen.responses.some(
        (response: any) => response.match?.practiceBot?.request?.rack.length === 8,
      ),
    ).toBe(true);
    for (const response of seen.responses as any[])
      if (response.match) {
        expect(response.match.hostRacks).toBeUndefined();
        for (const log of response.match.logs)
          if (log.side === "B") {
            expect(log.rackBefore).toBeUndefined();
            expect(log.rackAfter).toBeUndefined();
          }
      }
    const view = (await call(human, { operation: "read", id })).body.match;
    expect(
      (
        await call(human, {
          operation: "action",
          id,
          revision: view.revision,
          commandId: crypto.randomUUID(),
          action: { kind: "resign" },
        })
      ).status,
    ).toBe(200);
    const replay = await call(human, { gameId: id }, "archive-replay");
    expect(replay.status).toBe(200);
    expect(replay.body.replay.bot.displayName).toBe("ArchBot");
  } finally {
    await context.close();
  }
});
