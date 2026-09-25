// The two forms of a Study position, and the one conversion between them.
//
// Every producer of a Study board — the keyboard, the palette, and later a
// photograph — goes through these helpers, so what they promise is what makes
// "the same board reaches the engine as the same bytes" true.
import { describe, expect, it } from "vitest";

import {
  boardFromStudyCells,
  newStudyTile,
  studyBoardCell,
  studyFaceOf,
  toStudyBoardCells,
} from "../src/features/study/position";
import { createBoard } from "../src/game";

describe("Study position helpers", () => {
  it("builds a plain tile with no assignedToken key at all", () => {
    const tile = newStudyTile("8");
    expect(Object.keys(tile).sort()).toEqual(["id", "token"]);
    expect(newStudyTile("?", "7")).toMatchObject({ token: "?", assignedToken: "7" });
  });

  it("places every tile on turn 0 by side A", () => {
    const tile = newStudyTile("1");
    expect(studyBoardCell(tile)).toEqual({ tile, placedTurn: 0, side: "A" });
  });

  it("sends the tile's own name for a plain tile and the chosen face otherwise", () => {
    // Note the two alphabets: the plain times tile is `x`, a blank played as
    // times is `×`. That is the existing wire format, preserved as is.
    expect(studyFaceOf(newStudyTile("x"))).toBe("x");
    expect(studyFaceOf(newStudyTile("?", "×"))).toBe("×");
    expect(studyFaceOf(newStudyTile("+/-", "-"))).toBe("-");
  });

  it("lists occupied squares row by row", () => {
    const board = createBoard();
    board[8]![2] = studyBoardCell(newStudyTile("=", undefined));
    board[7]![9] = studyBoardCell(newStudyTile("x//", "÷"));
    board[7]![3] = studyBoardCell(newStudyTile("12"));
    expect(toStudyBoardCells(board)).toEqual([
      { r: 7, c: 3, kind: "12", token: "12" },
      { r: 7, c: 9, kind: "x//", token: "÷" },
      { r: 8, c: 2, kind: "=", token: "=" },
    ]);
  });

  it("rebuilds a stored board that lists back as the same cells", () => {
    const cells = [
      { r: 3, c: 7, kind: "?", token: "2" },
      { r: 7, c: 7, kind: "3", token: "3" },
      { r: 7, c: 8, kind: "x", token: "x" },
    ];
    const board = boardFromStudyCells(cells);
    expect(toStudyBoardCells(board)).toEqual(cells);
    // Stable ids, so a saved record draws the same picture every time.
    expect(board[3]![7]!.tile.id).toBe("3:7");
    expect(board[7]![7]!.tile).not.toHaveProperty("assignedToken");
  });
});
