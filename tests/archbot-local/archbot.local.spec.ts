// ArchBot in the real app against an isolated local Supabase stack: found on Home
// from the bot catalogue, a free room, turns computed on the device and committed
// through the ordinary path, exactly one commit per position through reloads and
// a second tab, a model that fails to load stopping it truthfully, the ordinary
// board limit, no engine service, no economy, no Stage. See
// tests/archbot-local/README.md.
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const API = process.env.ARCHBOT_LOCAL_API_URL ?? "http://127.0.0.1:54721";
const DB =
  process.env.ARCHBOT_LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54722/postgres";
const ANON = process.env.ARCHBOT_LOCAL_ANON_KEY ?? "";
const SERVICE = process.env.ARCHBOT_LOCAL_SERVICE_KEY ?? "";
const PSQL = process.env.ARCHBOT_LOCAL_PSQL ?? "psql";

test.skip(
  !ANON || !SERVICE,
  "needs an isolated local Supabase stack (tests/archbot-local/README.md)",
);
if (!/127\.0\.0\.1|localhost/.test(DB)) throw new Error("refusing: not a local database");

const sql = (query: string) =>
  execFileSync(PSQL, [DB, "-v", "ON_ERROR_STOP=1", "-Atc", query], { encoding: "utf8" }).trim();

async function auth(path: string, body: unknown, key: string) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

let userId = "";
let session: { access_token: string } | undefined;

// A fresh account for every test: each holds at most three active boards.
test.beforeEach(async () => {
  // An ephemeral, approved account on the local stack only. Never printed.
  const email = `archbot-e2e-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const user = await auth(
    "/auth/v1/admin/users",
    { email, password, email_confirm: true },
    SERVICE,
  );
  userId = user.id;
  sql(`update public.profiles set status = 'approved', display_name = 'ArchBot E2E ${userId.slice(0, 6)}'
       where id = '${userId}'`);
  session = await auth("/auth/v1/token?grant_type=password", { email, password }, ANON);
});

type Event = { revision: number; issued_by: string; kind: string };
const events = (roomId: string): Event[] =>
  JSON.parse(
    sql(`select coalesce(json_agg(json_build_object('revision', revision, 'issued_by', issued_by,
           'kind', command ->> 'kind') order by revision), '[]') from public.live_game_events
         where game_id = '${roomId}'`),
  );

const room = (roomId: string) =>
  JSON.parse(
    sql(`select row_to_json(r) from (select room_id, revision, bot_key, bot_side, bot_access_tier,
           bot_execution_type, room_purpose, mode_key, state ->> 'botEngine' as bot_engine,
           state ->> 'botDifficulty' as bot_difficulty, canonical ->> 'activeSide' as active_side
         from public.room_live where room_id = '${roomId}') r`),
  );

/** The committed turn log (side and action per turn), from the stored game. */
const turnLog = (roomId: string): Array<{ side: string; action: string }> =>
  JSON.parse(
    sql(`select coalesce(json_agg(json_build_object('side', l ->> 'side', 'action', l ->> 'action')), '[]')
         from public.room_live r, jsonb_array_elements(r.state -> 'logs') l
         where r.room_id = '${roomId}'`),
  );

/** ArchBot's (side B's) turns. */
const botTurns = (roomId: string) => turnLog(roomId).filter((turn) => turn.side === "B");

async function signedIn(page: Page) {
  await page.addInitScript((stored) => {
    window.localStorage.setItem("sb-127-auth-token", JSON.stringify(stored));
  }, session);
}

const serverBotCalls: string[] = [];
function watchNetwork(page: Page) {
  page.on("request", (request) => {
    if (/bot-move|\/v1\/games\//.test(request.url())) serverBotCalls.push(request.url());
  });
}

/** The player's way in: Home's AI opponents (from the bot catalogue), then a space. */
async function openArchBotSetup(page: Page) {
  await page.goto("/#/");
  const bots = page.getByRole("region", { name: "Play against AI" });
  await bots.getByRole("link", { name: /Play ArchBot/ }).click();
  await expect(page).toHaveURL(/#\/create\?mode=archbot/);
  await page.getByRole("button", { name: /^Public/ }).click();
}

const ownedRooms = () => sql(`select count(*) from public.room_live where owner_id = '${userId}'`);

async function createArchBotRoom(page: Page): Promise<string> {
  await openArchBotSetup(page);
  await page.getByRole("radio", { name: "ArchBot" }).click(); // ArchBot starts
  await page.getByRole("button", { name: "Start ArchBot match" }).click();
  await expect
    .poll(
      () =>
        sql(
          `select room_id from public.room_live where owner_id = '${userId}' order by created_at desc limit 1`,
        ),
      {
        timeout: 30_000,
      },
    )
    .not.toBe("");
  const roomId = sql(
    `select room_id from public.room_live where owner_id = '${userId}' order by created_at desc limit 1`,
  );
  // Every new room opens in the waiting room; the owner starts it.
  await page.getByRole("button", { name: "Start Lab" }).click();
  await expect(page).toHaveURL(/#\/play\//, { timeout: 30_000 });
  return roomId;
}

async function humanPasses(page: Page) {
  await page.getByRole("button", { name: "Pass", exact: true }).click();
  await page.getByRole("button", { name: "Submit Pass" }).click();
}

test("a free ArchBot room: ArchBot plays on the device through the normal commit path", async ({
  page,
}) => {
  watchNetwork(page);
  await signedIn(page);
  // Home lists the catalogue's bots: ArchBot free on this device; Authur on the
  // game server, which this stack does not have, so truthfully unavailable.
  await page.goto("/#/");
  const bots = page.getByRole("region", { name: "Play against AI" });
  const archbot = bots.getByRole("link", { name: /Play ArchBot/ });
  await expect(archbot).toContainText("Free");
  await expect(archbot).toContainText("Plays on your device");
  await expect(bots.getByRole("listitem").filter({ hasText: "Play Authur" })).toContainText(
    "Needs the game server",
  );
  const roomId = await createArchBotRoom(page);

  expect(room(roomId)).toMatchObject({
    bot_key: "stage5b",
    bot_side: "B",
    bot_access_tier: "free",
    bot_execution_type: "CLIENT",
    room_purpose: "normal",
    mode_key: "stage5b_standard",
    bot_engine: "stage5b",
    bot_difficulty: "stage5b64",
  });

  // ArchBot starts: its first turn is committed without any engine service.
  await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(1);
  await expect(page.getByText(/ArchBot/).first()).toBeVisible();
  expect(page.workers().some((worker) => /worker/.test(worker.url()))).toBe(true);

  for (let turn = 2; turn <= 3; turn += 1) {
    await expect.poll(() => room(roomId).active_side, { timeout: 30_000 }).toBe("A");
    await humanPasses(page);
    await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(turn);
  }

  // One commit per revision, strictly increasing.
  const revisions = events(roomId).map((e) => e.revision);
  expect(new Set(revisions).size).toBe(revisions.length);
  // Free: nothing charged, nothing consumed. Not a Stage.
  expect(sql(`select count(*) from public.probot_consumptions where user_id = '${userId}'`)).toBe(
    "0",
  );
  expect(sql(`select count(*) from public.economy_entries where user_id = '${userId}'`)).toBe("0");
  expect(sql(`select count(*) from public.survival_attempts where player_id = '${userId}'`)).toBe(
    "0",
  );
  expect(serverBotCalls).toEqual([]);
});

test("a reload mid-turn recomputes ArchBot's turn and commits it once", async ({ page }) => {
  watchNetwork(page);
  await signedIn(page);
  const roomId = await createArchBotRoom(page);
  await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => room(roomId).active_side, { timeout: 30_000 }).toBe("A");

  await humanPasses(page);
  await page.reload(); // the worker, and any search in it, dies with the page
  await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(2);
  // Give a duplicate every chance to appear.
  await page.waitForTimeout(3_000);
  expect(botTurns(roomId)).toHaveLength(2);
  const revisions = events(roomId).map((e) => e.revision);
  expect(new Set(revisions).size).toBe(revisions.length);
  expect(serverBotCalls).toEqual([]);
});

test("two tabs on one ArchBot room commit each ArchBot turn exactly once", async ({
  page,
  context,
}) => {
  watchNetwork(page);
  await signedIn(page);
  const roomId = await createArchBotRoom(page);
  await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(1);
  await expect.poll(() => room(roomId).active_side, { timeout: 30_000 }).toBe("A");

  const second = await context.newPage();
  watchNetwork(second);
  await second.goto(page.url());
  await expect(second.getByRole("button", { name: "Pass", exact: true })).toBeEnabled({
    timeout: 30_000,
  });

  await humanPasses(page); // both tabs now see ArchBot on move, and both compute
  await expect.poll(() => botTurns(roomId).length, { timeout: 60_000 }).toBe(2);
  await page.waitForTimeout(3_000);
  expect(botTurns(roomId)).toHaveLength(2);
  const all = events(roomId);
  expect(new Set(all.map((e) => e.revision)).size).toBe(all.length);
  // Never two ArchBot turns in a row: the second tab's answer was refused as stale.
  const turns = turnLog(roomId);
  for (let i = 1; i < turns.length; i += 1) {
    expect(turns[i]!.side === "B" && turns[i - 1]!.side === "B").toBe(false);
  }
  expect(serverBotCalls).toEqual([]);
});

test("a model that cannot load stops ArchBot truthfully, and it plays once the model loads", async ({
  page,
}) => {
  watchNetwork(page);
  await signedIn(page);
  const weights = "**/models/archbot/**/weights.bin";
  const altered = readFileSync(`${process.cwd()}/public/models/archbot/95ba8c0d/weights.bin`);
  altered[4096] ^= 0xff;
  let served = 0;
  await page.route(weights, (route) => {
    served += 1;
    return route.fulfill({ status: 200, body: altered, contentType: "application/octet-stream" });
  });
  const roomId = await createArchBotRoom(page); // ArchBot starts
  const notice = page.getByText("โหลดโมเดลของ ArchBot ไม่สำเร็จ — ยังไม่เดินหมาก กำลังลองใหม่");

  // Altered weights: refused, nothing decided, nothing committed, no fallback.
  await expect(notice).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => served, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  expect(botTurns(roomId)).toHaveLength(0);

  // Missing weights: the same.
  await page.unroute(weights);
  let missing = 0;
  await page.route(weights, (route) => {
    missing += 1;
    return route.fulfill({ status: 404 });
  });
  await expect.poll(() => missing, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  await expect(notice).toBeVisible();
  expect(botTurns(roomId)).toHaveLength(0);

  // The real model: ArchBot's retry loads it and the turn is committed once.
  await page.unroute(weights);
  await expect.poll(() => botTurns(roomId).length, { timeout: 90_000 }).toBe(1);
  await page.waitForTimeout(3_000);
  expect(botTurns(roomId)).toHaveLength(1);
  const revisions = events(roomId).map((e) => e.revision);
  expect(new Set(revisions).size).toBe(revisions.length);
  expect(serverBotCalls).toEqual([]);
});

test("an ArchBot room is a board: at the limit the next one is refused, and nothing is charged", async ({
  page,
}) => {
  await signedIn(page);
  // Two boards made the ordinary way, through the API as the player.
  for (let n = 0; n < 2; n += 1) {
    const response = await fetch(`${API}/rest/v1/rpc/create_live_game`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${session!.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        target_state: { name: `board ${n}`, gameMode: "solo", players: { A: "Me" } },
        target_access_scope: "private",
        target_archive_policy: "none",
        target_region_id: null,
        target_join_policy: "invite_only",
        target_private_parent_id: null,
      }),
    });
    expect(response.ok, await response.text()).toBe(true);
  }
  // The third is an ArchBot room, and fills the limit.
  await createArchBotRoom(page);
  expect(ownedRooms()).toBe("3");

  // A fourth, another ArchBot room, is refused by the same limit.
  await openArchBotSetup(page);
  await page.getByRole("button", { name: "Start ArchBot match" }).click();
  await expect(page.getByText(/maximum number of active boards/).first()).toBeVisible({
    timeout: 30_000,
  });
  expect(ownedRooms()).toBe("3");
  expect(sql(`select count(*) from public.probot_consumptions where user_id = '${userId}'`)).toBe(
    "0",
  );
  expect(sql(`select count(*) from public.economy_entries where user_id = '${userId}'`)).toBe("0");
  expect(sql(`select count(*) from public.survival_attempts where player_id = '${userId}'`)).toBe(
    "0",
  );
});
