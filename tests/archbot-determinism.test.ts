// @vitest-environment node
//
// ArchBot computes exactly what the production Stage 5B runtime computes, on any
// machine, in any browser, in any locale. The only operations in the core whose
// results JavaScript leaves to the engine or the locale — Math.exp / log / log1p
// and localeCompare — are replaced by tools/archbot/determinism.js. This proves
// the replacements equal the production runtime's (Node 22 on x86-64, no locale):
// the math against digests recorded ON that runtime, the collation against ICU
// root order, and the built core against containing any of the originals.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain JavaScript, bundled into the core by build-core.mjs.
import { __archbotCompare, __archbotMath } from "../tools/archbot/determinism.js";
// @ts-expect-error — plain JavaScript shared with the golden generator.
import { sweepBytes } from "../tools/archbot/parity/math-sweep.js";

const golden = JSON.parse(
  readFileSync(resolve(__dirname, "fixtures/archbot/production-math.json"), "utf8"),
) as {
  runtime: { version: string; arch: string; productionFaithful: boolean };
  count: number;
  digests: Record<"exp" | "log" | "log1p", string>;
};

const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("production-exact math", () => {
  it("was recorded on the production runtime", () => {
    expect(golden.runtime).toMatchObject({ arch: "x64", productionFaithful: true });
    expect(golden.runtime.version.startsWith("v22.")).toBe(true);
  });

  for (const fn of ["exp", "log", "log1p"] as const) {
    it(`${fn} reproduces the production runtime bit for bit`, () => {
      expect(digest(sweepBytes(fn, __archbotMath[fn], golden.count))).toBe(golden.digests[fn]);
    });
  }

  it("keeps the edge cases", () => {
    const { exp, log, log1p } = __archbotMath as Record<string, (x: number) => number>;
    expect(exp(0)).toBe(1);
    expect(exp(1)).toBe(Math.E);
    expect(exp(-Infinity)).toBe(0);
    expect(exp(Infinity)).toBe(Infinity);
    expect(exp(710)).toBe(Infinity);
    expect(exp(-746)).toBe(0);
    expect(Number.isNaN(exp(NaN))).toBe(true);
    expect(log(1)).toBe(0);
    expect(log(0)).toBe(-Infinity);
    expect(log(-0)).toBe(-Infinity);
    expect(Number.isNaN(log(-1))).toBe(true);
    expect(log(Infinity)).toBe(Infinity);
    expect(log1p(0)).toBe(0);
    expect(Object.is(log1p(-0), -0)).toBe(true);
    expect(log1p(-1)).toBe(-Infinity);
    expect(Number.isNaN(log1p(-2))).toBe(true);
  });
});

describe("production-exact collation", () => {
  const KINDS = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "10",
    "11",
    "12",
    "13",
    "14",
    "15",
    "16",
    "17",
    "18",
    "19",
    "20",
    "+",
    "-",
    "x",
    "/",
    "+/-",
    "x//",
    "=",
    "?",
    "×",
    "÷",
  ];
  // ICU root collation, named explicitly: the production service runs with no
  // locale, which Node resolves to root, and en-US tailors none of these.
  const root = new Intl.Collator("en-US");

  it("orders every tile kind and face exactly as root collation does", () => {
    for (const a of KINDS) {
      for (const b of KINDS) {
        expect(Math.sign(__archbotCompare(a, b)), `${a} vs ${b}`).toBe(
          Math.sign(root.compare(a, b)),
        );
      }
    }
  });

  it("does not follow the player's locale, which does reorder them", () => {
    const thai = new Intl.Collator("th-TH");
    const differs = KINDS.some((a) =>
      KINDS.some((b) => Math.sign(thai.compare(a, b)) !== Math.sign(root.compare(a, b))),
    );
    // The reason the table exists: a Thai-locale browser would sort these differently.
    expect(differs).toBe(true);
  });

  it("orders move ids (16-digit lowercase hex) as root collation does", () => {
    let seed = 7;
    const hex = () =>
      Array.from({ length: 16 }, () =>
        ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % 16).toString(16),
      ).join("");
    for (let i = 0; i < 20_000; i += 1) {
      const a = hex();
      const b = i % 10 === 0 ? a : hex();
      expect(Math.sign(__archbotCompare(a, b))).toBe(Math.sign(root.compare(a, b)));
    }
  });
});

describe("the built core", () => {
  const core = readFileSync(resolve(__dirname, "../src/bot/archbot/core/stage5b-core.mjs"), "utf8");

  it("calls none of the engine- or locale-dependent originals", () => {
    expect(core).not.toMatch(/\.localeCompare\(/);
    expect(core).not.toMatch(/(?<![\w$])Math\.(exp|log|log1p|pow)\b/);
    // The only Intl use is the diagnostic collator, with its locale named.
    expect(core.match(/Intl\./g)).toEqual(["Intl."]);
    expect(core).toContain('new Intl.Collator("en-US")');
  });

  it("routes every replaced call through the determinism shim", () => {
    expect(core.match(/__archbotCompare\(/g)?.length).toBeGreaterThanOrEqual(7);
    expect(core).toMatch(/__archbotMath\.exp\(/);
    expect(core).toMatch(/__archbotMath\.log\(/);
    expect(core).toMatch(/__archbotMath\.log1p\(/);
  });
});
