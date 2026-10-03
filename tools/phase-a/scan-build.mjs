import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { localEnvironment, stack } from "./local.mjs";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = `${dir}/${name}`;
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}
const environment = localEnvironment();
const secrets = ["SERVICE_ROLE_KEY", "SECRET_KEY", "JWT_SECRET", "S3_PROTOCOL_ACCESS_KEY_SECRET"]
  .map((key) => environment[key])
  .filter(Boolean);
for (const file of ["private.env", "worker.env", "worker.container.private.env"]) {
  for (const line of readFileSync(`${stack}/${file}`, "utf8").split("\n")) {
    if (/^(LIVE_BOT_SECRET|SUPABASE_SERVICE_ROLE_KEY)=/.test(line))
      secrets.push(line.slice(line.indexOf("=") + 1).trim());
  }
}
const authurPaths = ["src/bot/authur/strong.mjs", ...walk("services/trusted-bot/models")];
const hash = (data) => createHash("sha256").update(data).digest("hex");
const authurHashes = new Set(authurPaths.map((path) => hash(readFileSync(path))));
const patterns =
  /LIVE_BOT_SECRET|SUPABASE_SERVICE_ROLE_KEY|claim_live_bot_job|AuthurStrongV3|models\/(?:next-turn|reply-self|reply-opponent)|live-shell-fixture|createFixtureSession|sourceMappingURL=/;
const findings = {};
for (const dir of ["dist", "test-results/phase-a-build"]) {
  const files = walk(dir);
  const result = {
    files: files.length,
    sourceMaps: [],
    secretValues: [],
    credentialPatterns: [],
    authurArtifacts: [],
    fixtureOrExecutorCode: [],
  };
  for (const path of files) {
    const data = readFileSync(path);
    if (path.endsWith(".map")) result.sourceMaps.push(path);
    if (secrets.some((secret) => data.includes(Buffer.from(secret))))
      result.secretValues.push(path);
    if (
      authurHashes.has(hash(data)) ||
      /authur|strong\.mjs|reply-(?:self|opponent)|next-turn/.test(path)
    )
      result.authurArtifacts.push(path);
    if (/\.(?:js|mjs|json|html|css)$/.test(path)) {
      const text = data.toString("utf8");
      if (patterns.test(text)) result.fixtureOrExecutorCode.push(path);
      if (
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sb_secret_|"role"\s*:\s*"service_role"/.test(
          text,
        )
      )
        result.credentialPatterns.push(path);
    }
  }
  findings[dir] = result;
}
writeFileSync(
  "docs/evidence/phase-a-final/build-scan.json",
  JSON.stringify(findings, null, 2) + "\n",
);
console.log(JSON.stringify(findings, null, 2));
if (
  Object.values(findings).some((result) =>
    Object.values(result).some((value) => Array.isArray(value) && value.length),
  )
)
  process.exitCode = 1;
