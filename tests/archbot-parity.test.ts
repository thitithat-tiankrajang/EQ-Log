// @vitest-environment node
//
// THE PARITY GATE. ArchBot must make exactly the decision the production Stage 5B
// runtime makes — same move, same ranking, same values, to the last bit — on
// every position of the corpus. The expected answers were produced by that
// runtime itself (engine-algo 7aafbfc, service/stage5b/runtime.mjs, run as the
// service runs it) by tools/archbot/parity/generate-corpus.mjs; this test runs
// ArchBot's own code path (vendored core + decide.ts + the shipped model files)
// and compares a digest of its WHOLE answer, not just the chosen move.
//
// A failure here means ArchBot is not Stage 5B. Do not loosen it; find out why.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decideArchBot,
  type ArchBotDecision,
  type ArchBotRequest,
} from "../src/bot/archbot/decide";
import { archBotModelPath } from "../src/bot/archbot/identity";
import { valueHeadFromBytes } from "../src/bot/archbot/model";
import type { ValueHead } from "../src/bot/archbot/core/stage5b-core.mjs";
import pin from "../tools/archbot/pin.json";

type CorpusCase = {
  id: string;
  tags: string[];
  request: ArchBotRequest;
  expected: {
    digest: string;
    move: { type: string; placements: unknown[]; exchange: string[]; score: number };
    equity: number;
    oracleMs: number;
  };
};

const corpus = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/archbot/parity-corpus.json"), "utf8"),
) as { provenance: Record<string, string>; cases: CorpusCase[] };

function comparableDigest(decision: ArchBotDecision): string {
  // Through JSON, as the oracle's answer was: the runtime writes JSON to stdout.
  const answer = JSON.parse(JSON.stringify(decision)) as ArchBotDecision;
  const stats: Partial<ArchBotDecision["stats"]> = { ...answer.stats };
  delete stats.elapsedMs;
  return createHash("sha256")
    .update(JSON.stringify({ ...answer, stats }))
    .digest("hex");
}

function bytesOf(path: string): ArrayBuffer {
  const buffer = readFileSync(path);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

let value: ValueHead;
beforeAll(async () => {
  const dir = resolve(__dirname, "../public", archBotModelPath("/").slice(1));
  value = await valueHeadFromBytes(bytesOf(`${dir}/model.json`), bytesOf(`${dir}/weights.bin`));
});

describe("ArchBot parity corpus", () => {
  it("was generated against the pinned reference and model", () => {
    expect(corpus.provenance).toEqual({
      amathBotLabCommit: pin.amathBotLab.commit,
      oracleCommit: pin.oracle.commit,
      oracleRuntimeSha256: pin.oracle.runtimeSha256,
      modelJsonSha256: pin.model.modelJsonSha256,
      weightsSha256: pin.model.weightsSha256,
    });
  });

  it("covers the positions the gate requires", () => {
    const tags = new Set(corpus.cases.flatMap((item) => item.tags));
    for (const required of [
      "opening",
      "midgame",
      "late",
      "endgame",
      "blank",
      "two-blanks",
      "choice",
      "no-exchange",
      "chose-exchange",
      "chose-pass",
    ]) {
      expect(tags, required).toContain(required);
    }
  });

  for (const item of corpus.cases) {
    it(
      `${item.id} [${item.tags.join(", ")}] matches production Stage 5B exactly`,
      async () => {
        // A decision is one long synchronous call. Yield first, so the test
        // worker can answer vitest's RPC between cases instead of timing out.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const decision = decideArchBot(item.request, value);
        const move = {
          type: decision.type,
          placements: decision.placements,
          exchange: decision.exchange,
          score: decision.score,
        };
        // The move first, so a failure says what changed in terms a person reads.
        expect(move).toEqual(item.expected.move);
        expect(decision.equity).toBe(item.expected.equity);
        expect(comparableDigest(decision)).toBe(item.expected.digest);
      },
      Math.max(60_000, item.expected.oracleMs * 6),
    );
  }
});
