import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { localEnvironment, stack } from "./local.mjs";

const evidence = "docs/evidence/local-real-play";
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const env = localEnvironment();
const secrets = ["SERVICE_ROLE_KEY", "SECRET_KEY", "JWT_SECRET", "S3_PROTOCOL_ACCESS_KEY_SECRET"]
  .map((key) => env[key])
  .filter(Boolean);
for (const file of ["private.env", "worker.env", "worker.container.private.env"])
  for (const line of readFileSync(`${stack}/${file}`, "utf8").split("\n"))
    if (/^(LIVE_BOT_SECRET|SUPABASE_SERVICE_ROLE_KEY)=/.test(line))
      secrets.push(line.slice(line.indexOf("=") + 1).trim());
const hash = (data) => createHash("sha256").update(data).digest("hex");
const authurHashes = new Set(
  ["src/bot/authur/strong.mjs", ...walk("services/trusted-bot/models")].map((path) =>
    hash(readFileSync(path)),
  ),
);
const files = walk("dist");
const findings = { devLogin: [], secrets: [], authur: [], sourceMaps: [], fixtureOrExecutor: [] };
for (const path of files) {
  const data = readFileSync(path);
  if (secrets.some((secret) => data.includes(Buffer.from(secret)))) findings.secrets.push(path);
  if (path.endsWith(".map")) findings.sourceMaps.push(path);
  if (
    authurHashes.has(hash(data)) ||
    /authur|strong\.mjs|reply-(?:self|opponent)|next-turn/.test(path)
  )
    findings.authur.push(path);
  if (/\.(?:js|mjs|json|html)$/.test(path)) {
    const text = data.toString("utf8");
    if (
      /LocalPasswordSignIn|Disposable local sign-in|Sign in locally|local-accounts|Choose a LOCAL password/.test(
        text,
      )
    )
      findings.devLogin.push(path);
    if (
      /LIVE_BOT_SECRET|SUPABASE_SERVICE_ROLE_KEY|claim_live_bot_job|AuthurStrongV3|live-shell-fixture|createFixtureSession|sourceMappingURL=/.test(
        text,
      )
    )
      findings.fixtureOrExecutor.push(path);
  }
}
const browser = await chromium.launch();
let productionLogin = false,
  localFormAbsent = false;
try {
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4479/");
  await page.getByRole("heading", { name: "Sign in required" }).waitFor();
  productionLogin = await page.getByRole("button", { name: "Sign in with Google" }).isVisible();
  localFormAbsent =
    (await page.getByRole("form", { name: "Disposable local sign-in" }).count()) === 0 &&
    (await page.getByRole("button", { name: "Sign in locally", exact: true }).count()) === 0;
} finally {
  await browser.close();
}
const result = {
  build: "production with disposable VITE variables",
  files: files.length,
  findings,
  productionLogin,
  localFormAbsent,
};
mkdirSync(evidence, { recursive: true });
writeFileSync(`${evidence}/production-isolation.json`, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
if (!productionLogin || !localFormAbsent || Object.values(findings).some((items) => items.length))
  process.exitCode = 1;
