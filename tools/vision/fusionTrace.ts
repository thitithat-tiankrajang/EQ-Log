// Print how the fused belief about one square moves, frame by frame, for every
// scenario in fusionScenarios.ts.   npx vite-node tools/vision/fusionTrace.ts
import { SCENARIOS, simulate } from "./fusionScenarios";

declare const console: { log: (...a: unknown[]) => void };

for (const s of SCENARIOS) {
  console.log(`\n${s.name}   (truth: ${s.truth})`);
  console.log(
    "  frame                       P(tile)  leading readings                      views/seen",
  );
  for (const b of simulate(s)) {
    const top = b.top.map((t) => `${t.reading} ${t.p.toFixed(3)}`).join(", ");
    const pt = b.pTile === null ? "   —  " : b.pTile.toFixed(3).padStart(6);
    console.log(`  ${b.step.padEnd(27)} ${pt}   ${top.padEnd(38)} ${b.views}/${b.seen}`);
  }
}
