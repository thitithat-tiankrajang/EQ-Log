// Everything needed to say exactly what produced a candidate, captured BEFORE
// any expensive work starts.
//
// The generator itself is not committed to git yet, so a commit hash alone
// cannot identify it: every generator source file is content-hashed too. The
// rules bundle embeds source paths in comment lines, so a rebuild from another
// folder changes its sha256 without changing a byte of code; the code-only hash
// (comment lines removed) is the one to compare.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { authurIdentity } from "./authur.mjs";
import { SOURCE_LOG_FORMAT, STATE_HASH } from "./sourcelog.mjs";

export const PIPELINE_VERSION = "survival-candidate-pipeline-v1";
/** Weak/medium/strong parameters, hierarchical choice, strong without exact endgame. */
export const POLICY_VERSION = "policies-v2";
/** 2-turn look-ahead: top-score + setup first moves, Authur's real reply, exact + bag-blind next move. */
export const OPPORTUNITY_VERSION = "opportunity-v1";
export const ROUTING_VERSION = "routing-v1";
/** v2: the gameplay section carries the replayable source log (lib/sourcelog.mjs). */
export const CANDIDATE_SCHEMA = "survival-candidate-v2";

const root = resolve(import.meta.dirname, "..");
const eqlab = resolve(root, "../..");

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const codeOnly = (text) => text.split("\n").filter((line) => !line.startsWith("//")).join("\n");

function git(repo) {
  const run = (...args) => {
    try {
      return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    } catch {
      return null;
    }
  };
  const status = run("status", "--porcelain");
  return {
    repo,
    commit: run("rev-parse", "HEAD"),
    dirty: status === null ? null : status.length > 0,
    dirtyEntries: status === null ? null : status.split("\n").filter(Boolean).length,
  };
}

async function fileHash(path, { stripComments = false } = {}) {
  const text = await readFile(path, "utf8");
  return { sha256: sha256(text), ...(stripComments ? { codeSha256: sha256(codeOnly(text)) } : {}) };
}

/** Content hash over the generator's own sources (lib, worker, pipeline). */
async function generatorCodeHash() {
  const files = [
    ...["worker.mjs", "pipeline.mjs", "build-vendor.mjs", "build-diag.mjs"].map((f) => resolve(root, f)),
    ...(await readdir(resolve(root, "lib"))).filter((f) => f.endsWith(".mjs")).sort().map((f) => resolve(root, "lib", f)),
  ];
  const hash = createHash("sha256");
  const perFile = {};
  for (const file of files) {
    const text = await readFile(file, "utf8");
    perFile[file.slice(root.length + 1)] = sha256(text);
    hash.update(file.slice(root.length + 1)).update("\0").update(text).update("\0");
  }
  return { sha256: hash.digest("hex"), files: perFile };
}

export async function captureProvenance({ config, workers, authurDir }) {
  const vendor = resolve(root, ".vendor");
  const buildInfo = JSON.parse(await readFile(resolve(vendor, "PROVENANCE.json"), "utf8"));
  return {
    versions: {
      pipeline: PIPELINE_VERSION,
      policy: POLICY_VERSION,
      opportunity: OPPORTUNITY_VERSION,
      routing: ROUTING_VERSION,
      candidateSchema: CANDIDATE_SCHEMA,
      sourceLog: SOURCE_LOG_FORMAT,
      stateHash: STATE_HASH,
    },
    generatorCode: await generatorCodeHash(),
    git: {
      eqlab: git(eqlab),
      generatorTracked: (() => {
        try {
          return execFileSync("git", ["-C", eqlab, "ls-files", "--", "tools/survival-generator"], { encoding: "utf8" }).trim().length > 0;
        } catch {
          return null;
        }
      })(),
      botLab: git(buildInfo.authurRules.source),
      engine: git(resolve(authurDir, "../..")),
    },
    bundles: {
      rules: { ...(await fileHash(resolve(vendor, "authur-rules.mjs"), { stripComments: true })), build: buildInfo.authurRules },
      rulesDiagnostics: await fileHash(resolve(vendor, "authur-rules-diag.mjs"), { stripComments: true }),
      eqlabValidator: { ...(await fileHash(resolve(vendor, "eqlab-rules.mjs"), { stripComments: true })), build: buildInfo.eqlabRules },
      authur: await authurIdentity(authurDir),
    },
    runtime: {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? null,
      cores: os.availableParallelism(),
      workers,
    },
    config,
  };
}
