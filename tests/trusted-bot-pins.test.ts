// @vitest-environment node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

// The worker verifies all four Authur files before any database access. A
// private image may bring its own module/models and pins via AUTHUR_MANIFEST;
// no manifest may skip a file or weaken a pin.
const root = fileURLToPath(new URL("..", import.meta.url));
const PINNED = [
  "../../src/bot/authur/strong.mjs",
  "models/next-turn.json",
  "models/reply-opponent.json",
  "models/reply-self.json",
];
const PUBLIC_PINS: Record<string, string> = {
  "../../src/bot/authur/strong.mjs":
    "1bfe583051812453cd047894243ebe9b44ad0569ce977bcf28bd7ee2b533ee49",
  "models/next-turn.json": "e5af04452ede84e16aea6a52cdc582363b9b2efc90708966dcfc754b8c9be966",
  "models/reply-opponent.json": "6f502bf133ee2769a966ddc1b0cb219a54c0f7ac622aaba44c6aed5ac9632f7f",
  "models/reply-self.json": "b2ea60519c4566825250809a832557ac2e92f92256684b850e7219eec34b331a",
};
const scratch = mkdtempSync(join(tmpdir(), "trusted-bot-pins-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Runs the worker without database settings: passing the pins stops at configuration. */
function start(tree: string, manifest?: Record<string, string>) {
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH };
  if (manifest) {
    const file = join(
      scratch,
      `${createHash("sha256").update(JSON.stringify(manifest)).digest("hex")}.json`,
    );
    writeFileSync(file, JSON.stringify(manifest));
    env.AUTHUR_MANIFEST = file;
  }
  return new Promise<string>((done) =>
    execFile(
      process.execPath,
      [join(tree, "services/trusted-bot/worker.mjs")],
      { env, timeout: 20000 },
      (_e, out, err) => done(`${out}${err}`),
    ),
  );
}
const PASSED = "Trusted bot configuration required";
const REFUSED = "Pinned Authur artifact mismatch";

describe("trusted worker Authur pins", () => {
  it("accepts the public pins by default and an equivalent manifest", async () => {
    expect(await start(root)).toContain(PASSED);
    expect(await start(root, PUBLIC_PINS)).toContain(PASSED);
  });

  it("refuses a wrong, missing or unrelated pin", async () => {
    expect(
      await start(root, { ...PUBLIC_PINS, "models/reply-self.json": "0".repeat(64) }),
    ).toContain(REFUSED);
    const missing = Object.fromEntries(
      Object.entries(PUBLIC_PINS).filter(([path]) => path !== "models/next-turn.json"),
    );
    expect(await start(root, missing)).toContain(REFUSED);
    expect(await start(root, { "other.json": "0".repeat(64) })).toContain(REFUSED);
    expect(await start(root, { ...PUBLIC_PINS, "models/next-turn.json": "not-a-sha" })).toContain(
      REFUSED,
    );
  });

  it("runs a private image's replacement files only with that image's own pins", async () => {
    const image = join(scratch, "private-image");
    mkdirSync(join(image, "services/trusted-bot/models"), { recursive: true });
    mkdirSync(join(image, "src/bot/authur"), { recursive: true });
    cpSync(
      join(root, "services/trusted-bot/worker.mjs"),
      join(image, "services/trusted-bot/worker.mjs"),
    );
    symlinkSync(join(root, "node_modules"), join(image, "node_modules"));
    const files: Record<string, string> = {
      "../../src/bot/authur/strong.mjs": "export const futureAuthur = true;\n",
      "models/next-turn.json": '{"future":"next-turn"}\n',
      "models/reply-opponent.json": '{"future":"reply-opponent"}\n',
      "models/reply-self.json": '{"future":"reply-self"}\n',
    };
    const pins: Record<string, string> = {};
    for (const path of PINNED) {
      writeFileSync(resolve(image, "services/trusted-bot", path), files[path]!);
      pins[path] = createHash("sha256").update(files[path]!).digest("hex");
    }
    expect(await start(image, pins)).toContain(PASSED);
    expect(await start(image)).toContain(REFUSED);
  });
});
