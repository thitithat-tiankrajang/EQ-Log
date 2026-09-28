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

## Determinism

JavaScript leaves two kinds of result to the engine or the user's locale, and the
Stage 5B core used both:

- `Math.exp`, `Math.log`, `Math.log1p` (value network, area scoring). Measured
  over millions of inputs: Node 20/22/23/26 agree with each other, arm64 Node
  differs from x86-64 Node in the last bit on a small fraction of inputs (the C++
  is compiled with fused multiply-add), and Chromium 151 differs from Node on
  5–10% of inputs.
- `String#localeCompare` (candidate and move-list ordering). Under a Thai locale
  it orders the tile-kind strings differently from the root collation the
  service runs with.

Either can move a near-tie, so `tools/archbot/determinism.js` replaces them when
`build-core.mjs` bundles the pinned source: a line-for-line JavaScript port of
the fdlibm routines V8 ships, and a fixed root-collation table for the strings the
core compares (tile kinds and faces; move ids are fixed-length hex, where root
collation is code-point order). The build replaces each call by exact text and
refuses an output that still contains any original. No decision logic changes.

The production runtime is Node 22 on x86-64 with no locale (node:22-bookworm-slim),
so that is what the oracle runs: `tools/archbot/pinned.mjs` refuses any other
runtime (on Apple Silicon it uses the universal installer's x86-64 Node under
Rosetta). `tests/fixtures/archbot/production-math.json` holds digests of that
runtime's `exp`/`log`/`log1p` over a 400,000-input sweep;
`tests/archbot-determinism.test.ts` requires the shim to reproduce them on
whatever machine runs the test (it does, on arm64, where the host's own `Math`
does not), and checks the collation table against root order.

In the first browser run, before this layer existed, Chromium chose the same
move in all 89 corpus positions but 44 whole-answer digests differed (one ulp in
a value-network component). With it, all 89 are exact.

## Parity

`tools/archbot/parity/generate-corpus.mjs` builds `tests/fixtures/archbot/parity-corpus.json`:
ArchBot self-play inside the pinned Stage 5B environment (four seeded games) plus
synthetic racks (two blanks with both choice tiles on an empty board, two blanks
later in the game, one blank). Each case's expected answer is produced by the
PRODUCTION runtime, extracted from the oracle commit and hash-checked, run on the
production runtime as the service runs it (child process, request on stdin). The
fixture stores a SHA-256 of that runtime's whole answer — every candidate, value
and component; only `stats.elapsedMs` (wall time) is dropped.

- Node: `tests/archbot-parity.test.ts`, ArchBot's own code path (vendored core,
  `decide.ts`, the shipped model), 89/89 exact.
- Browser: `npx playwright test --config playwright.archbot.config.ts`, the
  production build of the app's worker in Chromium 151, 89/89 exact.
- Independent regenerations of the corpus produce identical requests and
  digests; the arm64 and x86-64 oracles agree on all 89.

Safari (JavaScriptCore) and Firefox (SpiderMonkey) have not been run. With the
determinism layer, ArchBot's arithmetic is plain IEEE-754 double operations that
JavaScript specifies exactly, so they are expected to match — but that is an
expectation, not a measurement.

### Running the gate

| Gate                          | Command                                                     |
| ----------------------------- | ----------------------------------------------------------- |
| ordinary unit suite           | `npm test` (excludes the two gate files below)              |
| Node parity + determinism     | `npm run test:archbot-parity` (`vitest.archbot.config.ts`)  |
| Chromium parity and benchmark | `npx playwright test --config playwright.archbot.config.ts` |

The Node gate runs ninety seconds of full-strength searches, so it is its own
command: inside `npm test` it starved unrelated timing-sensitive UI tests.
`npm run check` and CI run it after the ordinary suite, never beside it.

## Architecture

```
Play page (App)                      bot-turn effect: one session per room+revision
  └─ engineSessions.observeBot       archbot: { game } — never the server path
       └─ runArchBot (client.ts)     request.ts: own rack only, seedFor(room, rev)
            └─ ArchBotEngine          one module worker per tab, FIFO, request ids
                 └─ worker.ts         model loaded + hash-verified once, then decide()
                      └─ decide.ts + core/stage5b-core.mjs   (Stage 5B, deepTop 64)
  ← BotMoveResult (room, revision, move) → applyBotResult → game validator → commit
```

- **Worker protocol** (`protocol.ts`): host → `init {modelPath}`, `decide {id,
modelPath, request}`; worker → `ready {modelMs}`, `model-error {code}`,
  `decided {id, decision, wallMs, modelMs}`, `failed {id, code, modelCode?}`.
  Only the request currently in the worker can be answered; any other id is
  dropped. Cancelling a queued request removes it; cancelling the running one
  terminates the worker. A crashed worker fails its request and is replaced. After
  a decision over ≥ 50,000 legal moves the worker is retired to return its memory.
- **Model**: `public/models/archbot/95ba8c0d/`, a path named by the weights' hash,
  fetched by the worker, SHA-256-checked against the pin, loaded once per worker.
  Missing, altered or unreadable files → ArchBot unavailable, nothing decided.
- **Seed**: `seedFor(roomId, revision)` (`src/bot/superRequest.ts`), EQ-Lab's one
  seed convention and the service's unsalted `seedFor`.
- **Lifecycle**: ArchBot turns use the ordinary bot session (one per room and
  revision, so a turn is searched once however many times it is asked for) and
  the ordinary application path: revision check, rack mapping, EQ-Lab's official
  move validator, conditional commit. ArchBot sessions are never persisted; a
  stored bot hint, a discovered server job, or a server-path call for an ArchBot
  room is ignored or refused. A revision change aborts the search.
- **No fallback**: a failure is reported (`archbot_unsupported`,
  `archbot_model_unavailable`, `archbot_failed`) and retried on the device; it
  is never sent to the engine service, Authur, or anything weaker. The existing
  bot-room escape (after three failures the player may take over the bot's move)
  applies unchanged.
- **Availability**: offered only when `list_bots()` says the `stage5b` row is
  enabled, open to new rooms, active, `CLIENT` and `free`, and the browser has a
  module worker and Web Crypto.

## Performance (Chromium 151, Apple Silicon, desktop)

Production build, whole corpus, decision wall time in the worker:

| Positions           | n   | p50    | p90    | max    |
| ------------------- | --- | ------ | ------ | ------ |
| opening             | 6   | 0.48 s | 0.89 s | 1.2 s  |
| early game          | 10  | 0.43 s | 1.8 s  | 3.4 s  |
| midgame             | 36  | 0.49 s | 0.68 s | 2.1 s  |
| late game           | 10  | 0.32 s | 0.64 s | 0.72 s |
| endgame (bag empty) | 20  | 0.02 s | 0.54 s | 0.69 s |
| one blank on rack   | 14  | 0.78 s | 1.8 s  | 3.4 s  |
| two blanks on rack  | 7   | 9.4 s  | 17.5 s | 27 s   |
| all                 | 89  | 0.42 s | 1.8 s  | 27 s   |

- The heaviest natural position (two blanks and a choice tile, 229,335 legal
  moves) took 19–31 s across runs on this machine; the pathological two-blank,
  two-choice opening 13–22 s. Nothing is shortened to hide it.
- The page stayed responsive throughout: the worst gap between animation frames
  during any search was 18 ms (one frame at 60 Hz), timer lag ≤ 2 ms.
- Model load: 4 MB; ~20 ms from a local server, ~11 ms for a new worker with the
  HTTP cache warm. Real network download time was not measured.
- Memory (renderer process, from the OS; no page API reports worker memory):
  ~190 MB before, ~700–730 MB peak on the 229k-move position. With the worker
  retired after huge searches, the operating system reclaims it gradually: back to
  ~80 MB within 5–30 s across runs (e.g. 715 → 678 → 575 → 442 → 333 → 166 → 78 MB
  at 5 s intervals), below the pre-search level.
- Mobile: not measured. Chromium's CPU throttling does not slow a dedicated
  worker, so it cannot emulate a phone here; no phone figures are claimed.

## Request construction and hidden information

A Stage 5B request carries only what the side on move may know: its own rack,
the board, both scores, the opponent's rack and the bag as counts (pending
exchange returns are counted into the bag, as the service does), the scoreless
streak, whether exchange is allowed, the turn number, and a seed. The runtime
fills the opponent's rack with the first unseen tiles in manifest order — a
placeholder, not information. `tests/archbot-request.test.ts` shows the request
is identical whatever the opponent holds and however the bag is ordered, and that
returning exchange tiles are counted but never named.

The runtime always sits in seat "A", and the value network reads board-tile
ownership ("placed by self" / "placed by opponent"). ArchBot therefore labels
tiles relative to its own seat. **The production Analysis adapter does not**: it
passes absolute sides, so for a player analysing as side B the network sees
ownership inverted. That is a known engine-algo follow-up, outside Phase 3b.

## Catalog (Phase 3b)

`supabase/migrations/20260930120000_archbot_enable.sql` opens ArchBot: the
`stage5b` row becomes active, enabled and open to new rooms, named ArchBot, still
free and CLIENT (config_version unchanged). ArchBot rooms (`stage5b_standard`,
labelled ArchBot) offer turn log, replay, analysis and alternate lines, and no
bot explanation — a Product Owner decision for a practice mode, not a precedent
for Ranked. It runs after the Platform Foundation's migrations, including the
display rename `20260930100000_archbot_display_identity.sql`.

Players find ArchBot on Home, under Play against AI, which lists the bots the
catalogue offers. Its row leads to ArchBot's own setup (`#/create?mode=archbot`:
a space, then the free ArchBot panel), which reads the catalogue again and checks
that this browser can run it, and says why when it cannot. Bots are not Create
choices, so ArchBot is not one of Custom's opponents.

## Trust boundary

The browser is an untrusted worker. A modified client can play any move for
ArchBot; that is acceptable for a free bot because nothing authoritative trusts
the bot's reasoning. The room is created by `create_bot_game`, which funds from
the catalog's access tier only (free: no allowance, no Credit, funding refused),
freezes the bot identity, and never sets a Stage purpose. Commits go through
`commit_live_game_command`, which checks write access, command idempotency, the
catalog's `enabled` flag and the revision — but, for every bot as for humans,
not move legality, side or inventory. ArchBot moves are checked by EQ-Lab's own
validator before they are committed; server-side legality is outside Phase 3b.
