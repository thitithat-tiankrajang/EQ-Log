// Snapshot fields added for transcription and branching must survive the codec — a field the
// codec does not list is silently dropped by every save and every sync (the bot-mode lesson).
import { describe, expect, it } from "vitest";
import { createNewGame } from "../src/game";
import { decodeGame, encodeGame } from "../src/codec";
import { makeRemoteStateKey } from "../src/stateKey";

function fresh() {
  return createNewGame({
    name: "Fields",
    playerA: "A",
    playerB: "B",
    startingSide: "A",
    tileDrawMode: "manual",
  });
}

describe("fields the codec must carry", () => {
  it("keeps a side's face-down count", () => {
    const game = { ...fresh(), faceDownCount: { B: 3 } };
    expect(decodeGame(encodeGame(game)).faceDownCount).toEqual({ B: 3 });
  });

  it("keeps the parked-lines reference a branched game was committed with", () => {
    const game = { ...fresh(), timelineRef: { version: 4, lines: 2 } };
    expect(decodeGame(encodeGame(game)).timelineRef).toEqual({ version: 4, lines: 2 });
  });

  it("writes nothing at all for a game that never branched", () => {
    expect(JSON.stringify(encodeGame(fresh()))).not.toContain("timelineRef");
  });
});

describe("the state key", () => {
  it("is unchanged for games that never branched, so opening one writes nothing", () => {
    const game = fresh();
    expect(makeRemoteStateKey({ ...game, timelineRef: undefined })).toBe(makeRemoteStateKey(game));
  });

  it("changes when only the parked lines do, so the change is written and adopted", () => {
    const game = fresh();
    expect(makeRemoteStateKey({ ...game, timelineRef: { version: 1, lines: 1 } })).not.toBe(
      makeRemoteStateKey(game),
    );
  });
});
