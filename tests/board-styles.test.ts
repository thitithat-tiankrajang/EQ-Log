// The stylesheet contract behind a board rendered outside the Play screen.
//
// This exists because the failure it guards is invisible to every other test:
// `play-styles.css` ships only with the lazily loaded Play chunk, so a <Board>
// on any other route renders perfect markup with no styling at all — 225
// buttons in a vertical stack and transparent tiles. jsdom applies no CSS, so
// the component tests pass either way.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `process.cwd()`, like the migration tests: under the jsdom environment
// `import.meta.url` is an http URL, so `fileURLToPath` cannot be used here.
const read = (name: string) => readFileSync(`${process.cwd()}/src/${name}`, "utf8");

/** The stylesheets an @import list pulls in, in order. */
function importedSheets(css: string): string[] {
  return [...css.matchAll(/@import\s+"([^"]+)"/g)].map((match) => match[1]!);
}

describe("board-styles.css", () => {
  const boardStyles = read("board-styles.css");

  it("puts every import in the legacy layer", () => {
    // An unlayered stylesheet outranks every named layer. Drop `layer(legacy)`
    // from one line here and the Play screen's legacy rules land on TOP of the
    // application shell, taking the page's own chrome with them.
    const imports = [...boardStyles.matchAll(/@import\s+"[^"]+"([^;]*);/g)];
    expect(imports.length).toBeGreaterThan(0);
    for (const [, modifiers] of imports) {
      expect(modifiers).toContain("layer(legacy)");
    }
  });

  it("leaves out the layout sheets that size the board against the Play rail", () => {
    // These compute `--cell` by subtracting a side rail of
    // `clamp(480px, 48vw, 700px)`. On a page with no rail that is a board
    // scaled for furniture that is not there.
    const board = importedSheets(boardStyles);
    expect(board).not.toContain("./styles/layout/20-board-first-layout.css");
    expect(board).not.toContain("./styles/layout/50-board-first-rail.css");
    expect(board).not.toContain("./styles/pages/10-lobby-and-responsive.css");
  });

  it("carries the sheets the board and the tiles actually need", () => {
    const board = importedSheets(boardStyles);
    // `--cell` and the `.tile` / `.board-cell` boxes.
    expect(board).toContain("./styles/00-base.css");
    // Premium-square colours.
    expect(board).toContain("./styles/components/30-visual-system.css");
    // `.board-frame` and the coordinate labels.
    expect(board).toContain("./styles/components/60-tiles-log-rack.css");
    // The tile face tokens, and the rule that makes every tile dark navy.
    expect(board).toContain("./styles/tokens.css");
    expect(board).toContain("./styles/95-material-ai.css");
  });

  it("is mounted by the Study page only while it is on screen, never loaded globally", () => {
    // Loaded as a global stylesheet it outlived the Study page — the lobby imports it — and on
    // entering Play its `!important` copies of the base sheets overrode Play's own.
    const hook = read("components/pages/study/useBoardStyles.ts");
    expect(hook).toContain('from "../../../board-styles.css?inline"');
    expect(hook).toContain(".remove()");
    expect(read("components/pages/study/StudyPage.tsx")).toContain("useBoardStyles()");
    const globalImports = execSync(`grep -rlE 'import\\s+"[^"]*board-styles\\.css"' src || true`, {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    expect(globalImports).toBe("");
  });
});
