import { readFileSync, writeFileSync } from "node:fs";
import { decodeGame } from "./src/codec";
import { displayToken } from "./src/game";

const raw = readFileSync(process.argv[2], "utf8");
const state = JSON.parse(raw)[0].state;
const game = decodeGame(state);
console.log("gameId", game.gameId, "botSide", game.botSide, "difficulty", game.botDifficulty);
console.log("scores", JSON.stringify(game.scores));

for (const log of game.logs) {
  const d: any = log.actionDetail;
  let placed = "";
  if (log.action === "place_equation" && d.placedTiles) {
    placed = d.placedTiles.map((p: any) => `${p.displayToken}@R${p.row}C${p.col}`).join(" ");
  } else if (log.action === "exchange" && d.outgoingTiles) {
    placed = "OUT: " + d.outgoingTiles.map((t: any) => displayToken(t)).join(",");
  }
  console.log(`T${log.turnNumber} ${log.side} ${log.action} score=${log.finalScore} ${placed}`);
}

const target = game.logs.find((l) => l.turnNumber === 16);
if (target) {
  const cells: any[] = [];
  target.boardBefore.forEach((row, r) => row.forEach((c, col) => {
    if (c) cells.push({ r, col, token: c.tile.token, display: displayToken(c.tile) });
  }));
  writeFileSync("/private/tmp/claude-501/-Users-thitithat-tiankrajang-Desktop-EQ-Lab/6a528ffd-b781-4cd7-be98-f7345d374fb3/scratchpad/turn16.json", JSON.stringify({
    turnNumber: target.turnNumber, side: target.side, score: target.finalScore,
    rackBefore: target.rackBefore.map((t) => ({ token: t.token, display: displayToken(t) })),
    boardBefore: cells, detail: target.actionDetail,
  }, null, 2));
  console.log("\nwrote turn16.json — boardBefore cells:", cells.length, "rack:", target.rackBefore.length);
}
