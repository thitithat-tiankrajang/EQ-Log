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
  console.log("Keep these emails. Accounts and sessions persist in the disposable stack/browser.");
}
