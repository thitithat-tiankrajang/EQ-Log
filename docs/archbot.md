# ArchBot

ArchBot is EQ-Lab's free bot that plays on the player's own device. Underneath it
is Stage 5B at full strength: the `stage5b64` configuration (`deepTop: 64`) with
the Stage 5A value model, exactly as the production engine service runs it for
Analysis and Study.

Players only ever see the name **ArchBot**. The internal identifiers keep their
existing names everywhere they are stored or exchanged:

| What              | Value              |
| ----------------- | ------------------ |
| catalog `bot_key` | `stage5b`          |
| engine family     | `stage5b`          |
| difficulty        | `stage5b64`        |
| `mode_key`        | `stage5b_standard` |
| execution type    | `CLIENT`           |
| access tier       | `free`             |

## Provenance

ArchBot runs code that is byte-for-byte traceable to the production runtime.
`tools/archbot/pin.json` is the machine-readable record.

- **Source.** amath-bot-lab `pin/stage5b-reference` =
  `c8255f358e2d9bde1c71ff51ae14d8d2f7ac58df` (parent `72fb0d0`). It holds the
  complete import closure of the Stage 5B service entry (95 files) and the model,
  plus `provenance/stage5b/` with the hashes and a reproduce script. Much of that
  source was uncommitted in amath-bot-lab's working tree; the pin captured it
  with a temporary index, without touching that tree.
  **The commit exists only locally — amath-bot-lab has no remote. Back it up.**
- **Oracle.** engine-algo `7aafbfcfcd72f08975c0d0140f1c981e00d282b4`
  (`service/stage5b/`), unchanged in production `origin/main`
  `dd9fb0e1d34baa4a6cd573675259cb3d14820ccb`.
- **Reproduction.** Building the pinned commit alone (`git archive`, esbuild
  0.27.7, the service's own command) reproduces the production runtime byte for
  byte:

  | File          | SHA-256                                                            |
  | ------------- | ------------------------------------------------------------------ |
  | `runtime.mjs` | `50ef6cd7d01caa435e054fbe16977c3c28695979ffc8c86089913f373039df27` |
  | `model.json`  | `0bd5dd416a57dd7236998e3e14dc99b27e50aebcb51f2877ef91e763e59e99ca` |
  | `weights.bin` | `95ba8c0d3e7040234dc02940ec09fe18f8478d78c8f2cfe65cc42452a65d6c52` |

## What EQ-Lab ships

- `src/bot/archbot/core/stage5b-core.mjs` — the Stage 5B decision code, bundled
  for the browser from the pinned commit by `node tools/archbot/build-core.mjs`.
  `--check` rebuilds it in a temp directory and fails if a byte differs. Its
  module code is the production bundle's, differing only in esbuild's identifier
  renaming and without the Node wrapper.
- `src/bot/archbot/decide.ts` — the production entry's `run()`, statement for
  statement, minus Node I/O.
- `public/models/archbot/95ba8c0d/{model.json,weights.bin}` — the model, at a
  path named by the weights' hash. The loader hashes both files and refuses any
  that differ from the pin.

Rebuilding needs the amath-bot-lab repository holding the pinned commit
(`$AMATH_BOT_LAB_DIR`, default `../amath-bot-lab`); the oracle tools also need
engine-algo (`$AMATH_ENGINE_DIR`, default `../amath-engine`). Both read commits,
never working trees.

## Parity

`tools/archbot/parity/generate-corpus.mjs` builds `tests/fixtures/archbot/parity-corpus.json`:
ArchBot self-play inside the pinned Stage 5B environment (four seeded games) plus
synthetic racks (two blanks with both choice tiles on an empty board, two blanks
later in the game, one blank). Each case's expected answer is produced by the
PRODUCTION runtime, extracted from the oracle commit and hash-checked, run as the
service runs it. The fixture stores a SHA-256 of that runtime's whole answer —
every candidate, value and component; only `stats.elapsedMs` (wall time) is
dropped.

`tests/archbot-parity.test.ts` requires ArchBot's own code path to reproduce every
digest exactly. Two independent regenerations of the corpus produced identical
requests and digests for all 89 cases.

Exact parity is established on V8 (Node, Chromium). The value network uses
`Math.exp`, `Math.log` and `Math.log1p`, whose last-bit results are not specified
by JavaScript and may differ on other engines (JavaScriptCore, SpiderMonkey);
those have not been tested.

## Request construction and hidden information

A Stage 5B request carries only what the side on move may know: its own rack,
the board, both scores, the opponent's rack and the bag as counts (pending
exchange returns are counted into the bag, as the service does), the scoreless
streak, whether exchange is allowed, the turn number, and a seed. The runtime
fills the opponent's rack with the first unseen tiles in manifest order — a
placeholder, not information.

The runtime always sits in seat "A", and the value network reads board-tile
ownership ("placed by self" / "placed by opponent"). ArchBot therefore labels
tiles relative to its own seat. **The production Analysis adapter does not**: it
passes absolute sides, so for a player analysing as side B the network sees
ownership inverted. That is a known engine-algo follow-up, outside Phase 3b.
