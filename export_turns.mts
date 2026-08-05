import { readFileSync, writeFileSync } from "node:fs";
import { decodeGame } from "./src/codec";
import { displayToken } from "./src/game";

const state = JSON.parse(readFileSync(process.argv[2], "utf8"))[0].state;
const game = decodeGame(state);

// Cumulative scores before each turn, to identify "bot leading" moments.
let a = 0, b = 0;
for (const log of game.logs) {
  if (log.side === "A") { /* before */ }
  const lead = log.side === "B" ? (b > a ? "B-leads" : b < a ? "B-trails" : "tie") : "";
  if (log.side === "B" && log.action === "place_equation") {
    const d: any = log.actionDetail;
    console.log(`T${log.turnNumber} B place ${log.finalScore}pt  beforeScores A=${a} B=${b} ${lead}  tiles=${d.placedTiles.length}`);
  }
  if (log.action !== "end_game") { if (log.side === "A") a += log.finalScore; else b += log.finalScore; }
}

// Export T8 (the 64-pt bingo while bot leads).
for (const tn of [8, 16]) {
  const t = game.logs.find((l) => l.turnNumber === tn && l.side === "B" && l.action === "place_equation");
  if (!t) { console.log("no bot place at T" + tn); continue; }
  const cells: any[] = [];
  t.boardBefore.forEach((row, r) => row.forEach((c, col) => { if (c) cells.push({ r, c: col, kind: c.tile.token, token: displayToken(c.tile) }); }));
  writeFileSync(`${"/private/tmp/claude-501/-Users-thitithat-tiankrajang-Desktop-EQ-Lab/6a528ffd-b781-4cd7-be98-f7345d374fb3/scratchpad"}/t${tn}.json`, JSON.stringify({
    turn: tn, actualScore: t.finalScore,
    rack: t.rackBefore.map((x) => x.token),
    board: cells,
  }, null, 2));
  console.log(`wrote t${tn}.json: board=${cells.length} rack=[${t.rackBefore.map((x)=>displayToken(x)).join(",")}]`);
}
