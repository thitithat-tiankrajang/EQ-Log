// Check identity and ports before any disposable migration/reset command.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const workdir = process.env.LIVE_SECURITY_TEST_WORKDIR;
if (workdir !== "/private/tmp/eq-live-hidden-security-20261001")
  throw new Error("Explicit disposable workdir required");
const config = readFileSync(`${workdir}/supabase/config.toml`, "utf8");
const section = (name) => config.split(`[${name}]`)[1]?.split(/\n\[/)[0];
if (
  !/^project_id\s*=\s*"eq_live_hidden_security_20261001"$/m.test(config) ||
  !/^port\s*=\s*54521$/m.test(section("api") ?? "") ||
  !/^port\s*=\s*54522$/m.test(section("db") ?? "")
)
  throw new Error("Disposable identity/ports mismatch");
const status = execFileSync("supabase", ["status", "--workdir", workdir, "-o", "env"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "ignore"],
});
const values = Object.fromEntries(
  [...status.matchAll(/^([A-Z_]+)="([^"\n]*)"$/gm)].map((m) => [m[1], m[2]]),
);
if (values.API_URL !== "http://127.0.0.1:54521" || new URL(values.DB_URL).port !== "54522")
  throw new Error("Disposable runtime ports mismatch");
console.info("PASS: explicit disposable project, API54521 and DB54522. No credentials printed.");
