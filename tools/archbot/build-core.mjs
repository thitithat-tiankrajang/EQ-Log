#!/usr/bin/env node
// Rebuild ArchBot's vendored browser core and model from the pinned Stage 5B
// source — never from a working tree.
//
//   node tools/archbot/build-core.mjs          write src/bot/archbot/core/stage5b-core.mjs
//                                              and public/models/archbot/<version>/
//   node tools/archbot/build-core.mjs --check  rebuild in a temp dir and fail if the
//                                              committed files differ by one byte
//
// Needs the amath-bot-lab repository holding the pinned commit (tools/archbot/pin.json),
// found at $AMATH_BOT_LAB_DIR or ../amath-bot-lab. The source is taken with
// `git archive <commit>`, so uncommitted edits in that checkout cannot leak in.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const pin = JSON.parse(readFileSync(join(here, "pin.json"), "utf8"));
const check = process.argv.includes("--check");

export const CORE_PATH = join(repo, "src/bot/archbot/core/stage5b-core.mjs");
export const MODEL_DIR = join(repo, "public/models/archbot", pin.model.weightsSha256.slice(0, 8));

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fail(message) {
  console.error(`build-core: ${message}`);
  process.exit(1);
}

if (esbuild.version !== pin.esbuildVersion) {
  fail(`esbuild ${pin.esbuildVersion} required, found ${esbuild.version}`);
}

const lab = resolve(process.env.AMATH_BOT_LAB_DIR ?? join(repo, "../amath-bot-lab"));
if (!existsSync(join(lab, ".git"))) fail(`no amath-bot-lab repository at ${lab}`);
const commit = pin.amathBotLab.commit;
try {
  execFileSync("git", ["-C", lab, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
} catch {
  fail(`${lab} does not hold the pinned commit ${commit}`);
}

const tmp = mkdtempSync(join(tmpdir(), "archbot-core-"));
try {
  const source = join(tmp, "amath-bot-lab");
  mkdirSync(source);
  const archive = execFileSync("git", ["-C", lab, "archive", commit], { maxBuffer: 1 << 28 });
  const untar = spawnSync("tar", ["-x", "-C", source], { input: archive });
  if (untar.status !== 0) fail(`could not extract the pinned commit: ${untar.stderr}`);

  const modelJson = readFileSync(join(source, pin.model.source, "model.json"));
  const weights = readFileSync(join(source, pin.model.source, "weights.bin"));
  if (sha256(modelJson) !== pin.model.modelJsonSha256) fail("pinned model.json hash mismatch");
  if (sha256(weights) !== pin.model.weightsSha256) fail("pinned weights.bin hash mismatch");

  // The entry sits beside the extracted source, as the service entry did, so the
  // bundle's path comments are the same on every machine.
  const entryDir = join(tmp, "archbot");
  mkdirSync(entryDir);
  writeFileSync(join(entryDir, "core-entry.js"), readFileSync(join(here, "core-entry.js")));
  writeFileSync(join(entryDir, "determinism.js"), readFileSync(join(here, "determinism.js")));

  // Determinism (see determinism.js): the core's only engine- and locale-dependent
  // operations are pinned to the production runtime's results. Each replacement
  // is exact text and must occur exactly once; the output is then checked to
  // contain none of the originals, so a new call site cannot slip through.
  const replacements = new Map([
    [
      "src/space-map/spaceMap.ts",
      [
        ["a.kind.localeCompare(b.kind)", "__archbotCompare(a.kind, b.kind)"],
        ["String(va).localeCompare(String(vb))", "__archbotCompare(String(va), String(vb))"],
      ],
    ],
    [
      "src/move-generator/moveCollector.ts",
      [["a.id.localeCompare(b.id)", "__archbotCompare(a.id, b.id)"]],
    ],
    ["src/env/exchange.ts", [["a.id.localeCompare(b.id)", "__archbotCompare(a.id, b.id)"]]],
    [
      "src/move-generator/generateMoves.ts",
      [
        ["a.code.localeCompare(b.code)", "__archbotCompare(a.code, b.code)"],
        ["a.reason.localeCompare(b.reason)", "__archbotCompare(a.reason, b.reason)"],
      ],
    ],
    [
      "src/space-map/validate.ts",
      [["a.code.localeCompare(b.code)", "__archbotCompare(a.code, b.code)"]],
    ],
  ]);
  const determinism = {
    name: "archbot-determinism",
    setup(build) {
      build.onLoad({ filter: /amath-bot-lab\/src\/.*\.ts$/ }, async (args) => {
        let contents = readFileSync(args.path, "utf8");
        const relative = args.path.slice(
          args.path.indexOf("amath-bot-lab/") + "amath-bot-lab/".length,
        );
        for (const [from, to] of replacements.get(relative) ?? []) {
          const count = contents.split(from).length - 1;
          if (count !== 1) fail(`expected one "${from}" in ${relative}, found ${count}`);
          contents = contents.replace(from, to);
        }
        return { contents, loader: "ts" };
      });
    },
  };
  const built = await esbuild.build({
    absWorkingDir: entryDir,
    entryPoints: ["core-entry.js"],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    write: false,
    logLevel: "warning",
    define: {
      "Math.exp": "__archbotMath.exp",
      "Math.log": "__archbotMath.log",
      "Math.log1p": "__archbotMath.log1p",
    },
    inject: [join(entryDir, "determinism.js")],
    plugins: [determinism],
    banner: {
      js: [
        "// GENERATED — do not edit. ArchBot's browser core: the Stage 5B decision code",
        `// (amath-bot-lab ${commit}, ${pin.amathBotLab.ref}),`,
        "// bundled by tools/archbot/build-core.mjs with tools/archbot/determinism.js",
        "// (production-exact exp/log/log1p and collation). See docs/archbot.md.",
      ].join("\n"),
    },
  });
  const text = built.outputFiles[0].text;
  for (const forbidden of [
    /\.localeCompare\(/,
    /(?<![\w$])Math\.exp\b/,
    /(?<![\w$])Math\.log\b/,
    /(?<![\w$])Math\.log1p\b/,
  ]) {
    if (forbidden.test(text)) fail(`the core still calls ${forbidden}`);
  }
  const core = Buffer.from(built.outputFiles[0].contents);

  const outputs = [
    [CORE_PATH, core],
    [join(MODEL_DIR, "model.json"), modelJson],
    [join(MODEL_DIR, "weights.bin"), weights],
  ];
  if (check) {
    let drift = false;
    for (const [path, bytes] of outputs) {
      const current = existsSync(path) ? readFileSync(path) : null;
      if (!current || !current.equals(bytes)) {
        console.error(`build-core: ${path} differs from a rebuild of the pinned source`);
        drift = true;
      } else {
        console.log(`ok ${sha256(bytes)}  ${path.slice(repo.length + 1)}`);
      }
    }
    if (drift) process.exit(1);
  } else {
    for (const [path, bytes] of outputs) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
      console.log(`wrote ${sha256(bytes)}  ${path.slice(repo.length + 1)}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
