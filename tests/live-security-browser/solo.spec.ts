import { expect, test } from "@playwright/test";
import { available, browserCall, call, observe, player, policy, signIn, sql } from "./fixtures";
test.skip(!available, "Disposable local stack required");

for (const hosted of [false, true])
  test(`${hosted ? "Hosted" : "self-directed"} Solo: two browsers, one-seat start, reload/tab/stale/duplicate, private lifecycle and Replay`, async ({
    browser,
  }) => {
    const a = await player(),
      host = hosted ? await player() : a;
    const created = await call(host, {
      operation: "create",
      requestId: crypto.randomUUID(),
      policy: policy("private"),
      settings: {
        name: "Solo browser gate",
        gameMode: "solo",
        playerA: "Solo",
        playerB: "",
        playerAUserId: a.id,
        startingSide: "A",
        tileDrawMode: "play",
        emailPlayMode: hosted ? "hosted" : undefined,
        untimed: true,
      },
    });
    expect(created.status).toBe(200);
    const id = created.body.id;
    expect((await call(a, { operation: "ready", id })).body.match.status).toBe("playing");
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    try {
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      const seen = pages.map(observe);
      for (const [index, who] of [a, host].entries()) {
        await signIn(pages[index]!, who);
        await pages[index]!.goto(`/#/play/${id}`);
      }
      await expect(pages[0]!.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
      const before = (await browserCall(pages[0]!, a, { operation: "read", id })).body.match;
      const command = {
        operation: "action",
        id,
        revision: before.revision,
        commandId: crypto.randomUUID(),
        action: { kind: "pass" },
      };
      expect((await browserCall(pages[0]!, a, command)).status).toBe(200);
      expect((await browserCall(pages[0]!, a, command)).status).toBe(200);
      const moved = (await call(a, { operation: "read", id })).body.match;
      expect(moved.revision).toBe(before.revision + 1);
      expect(moved.activeSide).toBe("A");
      expect(
        (await browserCall(pages[0]!, a, { ...command, commandId: crypto.randomUUID() })).status,
      ).toBe(409);
      await expect(pages[1]!.locator(".topbar-status")).toContainText(`ตา ${moved.turnNumber}`);
      await contexts[0]!.setOffline(true);
      await contexts[0]!.setOffline(false);
      await pages[0]!.reload();
      const tab = await contexts[0]!.newPage();
      await tab.goto(`/#/play/${id}`);
      await expect(tab.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
      await tab.close();
      const hostView = (await browserCall(pages[1]!, host, { operation: "read", id })).body.match;
      expect(hostView.canAdminister).toBe(true);
      if (hosted) expect(hostView.yourRack).toEqual([]);
      await pages[1]!.getByRole("button", { name: "Pause game", exact: true }).click();
      await expect(pages[0]!.getByRole("button", { name: "Pass", exact: true })).toBeDisabled();
      await pages[1]!.reload();
      await pages[1]!.getByRole("button", { name: "Resume game", exact: true }).click();
      await expect(pages[0]!.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
      for (let i = 0; i < pages.length; i++) {
        await seen[i]!.flush();
        expect(JSON.stringify(seen[i]!.responses)).not.toMatch(
          /"(?:rackA|rackB|tilebag|canonical|history|session|seed|rngStep)"\s*:/,
        );
        const stored = await pages[i]!.evaluate(() => (window as any).captured);
        expect(JSON.stringify(stored)).not.toMatch(
          /"(?:rackA|rackB|tilebag|canonical|history|seed|rngStep)"\s*:/,
        );
      }
      pages[1]!.on("dialog", (dialog) => dialog.accept());
      await pages[1]!.getByRole("button", { name: "Finish game", exact: true }).click();
      await expect
        .poll(() => sql(`select count(*) from public.room_live where room_id='${id}'`))
        .toBe("0");
      const replay = await call(a, { gameId: id }, "archive-replay");
      expect(replay.status).toBe(200);
      expect(replay.body.replay.finalRacks.A).toHaveLength(8);
      expect(replay.body.replay.positions.length).toBeGreaterThan(1);
      expect(sql(`select count(*) from public.game_history where source_id='${id}'`)).toBe("1");
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  });
