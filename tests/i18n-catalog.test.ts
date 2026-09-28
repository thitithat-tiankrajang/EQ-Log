import { describe, expect, it } from "vitest";
import { en } from "../src/i18n/messages/en";
import { th } from "../src/i18n/messages/th";
import { formatMessage, hasMessage, translate, type MessageKey } from "../src/i18n/translate";

function leafPaths(node: unknown, prefix = ""): string[] {
  if (typeof node === "string") return [prefix];
  if (node && typeof node === "object" && typeof (node as { other?: unknown }).other === "string")
    return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function leafTexts(node: unknown): string[] {
  if (typeof node === "string") return [node];
  return Object.values(node as Record<string, unknown>).flatMap(leafTexts);
}

describe("catalogues", () => {
  it("have exactly the same keys in English and Thai", () => {
    expect(leafPaths(th).sort()).toEqual(leafPaths(en).sort());
  });

  it("have no empty messages", () => {
    for (const text of [...leafTexts(en), ...leafTexts(th)]) expect(text.trim()).not.toBe("");
  });

  it("never expose internal engine names, seeds or developer vocabulary", () => {
    const forbidden = [
      /Stage ?5[AB]/i,
      /stage5b/i,
      /\bseed\b/i,
      /\bMVP\b/,
      /Start Lab/i,
      /VITE_/,
      /sample_count|win_count/,
    ];
    for (const text of [...leafTexts(en), ...leafTexts(th)])
      for (const pattern of forbidden) expect(text, text).not.toMatch(pattern);
  });

  it("keep canonical product names untranslated in Thai", () => {
    expect(translate("th", "errors.server.funding_required")).toContain("Authur");
    expect(translate("th", "errors.server.insufficient_credits")).toContain("Pro-Bot");
    expect(translate("th", "errors.server.allowance_free_plan")).toContain("Free");
  });
});

describe("translate", () => {
  it("looks up a message in each language", () => {
    expect(translate("en", "errors.generic")).toBe("Something went wrong. Please try again.");
    expect(translate("th", "errors.generic")).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  });

  it("returns an unknown key as-is rather than throwing", () => {
    expect(translate("en", "errors.nope" as MessageKey)).toBe("errors.nope");
    expect(hasMessage("errors.nope")).toBe(false);
    expect(hasMessage("errors.generic")).toBe(true);
    // A namespace is not a message.
    expect(hasMessage("errors.server")).toBe(false);
  });

  it("fills placeholders and formats numbers for the locale", () => {
    expect(formatMessage("en", "{name} has {count} boards", { name: "Beam", count: 1234 })).toBe(
      "Beam has 1,234 boards",
    );
    expect(formatMessage("en", "keeps {missing}")).toBe("keeps {missing}");
  });

  it("chooses the plural form from count", () => {
    const boards = { one: "{count} active board", other: "{count} active boards" };
    expect(formatMessage("en", boards, { count: 1 })).toBe("1 active board");
    expect(formatMessage("en", boards, { count: 3 })).toBe("3 active boards");
    // Thai has a single plural category.
    expect(formatMessage("th", { one: "one", other: "{count} กระดาน" }, { count: 1 })).toBe(
      "1 กระดาน",
    );
  });
});
