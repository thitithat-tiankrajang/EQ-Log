import { expect, it } from "vitest";
import { canonicalFromSnapshot } from "../src/domain/projection";
import { spectatorPreview } from "../src/spectatorPreview";
import { newGame, pass } from "./helpers/simulateGame";

it("shows a broadcast board without hiding a missing full room update", () => {
  const before = { ...newGame("play"), revision: 6 };
  const after = pass(before);
  const canonical = canonicalFromSnapshot(after, 7);

  const preview = spectatorPreview(before, canonical, 7);
  expect(preview.turnNumber).toBe(after.turnNumber);
  expect(preview.revision).toBe(6);
  expect(preview.logs).toBe(before.logs);
  expect(spectatorPreview({ ...after, revision: 7 }, canonical, 7)).toMatchObject({
    revision: 7,
    logs: after.logs,
  });
});
