# Study puzzles v2 — constraint-driven Find Best Play

Local / dev / archive only. No Supabase, nothing published, Survival untouched,
Codex's generator and the engines unchanged.

A puzzle has an **authentic self-play board**, exactly **one turn**: the
player submits one legal placement, submitting ends the puzzle, nothing replies,
and nothing about the engine's answer is revealed by submitting.

The guided-search addition in §12 supersedes the original authentic-rack-only
policy below. Historical v2 puzzles retain exact seed-to-puzzle replay.

The additive puzzle-specification fields in §13 refine what an admin can ask
for. Old v1 and v2 records remain readable without these fields.

---

## 1. Audit — what exists

### Codex's generator (`amath-engine/tools/study-puzzle-generator`, v1)

| Supports         | Detail                                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Source positions | `data/positions.jsonl`: 131 **snapshots** (board, rack, scores, counts) from 6 "super" self-play games. No moves, no draws, no bag order, no deal.                                               |
| Rack variants    | per board: the original rack **plus three re-dealt racks** (operator / division / duplicate profiles). The re-dealt ones never occurred in any game.                                             |
| Analysis         | `service/stage5b/runtime.mjs` (Stage 5B + Stage 5A value), one process per position, `topN 50`.                                                                                                  |
| Checks           | best move re-validated by `build/amath_cli worker` (valid + same score).                                                                                                                         |
| Answer extras    | near-best = candidates within 0.5 value of the best; runner-up.                                                                                                                                  |
| Filters          | mode (any/bingo/cross/arithmetic/fraction/fraction-sum/large, geometry + token parsing of its own), minScore, minTiles, rack "difficulty" index, maxNear, board-tile range, fixed `maxScan` cap. |
| Output           | one batch at the end: `puzzles.json` (`find-best-play-v1`), `student.html`, `teacher.html`. Nothing survives a stop.                                                                             |

### The v1 admin integration (EQ-Lab)

`/study-puzzles` dev API → spawns Codex's `generate.mjs`, one job, cancel =
discard; archive `tools/study-puzzles/archive/<set>/` + `set.json`; admin panel
with form, progress (found n / count), archive, viewer (Study board, answer
reveal, near-best).

### Probe findings (scratch prototype, 7 seeded self-play games, ~150 turns)

- Stage 5B can drive a whole game through the bot-lab environment: every
  chosen action was accepted by `env.applyAction`.
- **Three scorers agree on every placement** (Stage 5B, `amath_cli validate`,
  EQ-Lab `validateMove`): 0 mismatches.
- Study's own position derivation (`oppRackCount = min(8, unseen)`,
  `bagCount = unseen − oppRackCount`) and exchange gate matched the environment
  on every turn.
- Median Stage 5B call ≈ 0.45 s; outliers 7–11 s on blank-heavy racks
  (≈ 72 k legal moves). ≈ 20 s per game.
- **HOOK is real and rare** (corrected scan, §5): in 4 Stage 5B self-play
  games (68 positions, 84 221 legal moves from the canonical generator) —
  legal moves EXTEND 9 620 / CROSS 74 554 / **HOOK 47**, in 5 of the 68
  positions; top-50 candidates 13 HOOK of 2 407; Stage 5B best plays
  EXTEND 18 / CROSS 37 / **HOOK 1** of 56. An earlier probe reported "0
  multi-equation moves"; it advanced its games greedily, so it saw other
  positions — hooks cluster in a few positions. HOOK puzzles need long
  searches; the generator must be stoppable and show why positions are
  rejected.

### Engine representation of equations

- Stage 5B runtime and `amath_cli validate` return **totals only**.
- The canonical rules (bot-lab `validatePlacement`) collect **every run of two
  or more tiles through a new tile, in both directions**; each must be a valid
  equation and each is scored (`scorePlacement`: cells, per-tile `isNew`,
  multiplier, subtotal). The move generator reports a move as `mainRun` +
  `crossRuns`, each run split into `placed` and `reused` cells. The runtime
  does not expose any of it; exposing it would mean changing Codex's runtime.
- **EQ-Lab `validateMove`** (the validator `/play` scores players with, and the
  one that will judge a submission) returns every equation a move forms:
  direction, cells, text, per-equation score, multiplier, plus the bingo bonus.
  → used as the canonical equation source, and a puzzle is only accepted when
  its total equals Stage 5B's score **and** `amath_cli`'s.

### Fidelity notes on v1

- `topN` only truncates the returned list (`pipeline.ts`: `keepCandidates`
  slices after ranking), so topN 50 returns more candidates with the same answer
  as Study's topN 24.
- Study's endpoint keys its seed on cell tokens where a **plain** operator is
  its kind (`x`, `/`); v1's fixture used `×`/`÷`, so v1 seeds differ from what
  Study computes for the same board. v2 builds the request exactly as the Study
  endpoint does (`toStudyEngineRequest` + `studyFingerprint`).

### Missing for v2

Replayable source games (deal, moves, draws, bag), authentic racks only, scored
equations and their tiles, move type, composition, patterns, streaming /
partial sets, rejection accounting, a player-safe projection, attempt records,
raw difficulty features.

---

## 2. Architecture

```
admin panel ──HTTP──▶ dev API (/study-puzzles, api.mjs) ──spawn──▶ generator (run.mjs, own process group)
                            │                                            │
                            │◀──────── JSON lines (progress, accepted) ──┤
                            ▼                                            ├─▶ Stage 5B runtime (one process per call)
                     archive/<set>/                                      ├─▶ amath_cli worker (validate)
                       set.json            ◀── atomic rewrites ──────────┤
                       puzzles/<id>.json   ◀── one file per accepted ────┘
                       attempts/<puzzle>/<attempt>.json  ◀── /play submissions
```

**Self-play policy**: Stage 5B itself, asked exactly as Study's endpoint asks
(position only, `noScoreStreak 0`, position-keyed seed). One analysis per turn
therefore both chooses the source game's move and is the puzzle analysis of
that position. Consequence: the move actually played at a puzzle's turn _is_ the
engine answer — it is stored in the admin-only answer and never in anything a
player receives.

For guided puzzles, this statement applies to the **source** game. An isolated
rack branch gets its own ordinary Study request; its answer need not be the
move the source game plays. See §12 for that explicit provenance boundary.

**Rules / provenance**: the bot-lab environment and source-log records already
vendored for Survival (`tools/survival-generator/lib/rules.mjs`,
`lib/sourcelog.mjs`, `.vendor/`) are **imported read-only**. Study wraps them
in its own envelope (`study-source-log-v1`, a `puzzle` point instead of a
takeover) and replays through the same functions. Survival files are not
changed.

---

## 3. Data model

### Set manifest — `archive/<set>/set.json` (admin only)

```jsonc
{
  "schema": "eqlab-study-puzzle-set-v2",
  "id": "set-20260925-153000-ab12cd",
  "label": "…",
  "status": "running | complete | stopped | failed | interrupted",
  "createdAt": "…",
  "updatedAt": "…",
  "finishedAt": "… | null",
  "target": 10,
  "config": {/* §4, normalised */},
  "engine": {
    "analysis": "stage5b64",
    "runtimeSha256": "…",
    "validatorSha256": "…",
    "rulesVendor": {/* survival .vendor/PROVENANCE.json */},
    "generatorSha256": "…",
  },
  "counters": {
    "gamesStarted": 0,
    "gamesFinished": 0,
    "gamesAbandoned": 0,
    "positionsInspected": 0,
    "positionsAnalyzed": 0,
    "positionsEligible": 0,
    "candidatesEvaluated": 0,
    "matched": 0,
    "rejectedPositions": 0,
    "rejections": { "<reason>": 0 },
  },
  "error": null,
  "puzzles": [
    {
      "id": "pz-…",
      "file": "puzzles/pz-….json",
      "game": 3,
      "turn": 14,
      "score": 64,
      "tilesPlaced": 6,
      "moveTypes": ["CROSS", "HOOK"],
      "primaryType": "HOOK",
      "hooks": ["HEAD"],
      "equations": 2,
      "pattern": "NN O N = NN",
    },
  ],
}
```

Every puzzle file is written (temp + rename) **before** the manifest that lists
it, so any manifest on disk only lists complete puzzles.

### Puzzle — `archive/<set>/puzzles/<id>.json`

```jsonc
{
  "schema": "eqlab-study-puzzle-v2",
  "id": "pz-<12 hex of the position hash>",
  "setId": "…", "index": 0,
  "hashes": { "position": "<sha256 of the public position>", "puzzle": "<sha256 of canonical + answer>" },

  // A. canonical source & position — SERVER / ADMIN ONLY (holds hidden state)
  "canonical": {
    "source": {
      "game": 3, "seed": 12345,
      "policy": { "engine": "stage5b64", "request": "study-endpoint-equivalent", "topN": 50 },
      "log": {
        "format": "study-source-log-v1",
        "stateHash": "survival-state-hash-v1", "publicHash": "survival-public-hash-v1",
        "sourceRules": "eqlab-compat: …",
        "sourceSeed": 12345,
        "initial": { /* deal: both racks, ordered bag, scores, hashes */ },
        "turns": [ /* one exact record per turn before the puzzle turn */ ],
        "puzzle": { "turn": 14, "sideToMove": "B", "stateHash": "…", "publicHash": "…" }
      }
    },
    "position": {
      "sideToMove": "B", "turnNumber": 14,
      "board": [ { "r": 7, "c": 7, "kind": "x//", "face": "×", "side": "A", "turn": 2 } ],
      "rack": ["1", "4", "=", "x", "+/-", "?", "12", "7"],
      "scores": { "self": 211, "opponent": 296 },
      "bagCount": 34, "oppRackCount": 8,
      "noScoreStreak": 0,
      "unseen": { "0": 2, "1": 3 },
      "hidden": { "opponentRack": ["…"], "bag": ["…ordered…"] }
    },
    "studyRequest": { "board": [ { "r", "c", "kind", "token" } ], "rack": [], "scoreSelf": 0, "scoreOpponent": 0, "level": "stage5b64" }
  },

  // C. engine answer & analysis — ADMIN ONLY
  "answer": {
    "engine": { "solver": "stage5b", "request": { /* exact runtime request */ },
                "legalMoves": 545, "candidates": [ { "rank": 1, "type": "place", "placements": [], "score": 0, "value": 0, "components": [] } ] },
    "best": { "placements": [ { "r", "c", "kind", "face" } ], "score": 64, "value": 71.2, "components": [] },
    "nearBest": [ { "rank": 1, "score": 64, "value": 71.2, "placements": [] } ],
    "equations": [ { "role": "main | hook", "hookSubtype": "HEAD | TAIL | JOIN (hooks only)",
                     "direction": "horizontal | vertical",
                     "tiles": [ { "r", "c", "kind", "face", "new": true } ],
                     "text": "14 = 1 × 14", "pattern": "NN = N O H", "score": 42, "multiplier": 2 } ],
    "bingoBonus": 0,
    "moveTypes": ["CROSS", "HOOK"],          // every structural label that applies (§5)
    "primaryType": "HOOK",                   // display only: HOOK > EXTEND > CROSS
    "moveFacts": { "equationCount": 2,
                   "main": { "direction": "vertical", "tiles": 5, "placed": 4, "reusedSegments": [1] },
                   "hooks": [ { "subtype": "HEAD", "direction": "horizontal", "before": 0, "after": 5 } ] },
    "composition": { "digit": 3, "heavy": 1, "operator": 1, "choice": 0, "equals": 1, "blank": 0, "total": 6 },
    "patterns": { "main": "NN = N O H", "hooks": [] },
    "content": { "arithmetic": true, "fraction": false, "fractionSum": false, "large": false },
    "checks": { "stage5b": 64, "eqlab": 64, "amathCli": 64 }
  },

  "features": { "version": "study-difficulty-features-v1", /* §9 */ }
}
```

### B. Player-safe projection — computed on request, never stored

```jsonc
{
  "format": "study-puzzle-player-v1",
  "setId": "…", "puzzleId": "pz-…", "positionHash": "…",
  "position": { "board": [ { "r", "c", "kind", "face" } ], "rack": [], "scores": { "self": 0, "opponent": 0 },
                "turnNumber": 14, "bagCount": 34, "oppRackCount": 8, "unseen": { } },
  "rules": { "move": "place" }
}
```

Built from an allow-list and passed through a leak guard (§8).

### D. Attempt — `archive/<set>/attempts/<puzzle>/<attempt>.json`

```jsonc
{
  "schema": "study-puzzle-attempt-v1",
  "id": "att-…", "setId": "…", "puzzleId": "pz-…",
  "positionHash": "…", "puzzleHash": "…",
  "by": { "kind": "admin-preview" },
  "submittedAt": "…",
  "move": { "placements": [ { "r", "c", "kind", "face" } ] },
  "validation": { "valid": true, "score": 58, "equations": [ { "text": "…", "score": 58 } ], "errors": [] }
}
```

The canonical answer never changes; grading (same as best? within near-best?
score ratio?) is computed from `puzzleHash` + answer when an admin reads the
attempt, so it can be redefined without touching attempts.

---

## 4. Filter semantics

All ranges are **inclusive**; `null` = Any. Counted on the tiles the **best
play actually places**, by canonical kind:

| Category | Kinds                        |
| -------- | ---------------------------- |
| digit    | `0`–`9`                      |
| heavy    | `10`–`20`                    |
| operator | `+` `-` `x` `/` (plain)      |
| choice   | `+/-` `x//`                  |
| equals   | `=`                          |
| blank    | `?` (whatever face it takes) |
| total    | all placed tiles             |

```jsonc
{
  "target": 1–50, "label": "", "seed": 0–2147483647,
  "maxPerGame": 1–5,            // puzzles taken from one source game (seeded pick among its matches)
  "parallelGames": 1–4,
  "position": { "boardTiles": { "min": 12, "max": 65 } },
  "bestPlay": {
    "score": { "min": null, "max": null },
    "tiles": { "min": null, "max": null },
    "equations": { "min": null, "max": null },
    "moveTypes": [],                                  // any of EXTEND / CROSS / HOOK, OR-ed; [] = any
    "composition": { "digit": {…}, "heavy": {…}, "operator": {…}, "choice": {…}, "equals": {…}, "blank": {…} },
    "content": "any | arithmetic | fraction | fraction-sum | large"
  },
  "answer": { "maxNear": 1–12 },                      // v1's clarity filter (default 4)
  "rack": { "minDifficulty": null | 2–6 }             // v1's rack index
}
```

Statically impossible configurations are refused before anything runs (a
search that can never match would otherwise run until stopped): min > max;
composition minimums summing past `tiles.max` (≤ 8); only HOOK selected with
`equations.max < 2` (a hook always scores a second equation). Because the
labels are OR-ed, e.g. CROSS with `equations.min = 2` is possible (a CROSS +
HOOK move).

A position is **eligible** when the board-tile range holds and the best action
is a placement. An eligible position is **matched** when every filter holds.
Rejections are counted **per failing criterion** (non-exclusive) plus a
`rejectedPositions` total, so the counts show which constraint binds.

---

## 5. Move-type classification — EXTEND / CROSS / HOOK labels

Computed by `classifyMove` (`lib/analysis.mjs`) from the **structure** of the
scored runs: each run's cells in reading order and which of them this move
placed. That is exactly what the canonical generator reports (`mainRun` +
`crossRuns`, `placed` / `reused`) and what the canonical scorer and EQ-Lab's
`validateMove` break a score into; the generator uses EQ-Lab's (the validator a
submission is judged by) and requires all scorers to agree on the total.

- **main run** — the run along the line of the placed tiles (for a single
  tile: its longer run, horizontal on a tie).
- **main-line board segments** — the board tiles the main run reads through,
  as maximal runs of neighbours along it (`reusedSegments`: `[5]` is an
  equation it extends, `[1, 1]` two lines it crosses).
- **hooks** — every other scored run. Under the rules each runs through exactly
  **one** new tile, and all its other tiles were already on the board and touch
  that tile. Subtype: **HEAD** (the new tile starts it), **TAIL** (ends it),
  **JOIN** (board tiles on both sides: two pieces joined into one equation).

A move carries **every** label that applies — the labels are not exclusive:

| Label      | When                                                                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **EXTEND** | a main-line board segment of ≥ 2 tiles: an equation already on that line, lengthened or joined at its head or tail. A lone tile on the end of an equation is EXTEND (one run, no hook). |
| **CROSS**  | a main-line board segment of exactly 1 tile: a line the main line passes through.                                                                                                       |
| **HOOK**   | at least one hook: the same placement also completes / extends existing material into another scored equation.                                                                          |

`moveTypes` holds all of them (e.g. `["CROSS", "HOOK"]`); `primaryType`
(HOOK > EXTEND > CROSS) is derived display metadata only. The admin filter is
**inclusive (OR)**: a selected label matches any move containing it; several
may be selected; `[]` is any. `moveFacts` keeps the segments and every hook's
subtype, direction and board tiles before/after the new one, so the labels can
be recomputed under another rule without regenerating.

A hook is always a second scored run and a second scored run is always a hook,
but the classifier reads the structure, so it says which equation was hooked
and how, keeps the main line's own relation, and does not depend on how the
generator labels a lone tile's run.

### Verification (2026-09-25)

Hand-built fixtures (`tests/classify.test.mjs`), each proved legal with the same
score by EQ-Lab `validateMove`, the vendored environment's transition and move
generator, and `amath_cli validate` (the first two also by the canonical
scorer's own breakdown) before they are classified:

| Board → placement                           | Main                              | Hooks                                | Labels        |
| ------------------------------------------- | --------------------------------- | ------------------------------------ | ------------- |
| `5 × 0 = 0`; `3 - 1 = 2` down C5            | `3 - 1 = 2` (6)                   | HEAD `15 × 0 = 0` (8) — total 14     | HOOK          |
| `-9 = -9`; `5 + 0 = 5` down C5              | `5 + 0 = 5` (8)                   | HEAD `0 - 9 = -9` (10) — total 18    | HOOK          |
| `0 = 0 × 5`; `3 - 1 = 2` down C11           | `3 - 1 = 2`                       | TAIL `0 = 0 × 51`                    | HOOK          |
| `0 = 0 × 1` (col) + `3 = 3`; `2 = 2` on R8  | `2 = 2`                           | JOIN `0 = 0 × 123`                   | HOOK          |
| two `5 × 0 = 0`; `41 = 41` down C5          | `41 = 41`                         | HEAD `15 × 0 = 0`, HEAD `45 × 0 = 0` | HOOK          |
| `5 × 0 = 0` + `2 = 2`; `3 - 1 =` onto the 2 | `3 - 1 = 2` (segments [1])        | HEAD `15 × 0 = 0`                    | CROSS, HOOK   |
| `5 × 0 = 0`; lone `1` at its head           | `15 × 0 = 0` (segments [5])       | —                                    | EXTEND        |
| `2 = 2`; `+ 0` after it                     | `2 = 2 + 0` (segments [3])        | —                                    | EXTEND        |
| `5 × 0 = 0`; `= 0` down from its last 0     | `0 = 0` (segments [1])            | —                                    | CROSS         |
| `2 = 2` + `0 = 0` (col); `+ 0 … 2` along R8 | `2 = 2 + 0 = 2` (segments [3, 1]) | —                                    | EXTEND, CROSS |

Real games (4 Stage 5B self-play games, 68 positions): legal moves
EXTEND 9 620 / CROSS 74 554 / HOOK 47 (5 positions); top-50 candidates 13 HOOK
of 2 407; best plays EXTEND 18 / CROSS 37 / HOOK 1 of 56 — seed 11, turn 8:
`2 + 3 = 17 - 12` (32) whose `-` heads `260 × 0 + 15 + 4 = 19` into
`-260 × 0 + 15 + 4 = 19` (54), total 86. The classifier over EQ-Lab's runs and
over the canonical scorer's runs agreed on all 2 407 candidates.

## 6. Answer pattern

Per scored equation, tiles in board order; neighbouring number tiles join into
one number token:

- `N` digit tile, `H` heavy tile, `O` operator (plain or choice), `=`.
- A blank takes the category of its face (`?`→`5` is `N`, `?`→`13` is `H`);
  the tile list keeps `kind: "?"` + `face`, so provenance is never lost.
- `5 + 8 = 13` from digit tiles → `N O N = NN`; with a 13 tile → `N O N = H`;
  `100 ÷ 20 = 5` → `NNN O H = N`.

`patterns.main` and `patterns.hooks[]` (one per hooked equation) are stored; the
pattern is **admin-only** (it describes the answer).

---

## 7. Bounded generation & cancellation

- The dev API spawns `generator/run.mjs` **detached** (own process group) with
  the normalised config; it reads JSON lines from its stdout.
- The generator runs `parallelGames` games at once. Game _k_ uses seed
  `fnv(setSeed:k)`. A game keeps only its own state and its turn records
  (≤ ~40); each Stage 5B result is reduced to what a puzzle needs and dropped.
- Game results are **committed in game order** (a finished game waits for the
  earlier ones), so a set is determined by its config + seed, not by timing.
- Accept path: puzzle file → manifest (both temp + rename).
- Stops when `matched == target` or on **SIGTERM** (admin Stop): kill tracked
  children (runtime, validator), write the manifest as `stopped` with the
  puzzles already committed, exit. The API sends SIGKILL to the whole group
  after 5 s if needed, and marks a manifest still `running` as `interrupted`.
- If the dev server dies, the generator sees stdin close and stops the same way.
- No attempt limit. Memory is bounded by `parallelGames × one game`; logs are a
  60-line ring buffer; counters are integers.
- Live counters: games started / finished / abandoned, positions inspected
  (= analysed: every turn is one Stage 5B call), eligible, evaluated, matched /
  target, rejections by reason, elapsed, rate.

## 8. Boundary

|                               | Where                                                       | Who                            |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------ |
| A canonical source & position | puzzle file `canonical`                                     | server + admin                 |
| B player projection           | `GET …/puzzles/:id/play`, built from an allow-list          | player (`/play`)               |
| C answer & analysis           | puzzle file `answer`, `features`; set `config`, `puzzles[]` | admin only                     |
| D attempts                    | `attempts/…`                                                | written by play, read by admin |

The leak guard refuses to send a projection containing any of: `answer`,
`best`, `nearBest`, `candidates`, `equations`, `pattern(s)`, `moveType`,
`composition`, `features`, `value`, `components`, `hidden`, `bag`,
`opponentRack`, `seed`, `stateHash`, `log`, `config`. Set filters are admin-only
too: "HOOK with a blank" describes the answer. A submission response
carries only the player's own validation (`attemptId`, `valid`, `score`,
`yourEquations`) — the same shape whether or not the move is the engine's; the
grade (`sameAsBest`, `engineRank`, …) is computed only when an admin reads the
puzzle. On `/play` the submitted move is applied without a refill, so no tile
is drawn and nothing of the bag order reaches the page; Exchange and Pass are
disabled (the answer is one placement).

## 9. Difficulty

Stored raw (`study-difficulty-features-v1`): legal moves; candidate values and
scores (top 50); value gap best→2nd and best→3rd; score gap; near-best count;
rank of the highest-scoring candidate (does the best play differ from the
greedy one?); tiles placed; equations; move type; composition; pattern length
and longest number; blank / choice use; bingo; board tiles; bag count; turn;
score difference; rack index.

**Not** shown as a percentage in this iteration. Proposed separately:
`study-difficulty-est-v0` = logistic(Σ wᵢ·zᵢ) over z-scored features, with
published weights, labelled "estimated", to be replaced by a model calibrated on
real solve rates once attempts exist.

## 10. Files

New: `generator/run.mjs`;
`lib/{config,engine,selfplay,analysis,filters,generate,record,archive,provenance}.mjs`;
tests `tests/{classify,generator,api}.test.mjs` (+ `tests/fake-engine.mjs`, a greedy
stand-in for Stage 5B); `src/features/studyPuzzles/play.ts`;
`src/components/admin/StudyPuzzle{Form,JobPanel,SetView}.tsx`, `studyPuzzleLabels.ts`;
`tests/study-puzzle-play.test.tsx`; fixture `tests/fixtures/study-puzzles/v2-hook-set.json`
(the real HOOK proof set below, engine candidates cut to the top 5).
Changed: `server/api.mjs`; `src/features/studyPuzzles/api.ts`;
`src/components/admin/StudyPuzzle{AdminPanel,SetViewer}.tsx`, `study-puzzles.css`;
`src/App.tsx` (one-turn puzzle mode, like Survival's); `src/playModeTools.ts`;
`src/components/actions/ActionPanel.tsx`, `src/components/mobile/MobileActionBar.tsx`
(optional `canPass`, default true); `tests/study-puzzle-admin.test.tsx`.
Unchanged: Codex's generator, amath-engine, amath-bot-lab, Survival, Supabase.
v1 sets stay readable in the archive.

## 11. Targeted proof run (2026-09-25)

One set per label, target 1, through the admin page (real Stage 5B), into the
real archive:

| Set                                           | Filter             | Found              | Puzzle                                                                                                                                |
| --------------------------------------------- | ------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `set-20260925-133247-7901da` "พิสูจน์ EXTEND" | EXTEND, score ≥ 40 | 7 s, 20 positions  | game 0 turn 3, 81: C8 `21 = 10 - 4 + 15` extended by `× 12 ÷ 9 - 5` (segments [8]) → EXTEND                                           |
| `set-20260925-133444-6670f3` "พิสูจน์ CROSS"  | CROSS, score ≥ 60  | 13 s, 42 positions | game 0 turn 9, 68: C12 `11 + 5 ÷ 6 × 18 = 26 = 7 + 19` through the lone `18` and onto `26 = 7 + 19` (segments [1, 6]) → EXTEND, CROSS |
| `set-20260925-133523-ea3e0b` "พิสูจน์ HOOK"   | HOOK               | 18 s, 63 positions | game 2 turn 5, 33: C3 `4 = 0 + 4` (16) whose `0` heads `-3 + 9 - 11 = -5` into `0 - 3 + 9 - 11 = -5` (17) → HOOK [HEAD]               |

For each: Stage 5B = EQ-Lab = `amath_cli` on the score; the source log replays
to the exact stored position (and position hash) from the seed and from the
log alone, directly and through `/verify`; the projection has no forbidden key,
no answer square, the authentic rack, and the unseen tiles only as one pooled
multiset (= hidden bag + opponent rack). On `/play` the HOOK puzzle took two
admin-preview attempts — engine #26 (`4 - 3 + 9 - 11 = - 5 + 4`, 22) and the
answer (33) — each answered with the player's own score only, each saved as its
own attempt file, graded on the admin read (rank 26 / same as best), the puzzle
file untouched.

## 12. Guided rack search

### Boundary and compatibility

`search.strategy` is `GUIDED` (new jobs/UI default) or `AUTHENTIC_ONLY`.
`search.rackBudget` is 1–64, default 24; the UI offers Fast 8, Balanced 24,
Deep 64. The generator runs a set only when its stored configuration is exactly
what the current normaliser makes of it (`configDrift` is empty). Anything else
— an old manifest without `search`, or one filed by a dev-server API still
running older code — fails before any game starts, naming the fields that
differ, instead of reading a missing field as "no bound" (see §14). v1 and
earlier v2 archive reads (listing, viewing, verification, play) do not migrate
data and are unchanged.
The player format, attempts, grading, one-turn `/play`, and all final filters
are unchanged. Tile counts still count **new physical tiles**, never reused
board cells or a blank's assigned face.

`selfplay.mjs` owns the authentic state. Before continuing a turn it offers
search a deep copy and a memoized authentic analysis. The source advances
only by its original Study-equivalent Stage 5B action and canonical transition.
Branches cannot reach the source's arrays, manifest maps, seed, RNG step, or
turn records. There is no mutate-and-undo path.

Available tiles for rack construction are **both original racks plus bag**,
equivalently the canonical inventory minus the visible board. The source
player's original rack returns to this allocation pool. Known set-aside tiles
are never silently redistributed (branch construction refuses such states).
Rack size and opponent/bag counts remain those of the source. The branch
selects existing physical identities, then allocates the remainder in canonical
physical-ID order to the opponent and bag. The canonical environment checks
that all 100 identities occur once. This ordering is a reconstruction rule,
not a claim about the source seed's draws.

### Pipeline

1. Reject impossible placed-category totals, per-category inventory minima,
   min/max contradictions, and impossible equation-count bounds. Multi-label
   selection stays OR; rarity alone never makes a configuration invalid.
2. Check existing position limits and necessary board geometry. Enumerate
   contiguous horizontal/vertical spans bounded by board edges and existing
   neighbors, count empty cells and perpendicular contacts, and retain any
   span that could fit the requested size, labels, and equation count. This
   deliberately over-approximates legal placements. No heuristic score bound
   or approximate equation evaluator rejects a position.
3. Test whether some subset of the authentic rack can meet placed-category
   minima/maxima and tile count. If so, independently evaluate its actual
   rank 1 and prefer an authentic match. Otherwise skip it **as a puzzle
   candidate**. Its normal Stage 5B call is still required later to advance
   the authentic game; instrumentation distinguishes that unavoidable work.
4. Propose at most the configured number of unique legal rack multisets.
   Candidate ordering uses source public position hash, normalized config,
   search seed, and `study-guided-racks-v1`. Arithmetic-value suggestions,
   diverse values, repeated values, and inventory-weighted proposals are
   interleaved. Required categories come first; fill slots respect the
   capacity necessary to place the minimum tiles. Awkward/unlikely racks are
   allowed; there is no probability or general rack-strength cutoff.
5. For restrictive, nonblank racks, optionally run the existing canonical
   complete move generator, with an 80 ms cooperative budget. The initial
   three-rack profile measured 60–168 ms versus 459–585 ms for Stage 5B.
   A complete, untruncated enumeration can prove there is no qualifying legal
   move. Interrupted/truncated work is **unknown** and always passes through.
   Blank-heavy and unrestricted cases skip this optional layer.
6. Stage 5B receives a normal position-only Study request. Only its rank 1
   is considered. Every existing final filter still applies, followed by
   EQ-Lab/C++ score agreement and replay/reconstruction checks.

After a failed budget, all branches are discarded and the memoized or freshly
computed original Stage 5B action continues the source game. A guided game
stops being searched once it supplies `maxPerGame` matches. Authentic-only
keeps its original seeded selection among the whole game's matches. Games
are committed in source-game order, independent of completion timing.

A per-job set of evaluated position hashes includes the engine/config/search
version namespace. It remembers negative cheap checks too; duplicate racks
are skipped before further work. Authentic analysis is shared with source
continuation. No persistent answer cache or external storage is introduced.

### Provenance and verification

New records store `canonical.provenance.origin`: `AUTHENTIC_SEEDED` or
`CONFIG_GUIDED_RACK`. Missing provenance in old v2 means authentic seeded.
Guided provenance keeps the source turn, source public hash, full source state
hash, original rack, constructed rack, remaining unseen multiset, allocation
version, proposal strategy version, family, index, deterministic candidate seed,
and resulting puzzle position hash. Source game index/seed/log remain in
`canonical.source` as before. These are all admin-only.

`verifyProvenance` replays seed and log independently. Authentic puzzles must
still reproduce their **entire exact puzzle position**. Guided puzzles must
reproduce their authentic source state, then legally reconstruct the branch
and match its entire stored position, remaining hidden allocation, and hash.
`/verify` additionally checks the puzzle checksum, reruns Stage 5B's rank 1,
and invokes EQ-Lab and C++ independently. Its admin result separates source
replay, source state, legal rack, tile conservation, position hash, checksum,
and all three answer checks. Player projection remains an allow-list; the
leak guard now also refuses origin/construction metadata.

### Progress and Stop

Counters distinguish visited source positions, geometry/position skips,
authentic composition skips, generated/cheap-pruned guided racks, source and
guided Stage 5B calls, elapsed engine/preflight time, matches, accepted origins,
duplicates, and engine errors. Final-filter rejection reasons remain available.
Admin diagnostics show mean engine latency, yield per call, and pruning counts.

Stop aborts new work, propagates to canonical preflight, and kills tracked
engine children. Rack loops yield to the event loop even when every rack is
cheap-pruned. Every worker unwinds before final archive draining, so completed
matches are retained and no late worker can write after the terminal manifest.
The detached process-group fallback and atomic puzzle-before-manifest writes
remain unchanged.

### Validation and bounded benchmark

`tests/guided.test.mjs` covers construction, physical conservation, source
isolation/continuation, deterministic diverse proposals, impossible configs,
safe pruning, provenance tampering, and projection. Generator/API tests cover
authentic preference, constructed acceptance, rank-2 refusal, cancellation,
fresh verification and submission/grading. Existing classification fixtures
also assert they survive geometry pruning.

`benchmark.mjs` runs the motivating CROSS / score 60–120 / 8 new tiles /
exactly one equation / at least 7 digits + 1 choice / trivial-zero exclusion,
target 1, seed 1926514385, two games, maxNear 4, 60 seconds maximum. Both
runs use the same filters and source seeds. The original algorithm's baseline
was 152 inspected positions, 154 engine calls started (152 completed), no
accepted puzzle in 60.006 seconds. Results are recorded separately; a timeout
without a match is not evidence of an elapsed-time speedup.

## 13. Additive puzzle specification (before Search Learning)

The specification has six distinct dimensions: the **whole puzzle rack**
(`rack`), **new tiles placed by Stage 5B rank 1** (`bestPlay`), **move geometry**
(`geometry`), **scored-equation geometry** (`equation` tile ranges), **equation
mathematics** (`equation.properties`), and **position mobility** (`mobility`).
Score, near-best uniqueness, board size and
the legacy content/difficulty filters retain their original fields. All range
ends are inclusive; `null` or an absent new field means no bound. An exact N is
`{min:N,max:N}`. The archive schema strings stay v2 because these fields are
optional/additive and the player projection is an explicit allow-list.

### Physical composition

`rack.size`, `rack.groups`, and `rack.specific` describe *all* physical tiles
in the puzzle player's hand. `bestPlay.tiles`, `bestPlay.composition`, and
`bestPlay.specific` describe only tiles newly placed by the rank-1 move. A
reused board tile never contributes to a placed-tile count. The two sets of
constraints are simultaneous but independent: an unused tile in the rack can
satisfy a rack requirement, never a placed-tile requirement. Specific keys are
the canonical manifest kinds: digits `0`–`9`, heavy tiles `10`–`20`, `+`, `-`,
`x`, `/`, `+/-`, `x//`, `=`, `?`. Choice/blank assignments do not change physical
kind counts. Unknown kinds and minima above physical inventory are rejected.

The six disjoint base groups are `digit`, `heavy`, `operator` (plain `+ - x /`),
`choice` (`+/-`, `x//`), `equals`, `blank`. Two overlapping groups are
`arithmetic` = operator + choice (excludes `=`), and `operatorLike` =
arithmetic + equals. Group and specific ranges *all* apply; their minima and
maxima are checked against the canonical 100-tile inventory and the maximum
eight-tile rack/placement before engine work. A request such as
`rack.groups.arithmetic=2..4`, `rack.specific.x=1`,
`rack.specific["-"]=1..2` is legal. Guided rack proposals first reserve these
specific and group minima, enforce rack maxima while filling, reject duplicate
multisets, and only submit racks with an exact feasible subset for the placed
requirements. This proposes a rack, never a move or an engine ranking.
The API and Admin also reject a rack specification that cannot contain the
minimum physical kinds required by the best play, even if each dimension is
individually feasible.

### Move and scored-equation geometry

The existing EXTEND/CROSS/HOOK labels remain inclusive and unchanged. An
EXTEND main run has at least one contiguous reused-board segment of length two
or more. For every such segment, a newly placed tile immediately before it in
reading order extends its **head**; one immediately after extends its **tail**.
The resulting `answer.geometry.extend.shape` is `HEAD_ONLY`, `TAIL_ONLY`, or
`BOTH`. Thus board `9 = 9` becoming `0 + 9 = 9 × 1` is `BOTH`. If two old
segments are joined, the extension can have a head contact on one and a tail
contact on the other. Contact tuples are always
`(existing boundary/anchor face category, immediately adjacent new face
category)`, independent of which side is extended. `headContact` and
`tailContact` are stored separately. If a main run joins several old segments,
`headContacts` and `tailContacts` retain every boundary pair in reading order;
the singular fields are the first pair for compact display. A selected pair
matches if it is present on the requested side. Face categories are `DIGIT`,
`HEAVY_NUMBER`, `ARITHMETIC_OPERATOR` (`+ - × ÷` only), and `EQUALS` (`=`
only). A choice or blank uses its assigned *face* for contact geometry, while
composition uses its physical *kind*. `geometry.extend.shapes` accepts any
selected shape (empty = all); each nonempty head/tail contact list accepts any
listed pair at that side. Detailed HOOK controls are deferred.

Each scored equation retains canonical `tiles` with per-cell `new`. Its
`tileCount` is the number of physical cells, `placedParticipating` is the
number of those cells newly placed by this move, and `reusedBoardTiles =
tileCount - placedParticipating`. In a multi-equation move, these are per
equation; the move's `bestPlay.tiles` need not equal every equation's
`placedParticipating`. A CROSS can therefore require four new tiles in the
move, seven cells in a scored equation, and three reused cells in that
equation. Never derive tile counts from display-string length.

`equation.scope` is `MAIN` (the canonical main run), `ANY` (at least one
scored equation satisfies **all** specified equation predicates), or `ALL`
(every scored equation satisfies all predicates). Its ranges are
`equation.tiles`, `equation.placedParticipating`, and
`equation.reusedBoardTiles`. Its `properties` set can contain:

- `FRACTION_ADD_SUB`: binary addition/subtraction with a fractional operand;
- `MUL_DIV_ONLY`: at least one binary arithmetic operation, all of them ×/÷;
- `FRACTION_RESULT`: the exact common equation value has denominator > 1;
- `LARGE_INTEGER_RESULT`: the exact common value is integer and its absolute
  value is strictly greater than `largeIntegerThreshold` (default 1000);
- `NEGATIVE_RESULT`: the exact common value is less than zero.

The scored equation was already accepted by EQ-Lab. Its physical tile faces
are parsed with the canonical unary-minus and arithmetic-precedence grammar;
the semantic calculations use normalized BigInt rationals. Display strings
are never parsed for the new properties. The older `bestPlay.content` tags
remain for archive and preset compatibility and retain their old meanings.

### Canonical mobility and verification

`mobility.legalPlacements` constrains the number of unique canonical *place*
actions available from this rack on this board. Pass and Exchange are
excluded. The canonical move generator's deduplicated IDs are counted; no
second legality engine is used. With a configured maximum M, guided preflight
can abort at M+1 unique moves and safely reject, storing only a lower bound.
An accepted constrained puzzle stores `features.legalPlacementCount` and
`legalPlacementCountExact: true` from a complete generation. Unconstrained
puzzles do not pay to calculate or claim this exact metric. The older
`features.legalMoves` and `rack.minDifficulty` remain readable but are not the
new mobility definition.

Every final filter runs against Stage 5B's unrestricted rank-1 action after
canonical EQ-Lab analysis. A matching rank 2 never qualifies. Fresh
verification replays source provenance, rederives stored equation and contact
facts, rechecks the expanded specification for new sets, and reruns Stage 5B,
EQ-Lab and C++. Neither new admin analysis nor the hidden rack allocation is
included in the player projection. Search Learning and adaptive policies are
explicitly deferred.

The bounded real-engine examples and replay results are recorded in
`SPECIFICATION_PROOFS.md`. The guided A/B examples are also retained as
admin-only test fixtures.

## 14. One configuration from the form to the generator (2026-09-26)

The admin's specification crosses three processes: the page (Vite, hot-reloaded),
the dev API (`server/api.mjs`, imported by `vite.config.ts` on its first request
and kept until `npm run dev` exits) and one generator per set (`generator/run.mjs`,
spawned fresh, so always the code on disk). The "26 Sep" set showed what happens
when they disagree: an `npm run dev` started before §12/§13 kept the pre-guided
`configFrom`, which rebuilt each request from the §4 fields it knew and dropped
`search`, every `rack` range, `bestPlay.specific`, `geometry`, `equation` and
`mobility`. The generator read the missing `search` as authentic-only and every
missing range as "no bound", and the final matcher correctly accepted puzzles
against that weaker specification (29 sets filed that way, 38 puzzles).

Two checks now make any such disagreement loud, and neither changes what a
configuration means:

- **Generator** — `configDrift(stored)` must be empty: the stored configuration
  must already be exactly what `configFrom` makes of it. Otherwise the set is
  written `failed` before any game starts, the error naming the differing fields,
  and nothing is searched. This works even against an API that predates the
  check, because the generator is always current.
- **API** — it hashes `server/api.mjs`, `generator/run.mjs` and `lib/*.mjs` when
  it loads, and answers `503` to generate and verify once the files on disk hash
  differently (reading the archive, play and attempts are unaffected). Restart
  `npm run dev` after editing this tool.

Sets filed before this remain readable exactly as filed; their stored
configuration is the evidence of what was actually enforced.
