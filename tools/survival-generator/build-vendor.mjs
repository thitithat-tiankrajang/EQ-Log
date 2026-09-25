// Bundles the two rule engines the Survival generator needs into `.vendor/`.
//
//   authur-rules.mjs  the bot-lab environment Authur was built on: the canonical
//                     turn transition, the complete legal-move generator and the
//                     lab's points-denominated leave evaluator.
//   eqlab-rules.mjs   EQ-Lab's own `validateMove`, used only to cross-check that
//                     every simulated placement is legal and scores the same in
//                     the live game.
//
// Authur itself is NOT rebuilt here: the generator loads the exact `strong.mjs`
// and models the engine service runs (see lib/authur.mjs).
//
// Run: node tools/survival-generator/build-vendor.mjs
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const eqlab = resolve(here, "../..");
const botLab = resolve(process.env.AMATH_BOT_LAB ?? resolve(eqlab, "../amath-bot-lab"));
const out = resolve(here, ".vendor");
const esbuild = resolve(eqlab, "node_modules/.bin/esbuild");

const authurEntry = `
export { createEnvState, envStateFrom, envPosition } from "${botLab}/src/env/state";
export { applyAction } from "${botLab}/src/env/transition";
export { enumerateExchangeActions, exchangeAllowed } from "${botLab}/src/env/exchange";
export { completeRootActions } from "${botLab}/src/strong/selector";
export { evaluateLeave } from "${botLab}/src/bot/leave";
export { DEFAULT_CONFIG } from "${botLab}/src/bot/weights";
export { createManifest, tilePoints } from "${botLab}/src/core/tiles";
export { EQLAB_COMPAT_RULES } from "${botLab}/src/core/rules";
export { buildFromBoard } from "${botLab}/src/space-map/buildSpaceMap";
`;
const eqlabEntry = `
export { validateMove, tileNeedsAssignment } from "${eqlab}/src/game";
`;

function git(repo, ...args) {
  try {
    return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function bundle(name, entry) {
  const entryPath = resolve(out, `${name}.entry.ts`);
  const outPath = resolve(out, `${name}.mjs`);
  await writeFile(entryPath, entry);
  execFileSync(esbuild, [
    entryPath,
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    "--target=es2022",
    "--log-level=warning",
    `--outfile=${outPath}`,
  ]);
  const bytes = await readFile(outPath);
  return createHash("sha256").update(bytes).digest("hex");
}

await mkdir(out, { recursive: true });
await writeFile(resolve(out, ".gitignore"), "*\n");
const provenance = {
  builtAt: new Date().toISOString(),
  authurRules: {
    source: botLab,
    head: git(botLab, "rev-parse", "HEAD"),
    dirtyFiles: (git(botLab, "status", "--porcelain", "src") ?? "").split("\n").filter(Boolean).length,
    sha256: await bundle("authur-rules", authurEntry),
  },
  eqlabRules: {
    source: eqlab,
    head: git(eqlab, "rev-parse", "HEAD"),
    dirtyFiles: (git(eqlab, "status", "--porcelain", "src/game.ts", "src/constants", "src/domain") ?? "")
      .split("\n")
      .filter(Boolean).length,
    sha256: await bundle("eqlab-rules", eqlabEntry),
  },
};
await writeFile(resolve(out, "PROVENANCE.json"), JSON.stringify(provenance, null, 2) + "\n");
console.log(JSON.stringify(provenance, null, 2));
