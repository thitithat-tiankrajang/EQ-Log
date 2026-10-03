import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export async function createManualPlayers(password, env) {
  if (password.length < 12)
    throw new Error("Choose a disposable password of at least 12 characters.");
  if (env.API_URL !== "http://127.0.0.1:54521" || !env.DB_URL?.includes("127.0.0.1:54522/"))
    throw new Error("Refusing a backend other than the disposable Milestone-S stack.");
  const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  const suffix = randomUUID().slice(0, 8);
  const players = [];
  for (const side of ["A", "B"]) {
    const email = `local-${side.toLowerCase()}-${suffix}@example.test`;
    const name = `Local ${side} ${suffix}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error("Disposable account creation failed.");
    const id = created.data.user.id;
    // Only newly created disposable profiles. No session injection or existing-user changes.
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
    players.push({ id, email, name });
  }
  return players;
}

function hiddenPassword(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("Run accounts in an interactive terminal; password input is hidden.");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("data", read);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    }
    function read(data) {
      for (const char of data.toString("utf8")) {
        if (char === "\u0003") return finish(new Error("Account setup cancelled."));
        if (char === "\r" || char === "\n") return finish();
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    }
    process.stdin.on("data", read);
  });
}

export async function provisionManualPlayers(env) {
  const password = await hiddenPassword(
    "Choose a LOCAL password for both players (12+ characters, hidden): ",
  );
  const confirm = await hiddenPassword("Confirm password (hidden): ");
  if (password !== confirm) throw new Error("Passwords did not match. No accounts created.");
  const players = await createManualPlayers(password, env);
  for (let i = 0; i < players.length; i++) {
    console.log(`Player ${i === 0 ? "A" : "B"}: ${players[i].email} · ${players[i].name}`);
  }
  console.log("Use the password you chose at http://127.0.0.1:5192/ in your own browser.");
  console.log(
    `To test Authur, make Player A Pro (Player B stays Free): node tools/phase-a/local.mjs pro ${players[0].email}`,
  );
  console.log("Keep these emails. Accounts and sessions persist in the disposable stack/browser.");
}

/** Accounts made by `accounts` (and the tests' disposable players): never anyone else. */
const DISPOSABLE_EMAIL = /^(local-[ab]-[0-9a-f]{8}|live-[a-z]+-[0-9a-f-]{36})@example\.test$/;
const LOCAL_ADMIN = "local-admin@example.test";
const PRO_MONTHS = 12;
const PRO_CREDITS = 200;

function psql(env, query) {
  return execFileSync("psql", [env.DB_URL, "-v", "ON_ERROR_STOP=1", "-Atc", query], {
    encoding: "utf8",
  }).trim();
}

/**
 * LOCAL ONLY — make one disposable account pass the REAL Pro/funding gate.
 *
 * Nothing is bypassed or special-cased: the grant goes through the same admin
 * RPCs an operator uses (`admin_grant_plan`, `admin_grant_credits`), executed
 * as a disposable local admin identity, so the account holds exactly the
 * backend state the real gate reads: an active Pro plan (regenerating Pro-Bot
 * allowance) and permanent Pro-Bot Credits. Room creation still reserves and
 * consumes through `probot_charge`; refunds and ledger rules are untouched.
 *
 * Fails closed unless the backend is the disposable stack and the email is a
 * disposable local account. Idempotent: the request ids are derived from the
 * account, so a second run replays the same grants instead of adding more.
 * No secret ever reaches a browser; this runs in Node/psql only.
 */
export async function provisionPro(env, email) {
  if (env.API_URL !== "http://127.0.0.1:54521" || !env.DB_URL?.includes("127.0.0.1:54522/"))
    throw new Error("Refusing a backend other than the disposable Milestone-S stack.");
  if (!DISPOSABLE_EMAIL.test(String(email ?? "")))
    throw new Error(
      "Pass the email of a disposable local account (from `node tools/phase-a/local.mjs accounts`).",
    );
  const userId = psql(
    env,
    `select u.id from auth.users u join public.profiles p on p.id=u.id
      where u.email='${email}' and p.status='approved'`,
  );
  if (!/^[0-9a-f-]{36}$/.test(userId))
    throw new Error("No approved disposable account has that email.");

  // The disposable operator identity whose auth.uid() the admin RPCs check.
  let adminId = psql(env, `select id from auth.users where email='${LOCAL_ADMIN}'`);
  if (!adminId) {
    const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    // A random password nobody is told: this identity never signs in.
    const created = await admin.auth.admin.createUser({
      email: LOCAL_ADMIN,
      password: `Unused-${randomUUID()}`,
      email_confirm: true,
    });
    if (created.error || !created.data.user) throw new Error("Local admin identity setup failed.");
    adminId = created.data.user.id;
  }
  psql(
    env,
    `update public.profiles set status='approved', is_admin=true,
       display_name='Local admin (disposable)' where id='${adminId}'`,
  );
  const grant = psql(
    env,
    `begin;
     select set_config('request.jwt.claims',
       json_build_object('sub','${adminId}','role','authenticated')::text, true);
     set local role authenticated;
     select 'plan:' || replayed from public.admin_grant_plan('${userId}'::uuid, 'pro', ${PRO_MONTHS},
       'Local disposable Pro for manual Authur testing', md5('eq-local-pro-plan:${userId}')::uuid);
     select 'credits:' || replayed from public.admin_grant_credits('${userId}'::uuid, ${PRO_CREDITS},
       'Local disposable credits for manual Authur testing', md5('eq-local-pro-credit:${userId}')::uuid);
     commit;`,
  );
  const status = JSON.parse(psql(env, `select public.probot_status_for('${userId}')::text`));
  return {
    userId,
    replayed: !/plan:false|credits:false/.test(grant),
    plan: status.plan_key ?? status.plan?.plan_key ?? null,
    credits: status.credits,
    allowance: status.allowance,
    boards: status.boards,
  };
}
