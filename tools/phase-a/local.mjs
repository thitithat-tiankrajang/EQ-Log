// Explicit disposable-local helpers. Never read production configuration.
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { spawn, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "@playwright/test";

export const stack = "/private/tmp/eq-live-hidden-security-20261001";
export const statusFile = `${stack}/status.private.json`;
export function localEnvironment() {
  const env = JSON.parse(readFileSync(statusFile, "utf8"));
  if (env.API_URL !== "http://127.0.0.1:54521" || !env.DB_URL?.includes("127.0.0.1:54522/"))
    throw new Error("Refusing a backend other than the existing disposable Milestone-S stack.");
  return env;
}

export function frontendEnvironment(env) {
  return { ...process.env, VITE_SUPABASE_URL: env.API_URL, VITE_SUPABASE_ANON_KEY: env.ANON_KEY };
}

/**
 * DEV ONLY — physical-phone play on the same trusted Wi-Fi/LAN.
 *
 * From a phone, 127.0.0.1 is the phone itself, so the browser must never be
 * given a loopback URL. The dev server binds ONLY the Mac's private LAN address
 * and reverse-proxies the Supabase paths (Auth, REST, Edge Functions, Realtime
 * websockets, Storage) to the disposable stack on the Mac's loopback, so the
 * phone talks to exactly one origin: http://<LAN-IP>:<port>. Authentication is
 * the stack's genuine password Auth; nothing is injected or bypassed.
 */
export const PHONE_PORT = 5196;
const PRIVATE_LAN = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
export function lanAddress() {
  const candidates = Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter(
        (entry) => entry.family === "IPv4" && !entry.internal && PRIVATE_LAN.test(entry.address),
      )
      .map((entry) => ({ name, address: entry.address })),
  );
  // Prefer the usual Wi-Fi/Ethernet interface; never a public address.
  const chosen = candidates.find((item) => item.name === "en0") ?? candidates[0];
  if (!chosen)
    throw new Error(
      "No private LAN IPv4 address found. Connect the Mac to the same Wi-Fi as the phone.",
    );
  return chosen.address;
}
export function phoneEnvironment(env, address, port = PHONE_PORT) {
  const origin = `http://${address}:${port}`;
  return {
    ...process.env,
    // Same-origin: the browser only ever sees the LAN origin.
    VITE_SUPABASE_URL: origin,
    VITE_SUPABASE_ANON_KEY: env.ANON_KEY,
    VITE_EQ_LAN_DEV: "1",
    // Read only by vite.config.ts (server proxy); never exposed to the browser.
    EQ_LAN_PROXY_TARGET: env.API_URL,
  };
}

async function demo() {
  const env = localEnvironment();
  const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  async function player(name) {
    const email = `phase-a-${randomUUID()}@example.test`;
    const password = `Disposable-${randomUUID()}!`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error) throw new Error("Disposable account creation failed.");
    const id = created.data.user.id;
    // New disposable accounts only. No existing profiles or production flags.
    execFileSync(
      "psql",
      [
        env.DB_URL,
        "-v",
        "ON_ERROR_STOP=1",
        "-Atc",
        `update public.profiles set status='approved',display_name='${name}' where id='${id}'`,
      ],
      { stdio: "ignore" },
    );
    const auth = createClient(env.API_URL, env.ANON_KEY, { auth: { persistSession: false } });
    const signed = await auth.auth.signInWithPassword({ email, password });
    if (signed.error) throw new Error("Real local password authentication failed.");
    return { id, session: signed.data.session };
  }
  const suffix = randomUUID().slice(0, 8);
  const a = await player(`Local A ${suffix}`),
    b = await player(`Local B ${suffix}`);
  async function call(who, body) {
    const response = await fetch(`${env.API_URL}/functions/v1/live-game`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${who.session.access_token}`,
        apikey: env.ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok)
      throw new Error(
        `Disposable live-game request failed (${response.status}). Start the local Edge functions first.`,
      );
    return response.json();
  }
  const { id } = await call(a, {
    operation: "create",
    requestId: randomUUID(),
    policy: {
      accessScope: "private",
      archivePolicy: "private",
      joinPolicy: "invite_only",
      regionId: null,
    },
    settings: {
      name: "Phase A real local game",
      playerA: "Local A",
      playerB: "Local B",
      playerAUserId: a.id,
      playerBUserId: b.id,
      startingSide: "A",
      untimed: true,
      tileDrawMode: "play",
      emailPlayMode: "direct",
    },
  });
  const browser = await chromium.launch({ headless: process.env.PHASE_A_HEADLESS === "1" });
  try {
    const pages = [];
    for (const who of [a, b]) {
      const context = await browser.newContext();
      await context.addInitScript(
        (session) => localStorage.setItem("sb-127-auth-token", JSON.stringify(session)),
        who.session,
      );
      const page = await context.newPage();
      await page.goto(`http://127.0.0.1:5192/#/play/${id}`);
      await page.getByRole("button", { name: "Ready", exact: true }).waitFor();
      pages.push(page);
    }
    console.log("Real local authentication succeeded in two isolated browser sessions.");
    console.log(`Local game: http://127.0.0.1:5192/#/play/${id}`);
    console.log(
      "In each window click Ready; in Local A click Launch game. Ctrl+C closes only these browsers.",
    );
    if (process.env.PHASE_A_HEADLESS === "1") {
      for (const page of pages) {
        await page.getByRole("button", { name: "Ready", exact: true }).click();
        await page.getByRole("button", { name: "Unready", exact: true }).waitFor();
        // Each seat must observe the preceding revision before its command.
        if (page === pages[0])
          await pages[1].getByText("A ready · B not ready", { exact: true }).waitFor();
      }
      await pages[0].getByRole("button", { name: "Launch game", exact: true }).click();
      for (const page of pages) await page.locator(".lg-shell").waitFor();
      console.log("Real local two-player UI launch verified.");
      await browser.close();
      return;
    }
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void browser.close());
    await new Promise((resolve) => browser.once("disconnected", resolve));
  } finally {
    await browser.close();
  }
}

if (process.argv[1]?.endsWith("/phase-a/local.mjs")) {
  try {
    if (process.argv[2] === "app") {
      const child = spawn(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "5192", "--strictPort"],
        { stdio: "inherit", env: frontendEnvironment(localEnvironment()) },
      );
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
      child.once("exit", (code) => {
        process.exitCode = code ?? 0;
      });
    } else if (process.argv[2] === "phone") {
      const env = localEnvironment();
      const address = lanAddress();
      const functions = await fetch(`${env.API_URL}/functions/v1/live-game`, { method: "OPTIONS" })
        .then((response) => response.ok)
        .catch(() => false);
      const url = `http://${address}:${PHONE_PORT}/`;
      console.log("");
      console.log("EQ Lab — phone mode (DEV ONLY, trusted local network)");
      console.log(`  Open on your phone (same Wi-Fi):  ${url}`);
      console.log(
        `  Bound to ${address}:${PHONE_PORT} only; Supabase paths are proxied to the disposable stack.`,
      );
      if (!functions)
        console.log(
          "  WARNING: local Edge functions are not responding — start them first (see docs/phase-a-local-run).",
        );
      console.log("  Ctrl+C stops phone mode.\n");
      const child = spawn(
        process.execPath,
        [
          "node_modules/vite/bin/vite.js",
          "--host",
          address,
          "--port",
          String(PHONE_PORT),
          "--strictPort",
        ],
        { stdio: "inherit", env: phoneEnvironment(env, address) },
      );
      for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
      child.once("exit", (code) => {
        process.exitCode = code ?? 0;
      });
    } else if (process.argv[2] === "accounts") {
      const { provisionManualPlayers } = await import("./local-accounts.mjs");
      await provisionManualPlayers(localEnvironment());
    } else if (process.argv[2] === "demo") await demo();
    else throw new Error("Usage: node tools/phase-a/local.mjs app|phone|accounts|demo");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
