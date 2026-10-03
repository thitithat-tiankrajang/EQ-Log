import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createManualPlayers } from "../../tools/phase-a/local-accounts.mjs";
import { available, env } from "../live-security-browser/fixtures";

/**
 * LAN phone mode (node tools/phase-a/local.mjs phone). Two phone-sized browsers
 * load ONLY the LAN origin and play a real secured game: genuine local password
 * Auth, UI create/join/launch, Edge commands, Realtime commit broadcasts. Every
 * request and websocket is audited: none may target loopback or the stack's
 * own port, which a physical phone could not reach.
 */
const base = process.env.LAN_BASE_URL;
test.skip(!available || !base, "Disposable stack and LAN_BASE_URL (phone mode) required");

test("phone mode: a real secured game entirely through the LAN origin", async ({ browser }) => {
  test.setTimeout(240_000);
  const origin = new URL(base!).origin;
  const password = `Disposable-${randomUUID()}!`;
  const [a, b] = await createManualPlayers(password, env);
  const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
  const ca = await browser.newContext(phone),
    cb = await browser.newContext(phone);
  const pa = await ca.newPage(),
    pb = await cb.newPage();
  const urls: string[] = [];
  const sockets: string[] = [];
  const commits: string[] = [];
  for (const page of [pa, pb]) {
    page.on("request", (request) => urls.push(request.url()));
    page.on("websocket", (socket) => {
      sockets.push(socket.url());
      socket.on("framereceived", (frame) => {
        if (String(frame.payload).includes("commit")) commits.push(socket.url());
      });
    });
  }
  async function login(page: Page, email: string) {
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
    await page.getByLabel("Local email").fill(email);
    await page.getByLabel("Local password").fill(password);
    await page.getByRole("button", { name: "Sign in locally", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  }
  try {
    await login(pa, a.email);
    await login(pb, b.email);
    // The LAN page is not a secure context; the dev-only UUID fallback covers it.
    const context = await pa.evaluate(() => ({
      secure: window.isSecureContext,
      uuid: crypto.randomUUID(),
    }));
    expect(context.secure).toBe(false);
    expect(context.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    await pa.getByRole("link", { name: "Create game", exact: true }).click();
    await pa.locator('[data-choice="match"] a').click();
    await pa.getByRole("combobox", { name: "Opponent username", exact: true }).click();
    await pa.getByRole("option", { name: b.name, exact: true }).click();
    await pa.getByRole("button", { name: "Create room & get invite link", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    const gameURL = pa.url();
    expect(gameURL.startsWith(origin)).toBe(true);
    await pb.getByRole("link", { name: "Create game", exact: true }).click();
    await pb.getByRole("link", { name: "Have a code? Join a game", exact: true }).click();
    await pb.getByLabel("Room code or link").fill(gameURL);
    await pb.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(pb.getByRole("button", { name: "Ready", exact: true })).toBeVisible();
    await pa.getByRole("button", { name: "Ready", exact: true }).click();
    await expect(pb.getByText("A ready · B not ready", { exact: true })).toBeVisible();
    await pb.getByRole("button", { name: "Ready", exact: true }).click();
    await pa.getByRole("button", { name: "Launch game", exact: true }).click();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    await expect(pb.locator('.lg-shell[data-turn="thinking"]')).toBeVisible();

    // Real turns: A passes, B (refreshed by the Realtime commit) passes back.
    await pa.getByRole("button", { name: "Pass", exact: true }).tap();
    await pa.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await expect(pb.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    await pb.getByRole("button", { name: "Pass", exact: true }).tap();
    await pb.getByRole("button", { name: "Confirm pass", exact: true }).tap();
    await expect(pa.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
      timeout: 20_000,
    });
    await expect.poll(() => commits.length).toBeGreaterThan(0);

    const loopback = (url: string) => /\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]|:54521\b/.test(url);
    const offending = [...urls, ...sockets].filter(loopback);
    expect(offending).toEqual([]);
    const supabaseCalls = urls.filter((url) => /\/(auth|rest|functions|realtime)\/v1\//.test(url));
    expect(supabaseCalls.length).toBeGreaterThan(0);
    expect(supabaseCalls.every((url) => url.startsWith(origin))).toBe(true);
    expect(
      sockets.some((url) => url.startsWith(`${origin.replace("http", "ws")}/realtime/v1/`)),
    ).toBe(true);
    writeFileSync(
      "test-results/lan-phone-mode.json",
      JSON.stringify(
        {
          origin,
          requests: urls.length,
          supabaseCalls: supabaseCalls.length,
          websockets: [...new Set(sockets.map((url) => url.split("?")[0]))],
          realtimeCommitsReceived: commits.length,
          loopbackReferences: offending.length,
          secureContext: context.secure,
        },
        null,
        2,
      ),
    );
  } finally {
    await ca.close();
    await cb.close();
  }
});
