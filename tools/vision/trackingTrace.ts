// Print, per tracking scenario: the lock's state timeline (run-length), how
// many frames were usable, and the canonical alignment error of usable frames.
//   npx vite-node tools/vision/trackingTrace.ts
import { canonicalError, measure, TRACK_SCENARIOS, trueQuad } from "./trackingSimulator";
import { INITIAL_LOCK, lockStep, manualLock } from "../../src/features/boardVision/boardLock";

declare const console: { log: (...a: unknown[]) => void };

for (const s of TRACK_SCENARIOS) {
  let lock = INITIAL_LOCK;
  const states: string[] = [];
  const errs: number[] = [];
  let usable = 0;
  const reasons = new Map<string, number>();
  s.frames.forEach((f, i) => {
    const m = measure(s, i);
    lock = i === 0 ? manualLock(m) : lockStep(lock, m);
    states.push(lock.state + (lock.usableForInference ? "*" : ""));
    if (lock.usableForInference) {
      usable += 1;
      errs.push(...canonicalError(lock, trueQuad(f.pose)).px);
    } else if (lock.reason)
      reasons.set(
        lock.reason.replace(/\(.*\)/, "(…)"),
        (reasons.get(lock.reason.replace(/\(.*\)/, "(…)")) ?? 0) + 1,
      );
  });
  const runs: string[] = [];
  for (let i = 0; i < states.length;) {
    let j = i;
    while (j < states.length && states[j] === states[i]) j += 1;
    runs.push(`${states[i]}×${j - i}`);
    i = j;
  }
  const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN;
  const max = errs.length ? Math.max(...errs) : NaN;
  console.log(
    `\n${s.name}: usable ${usable}/${s.frames.length}   canonical error mean ${mean.toFixed(2)} px, max ${max.toFixed(2)} px (${(max / 50).toFixed(3)} sq)`,
  );
  console.log(`  ${runs.join(" → ")}   (* = usable for inference)`);
  if (reasons.size)
    console.log(`  not usable: ${[...reasons].map(([r, n]) => `${r} ×${n}`).join("; ")}`);
}
