// ── The vision training contract, exported from the runtime ─────────────────
//
// A recogniser is trained somewhere else (amath-vision-training) and has to
// agree with this app about exactly one thing: what each of its outputs MEANS.
// That is not restated there by hand. It is exported from here — from the same
// modules the app runs — and the training side checks the fingerprints before
// it will build anything.
//
//   npx vite-node tools/vision/exportContract.ts > <out.json>
//
// Everything below is read, not written: the class order is `CELL_CLASSES`,
// the tile table is `AMATH_TOKENS`, the printed face is what `<Tile>` draws for
// a tile nobody has assigned (a bare blank draws nothing), the premium layout
// is `BOARD_LAYOUT` and its labels are the board's own `SLOT_LABELS`.

import { visionContract } from "./visionContract";

// The one Node API used, declared here rather than adding @types/node to a
// browser app's type environment.
declare const process: { stdout: { write(text: string): void } };

process.stdout.write(`${JSON.stringify(visionContract(), null, 2)}\n`);
