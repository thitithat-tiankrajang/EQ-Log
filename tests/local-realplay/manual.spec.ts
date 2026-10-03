import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { createManualPlayers } from "../../tools/phase-a/local-accounts.mjs";
import { available, env, service, observe } from "../live-security-browser/fixtures";
import { decodeGame } from "../../src/codec";
import type { LiveGameView } from "../../src/liveGame/projection";
import { RealtimeClient } from "@supabase/realtime-js";

test.skip(!available, "Existing disposable Milestone-S stack required");
const evidence = "docs/evidence/local-real-play";

test("local password UI still rejects invalid credentials, unapproved accounts and anonymous authority requests", async ({
  page,
}) => {
  const email = `pending-${randomUUID()}@example.test`,
    password = `Disposable-${randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  expect(created.error).toBeNull();
  await page.goto("/");
  await page.getByLabel("Local email").fill(email);
  await page.getByLabel("Local password").fill(`Wrong-${randomUUID()}`);
  await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(/Invalid login credentials/);
  await page.getByLabel("Local password").fill(password);
  await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose your name" })).toBeVisible();
  await page.getByLabel("Display name").fill(`Pending ${randomUUID().slice(0, 8)}`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approval pending" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toHaveCount(0);
  const denied = await fetch(`${env.API_URL}/functions/v1/live-game`, {
    method: "POST",
    headers: {
      apikey: env.ANON_KEY,
      Authorization: `Bearer ${env.ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ operation: "read", id: randomUUID() }),
  });
  expect(denied.status).toBe(401);
});

async function login(page: Page, email: string, password: string) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
  await page.getByLabel("Local email").fill(email);
  await page.getByLabel("Local password").fill(password);
  await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
}

test("fresh manual login → normal Create/Join → secured live turns → refresh/reconnect", async ({
  browser,
}) => {
  mkdirSync(evidence, { recursive: true });
  const password = `Disposable-${randomUUID()}!`;
  const [a, b] = await createManualPlayers(password, env);
  const ca = await browser.newContext(),
    cb = await browser.newContext();
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  const oa = observe(pa),
    ob = observe(pb);
  const joinsA: string[] = [],
    joinsB: string[] = [];
  type Commit = {
    topic: string;
    payload: { event: string; payload: { gameId: string; revision: number; id: string } };
  };
  const commitsA: Commit[] = [],
    commitsB: Commit[] = [];
  // Decode actual binary broadcasts with the installed SDK's serializer.
  const serializer = new RealtimeClient(`${env.API_URL}/realtime/v1`, {
    params: { apikey: env.ANON_KEY },
  }).serializer;
  for (const [page, joins, commits] of [
    [pa, joinsA, commitsA],
    [pb, joinsB, commitsB],
  ] as const)
    page.on("websocket", (socket) => {
      if (!socket.url().includes("/realtime/v1/websocket")) return;
      socket.on("framesent", (frame) => joins.push(String(frame.payload)));
      socket.on("framereceived", (frame) => {
        const raw =
          typeof frame.payload === "string"
            ? frame.payload
            : frame.payload.buffer.slice(
                frame.payload.byteOffset,
                frame.payload.byteOffset + frame.payload.byteLength,
              );
        serializer.decode(raw, (message: Commit) => {
          if (message?.payload?.event === "commit") commits.push(message);
        });
      });
    });
  try {
    await pa.goto("/");
    await expect(pa.getByRole("form", { name: "Disposable local sign-in" })).toBeVisible();
    await pa.screenshot({ path: `${evidence}/local-sign-in.png` });
    expect((await new AxeBuilder({ page: pa }).analyze()).violations).toEqual([]);
    await login(pa, a.email, password);
    await login(pb, b.email, password);
    await pa.getByRole("link", { name: "Create game", exact: true }).click();
    await pa.locator('[data-choice="match"] a').click();
    await expect(pa.getByRole("region", { name: "Room setup" })).toBeVisible();
    await pa.getByRole("combobox", { name: "Opponent username", exact: true }).click();
    await pa.getByRole("option", { name: b.name, exact: true }).click();
    await pa.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    const gameURL = pa.url();
    const id = gameURL.match(/(?:play|room)\/([a-f0-9-]{36})/)?.[1];
    expect(Boolean(id)).toBe(true);

    // Join through the normal form, using the host's link; not a direct API creation/join.
    await pb.getByRole("link", { name: "Create game", exact: true }).click();
    await pb.getByRole("link", { name: "Have a code? Join a game", exact: true }).click();
    await pb.getByLabel("Room code or link").fill(gameURL);
    const joined = pb.waitForResponse(
      (response) => response.url().includes("/rpc/join_live_game") && response.status() === 200,
    );
    await pb.getByRole("button", { name: "Join room", exact: true }).click();
    await joined;
    await expect(pb.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    await pa.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pb.getByText("A ready · B not ready", { exact: true })).toBeVisible();
    await pb.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Launch game", exact: true })).toBeEnabled();
    await pa.getByRole("button", { name: "Launch game", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await expect(pb.locator('.lg-shell[data-turn="thinking"]')).toBeVisible();

    async function secrecy() {
      await Promise.all([oa.flush(), ob.flush()]);
      const row = await service
        .from("room_live")
        .select("state,revision,authority_protocol,player_a_user_id,player_b_user_id")
        .eq("room_id", id)
        .single();
      expect(row.error).toBeNull();
      expect(row.data!.authority_protocol).toBe("server-v1");
      expect(row.data!.player_a_user_id === a.id && row.data!.player_b_user_id === b.id).toBe(true);
      const canonical = decodeGame(row.data!.state);
      for (const [seen, side, other, joins] of [
        [oa, "A", "B", joinsA],
        [ob, "B", "A", joinsB],
      ] as const) {
        const view = [...seen.responses]
          .reverse()
          .map((response) => response as { match?: LiveGameView })
          .find((response) => response.match?.revision === row.data!.revision);
        expect(Boolean(view)).toBe(true);
        expect(view!.match!.yourSide).toBe(side);
        const ownRack = side === "A" ? canonical.rackA : canonical.rackB;
        const otherRack = other === "A" ? canonical.rackA : canonical.rackB;
        expect(
          JSON.stringify(view!.match!.yourRack.map((tile) => tile.id).sort()) ===
            JSON.stringify(ownRack.map((tile) => tile.id).sort()),
        ).toBe(true);
        const wire = JSON.stringify(view);
        expect(otherRack.some((tile) => wire.includes(JSON.stringify(tile.id)))).toBe(false);
        // An exchanged own tile can be back in the bag and remain in lawful own logs.
        const known = new Set(view!.match!.yourRack.map((tile) => tile.id));
        for (const log of view!.match!.logs)
          for (const tile of [...(log.rackBefore ?? []), ...(log.rackAfter ?? [])])
            known.add(tile.id);
        expect(
          canonical.tilebag.some(
            (tile) => !known.has(tile.id) && wire.includes(JSON.stringify(tile.id)),
          ),
        ).toBe(false);
        expect(JSON.stringify(seen.responses)).not.toMatch(
          /"(?:tilebag|canonical|history|rngStep|rngSeed|hostRacks)"\s*:/,
        );
        expect(
          joins.some((frame) => frame.includes(`game:${id}`) && frame.includes('"private":true')),
        ).toBe(true);
      }
      return row.data!.revision;
    }
    await secrecy();
    await pa.setViewportSize({ width: 1280, height: 560 });
    await pa.screenshot({ path: `${evidence}/real-live-short-desktop.png` });
    await pb.setViewportSize({ width: 390, height: 844 });
    await pb.screenshot({ path: `${evidence}/real-live-thinking-mobile.png` });
    for (const page of [pa, pb]) {
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    // A exchanges one tile; B passes; A passes; B refreshes/reconnects then passes.
    await pa.getByRole("button", { name: "Exchange", exact: true }).click();
    await pa.locator('.lg-rack [data-rack-slot="0"]').click();
    await pa.getByRole("button", { name: "Exchange 1 tile", exact: true }).click();
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    const revisions: number[] = [await secrecy()];
    async function pass(page: Page, next: Page) {
      await page.getByRole("button", { name: "Pass", exact: true }).click();
      await page.getByRole("button", { name: "Confirm pass", exact: true }).click();
      await expect(next.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
      revisions.push(await secrecy());
    }
    await pass(pb, pa);
    await expect
      .poll(() =>
        [commitsA, commitsB].every((commits) =>
          commits.some(
            (frame) => frame.topic === `realtime:game:${id}` && frame.payload.payload.gameId === id,
          ),
        ),
      )
      .toBe(true);
    for (const commit of [...commitsA, ...commitsB]) {
      // Installed realtime.send adds a generated transport UUID to the app's two fields.
      expect(Object.keys(commit.payload.payload).sort()).toEqual(["gameId", "id", "revision"]);
      expect(commit.payload.payload.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    await pa.reload();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    expect(pa.url().includes(id!)).toBe(true);
    await pass(pa, pb);
    await cb.setOffline(true);
    await cb.setOffline(false);
    await pb.reload();
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled();
    await pass(pb, pa);
    expect(revisions.every((revision, index) => !index || revision > revisions[index - 1])).toBe(
      true,
    );
    writeFileSync(
      `${evidence}/verification.json`,
      JSON.stringify(
        {
          base: "http://127.0.0.1:5192",
          backend: "disposable Milestone-S",
          freshUIAuth: true,
          uiCreate: true,
          uiJoin: true,
          readyLaunch: true,
          actions: ["A exchange 1", "B pass", "A pass", "B reconnect + pass"],
          revisions,
          ownRackVerified: true,
          opponentRackAbsent: true,
          futureBagAbsent: true,
          privateRealtime: true,
          resize: ["1280x560", "390x844"],
          refresh: true,
          reconnect: true,
          loginAxe: "pass",
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await ca.close();
    await cb.close();
  }
});
