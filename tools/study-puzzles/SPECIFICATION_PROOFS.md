# Study v2 specification proofs

Small, local proofs run against the unchanged Stage 5B, EQ-Lab validator and
C++ validator. The two guided puzzles are preserved as admin-only test
fixtures in `tests/fixtures/study-puzzles/`. The five authentic proofs were
requalified from previously archived, replayable self-play positions; each
was freshly sent to Stage 5B and rebuilt with the new analysis fields. This is
specification verification, not a search-speed benchmark.

| Case and requested new constraints | Origin, rack and rank-1 scored equation | Derived facts | Fresh verification |
| --- | --- | --- | --- |
| **A — specific rack**: size 8; arithmetic 2–4; `x` exactly 1; `-` 1–2 | Guided; `0 2 4 6 - x x// =`; 72 points; `42 - 6 × 0 = 14 × 3 = 42` | EXTEND HEAD_ONLY; seven placed, 13 equation cells, six reused | source replay, rack legality, conservation, specification, Stage 5B, EQ-Lab, C++ PASS |
| **B — CROSS 4/7/3**: CROSS; place exactly 4; MAIN equation exactly 7; exactly 3 reused and 4 participating new. Proof search additionally excluded blank and choice from the rack. | Guided; `0 2 5 9 10 17 x /`; 22 points; `90 ÷ 45 = 2` | CROSS; four placed, seven equation cells, three reused | all checks PASS |
| **C — EXTEND head**: EXTEND HEAD_ONLY | Authentic; `0 6 6 7 13 +/- +/- +/-`; 30 points; `- 6 + 6 + 380 ÷ 19 - 2 = 18` | head contact `(DIGIT, ARITHMETIC_OPERATOR)` | all checks PASS |
| **D — EXTEND tail**: EXTEND TAIL_ONLY | Authentic; `4 4 5 5 18 + + +/-`; 66 points; `328 = 309 + 19 + 54 - 54` | tail contact `(HEAVY_NUMBER, ARITHMETIC_OPERATOR)` | all checks PASS |
| **E — EXTEND both**: EXTEND BOTH | Authentic; `1 2 2 3 4 x x +/-`; 109 points; `2 × 3 × 24 - 13 = 131` | head `(HEAVY_NUMBER, ARITHMETIC_OPERATOR)`; tail `(DIGIT, DIGIT)` | all checks PASS |
| **F — low mobility**: 1–5 unique legal placements | Authentic; `4 6 11 12 19 / x// x//`; 52 points; `4 = 4 = 8 ÷ 264 × 11 × 12` | exactly **3** placement actions; Pass/Exchange excluded | all checks PASS, exact count remeasured |
| **G — exact equation semantics**: CROSS; MAIN `MUL_DIV_ONLY` + `FRACTION_RESULT` + `NEGATIVE_RESULT` | Authentic; `1 3 3 6 +/- +/- x// x//`; 57 points; `- 12 ÷ 36 = - 1 ÷ 3` | exact result **−1/3**; no + or − binary operation | all checks PASS |

The authentic source boards had 14, 70, 40, 73, 4, 65, and 25 occupied
cells for A–G respectively. Rank-1 new placements below use one-based board
coordinates; existing cells used in the equations remain in each full proof:

- A: R8C1–R8C7 `4 2 - 6 × 0 =`.
- B: R9C4 `0`, R10C4 `÷`, R12C4 `5`, R14C4 `2`.
- C: R6C1–R6C5 `- 6 + 6 +`.
- D: R14C10–R14C15 `+ 5 4 - 5 4`.
- E: R8C1–R8C7 `2 × 3 × 2 4 -`, plus R8C12 `1`.
- F: R9C13–R14C13 `6 4 × 11 × 12`.
- G: R3C7 `-`, R5C7 `÷`, R6C7 `3`, R7C7 `6`, R9C7 `-`, R10C7 `1`, R11C7 `÷`, R12C7 `3`.

The board, placement coordinates, source log, hidden allocation, engine
candidates, and individual verification checks are in the proof puzzle JSON
files. The B proof is `v2-cross-4-7-3.json`; the A proof is
`v2-specific-rack.json`. The authentic source positions are the archived
puzzles named in `requalify-proofs.mjs`.

For B, two ordinary guided source-game runs (45 seconds each) found no
matching board/rank-1 combination. A 60-second isolated-rack run on known
authentic boards also found none. A second bounded branch run with no
blank/choice tiles found the B proof in 3.55 seconds: two authentic boards
considered, 90 guided racks generated, 89 safely rejected by the complete
canonical legal-move preflight, and **one** unrestricted Stage 5B call. This
is an existence proof, not a general speedup claim. The 4/7/3 requirement
was never relaxed.

**Re-verified 2026-09-26** after the configuration-boundary fix (DESIGN §14),
with the current code and the real engine, each against its own stored
configuration: A–G all PASS every check (source replay, rack legality,
conservation, checksum, specification, Stage 5B, EQ-Lab, C++); every stored
configuration is already in the current normalised form (no drift); both guided
fixtures are byte-identical to their proof-run output. None of these proofs went
through the dev-server API, so none depended on the stale-API defect. Nothing was
regenerated or edited.
