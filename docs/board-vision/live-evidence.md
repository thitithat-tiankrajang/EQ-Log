# Board Vision: from camera frames to a Study position

Status: implemented and tested:

- the geometry gate (`boardLock.ts`, `tests/board-vision-tracking.test.ts`);
- the evidence layer (`observation.ts`, `completion.ts`,
  `tests/board-vision-fusion.test.ts`).

The camera, a real tracker, board detection and the two-stage recogniser are
NOT connected (see the end).

## The live path

```
camera (camera FPS)
 → board acquisition: automatic detector (NOT IMPLEMENTED) or a person's corners + confirmation
 → board lock (boardLock.ts: manualLock / lockStep)             ← every camera frame
 → tracking: quad + correspondence per frame (real tracker NOT IMPLEMENTED; simulator today)
 → geometry quality gate (assessGeometry)                        ← every camera frame
 → selected inference frames (scanner.ts: one in flight, spaced, usable only)
 → canonical crops (crops.ts, through the lock's quad for THAT frame)
 → Stage 1 occupancy → Stage 2 identity when applicable (Stage 2 NOT IMPLEMENTED)
 → gateObservation(snapshot of that frame's lock, observation)
 → multi-frame evidence (EvidenceAccumulator)
 → completion (assessCompletion) → reconstruct → verification → Study
```

## Geometry: the board lock

`boardLock.ts` answers one question per camera frame: where is the same
physical board, and is that alignment safe enough to cut squares from? It
never looks at tile content.

**A wrong square is worse than no square.** Evidence written into a
neighbouring square poisons fusion. In the simulator, three earlier correct
views happened to hide it, but a square seen only after a slip would take the
wrong reading. So every check fails closed.

States: `searching → candidate → locked ⇄ degraded → lost → recovering →
locked`, and `lost` for too long returns to `searching`. Inference is allowed
**only in LOCKED** with every gate passed.

| gate | rule (`DEFAULT_LOCK_POLICY`, provisional) |
|---|---|
| winding / convexity | crossed, mirrored or non-convex quads are refused (`validateQuad`) |
| size | median square ≥ 16 px; a square smaller than that is not read |
| perspective | largest / smallest projected square area ≤ 6; corner angles 35°–145° |
| clipping | a square must be ≥ 85% inside the image; the frame needs ≥ 20% of squares readable |
| **motion** | frame-to-frame grid motion ≤ min(0.45, 0.1 + 4 squares/s · dt) squares. **The cap is always below half a square**, so a jump to a neighbouring square is never believed |
| shape | side-length ratios may change at most 15% per frame (homography stability) |
| blur | motion blur ≤ 10% of the median square side (when the producer reports it) |
| correspondence | the tracker's own confidence that these are the SAME corners: ≥ 0.8 to read, ≥ 0.9 to re-lock after a loss, < 0.3 counts as not found |
| occlusion | only from an explicit per-square mask (> 30% covered: not read). Geometry never guesses a hand |

- **A refused jump is never believed.** The last believed quad (`anchor`)
  stays the motion reference. Persistent refusals count as misses and lead to
  LOST, and re-locking then needs strong correspondence and 5 consistent
  frames.
- **Per-square mask.** Every frame yields a 225-square mask (`cells`: eligible
  / visibility / reason: clipped, too small, occluded). `gateObservation`
  turns ineligible squares into `null`, which means no evidence, never
  "empty". It refuses the whole observation unless it was cut through the
  usable lock of its own frame.
- **Asynchronous inference.** Recognition is slower than the camera. The
  caller keeps the lock snapshot of the frame it sent and judges the result
  by that snapshot, not by the lock at arrival time.
- **Canonical board.** 780 × 780 px = (15 + 2 × 0.3) squares × 50 px. One
  square is **50 px** (the 0.3-square margin on each side makes up the rest).

Simulated canonical error of usable frames (tracker noise σ = 0.5 px): mean
≈ 0.55 px, worst 1.7–3.1 px, which is ≤ 0.06 of a square across stable,
translation, rotation, 45° perspective, zoom, clipping and recovery.

**Limitation (by design, stated):** geometry cannot tell a grid slipped by
exactly one square from the right one if the slip is gradual, or if it happens
across a loss and the tracker then claims high correspondence. That
distinction must come from the tracker's correspondence, for example feature
matching against the lock keyframe, including the board's outer frame, which
is not periodic. The simulator shows the sudden-slip and unsure-recovery
cases are refused.

```
camera frame ──► board alignment ──► per-square observation ──► temporal fusion ──► Reconstruction ──► Verification ──► Study
 (camera FPS)    (cheap, every       (expensive, INFERENCE FPS:  (EvidenceAccumulator) (reconstruct.ts:   (a person)
                  frame: detect /     Stage 1 occupancy,                              faces, inventory,
                  track the quad)     Stage 2 identity)                               flags)
```

## Four rates that are not the same

| | what | how often |
|---|---|---|
| **camera FPS** | frames delivered by the camera | 30–60 /s |
| **alignment** | board quad detected or tracked, frame quality estimated (`scanner.ts`, `frame` event) | as often as it is cheap, ideally every frame |
| **inference FPS** | a frame is cropped and recognised (`recognize` effect) | a few per second at most; never more than one frame in flight, at least `MIN_RECOGNITION_GAP_MS` apart, only frames with quality ≥ `MIN_RECOGNITION_QUALITY` |
| **evidence accumulation** | the recognised frame is added to the `EvidenceAccumulator` | once per recognised frame |
| **finalization** | the person says "finish"; the accumulated evidence is reconstructed and verified | once |

Fusion never assumes every camera frame was recognised. It sees only the
frames that were, and it treats near-duplicates as one view (see below). So
a faster camera does not make a board look more certain.

## One aligned frame → one observation per square

A `BoardObservation` is one recognised frame. It holds:

- `frameId`, which must be unique;
- `classifier`, which must be the same recogniser for the whole scan;
- `quad`, the grid corners in reading 0;
- an optional `group`;
- `squares[225]`, a `SquareObservation` or `null` per square.

A `SquareObservation` contains:

| field | meaning | from |
|---|---|---|
| `occupancy` | P(a physical tile is here) | Stage 1 |
| `identity` | P(physical kind \| tile), over `tileClasses(meta)` | Stage 2 (optional; may be absent even when occupancy is present) |
| `reading` | *instead of the two above*: today's single-stage 30-way distribution. It is read as occupancy = 1 − P(empty), identity = the tile kinds renormalised | single-stage model |
| `turns` | orientation of the print | recogniser |
| `quality` | 0–1: how far THIS view of THIS square can be trusted | the producer (alignment, tracker, image statistics), never the recogniser |
| `factors` | why: `alignment`, `sharpness`, `visibility`, `exposure`, `motion` (0–1 each; `qualityFromFactors` = their product) | producer, diagnostic |

`null` means the square was not usable in this frame: out of frame, less than
85% visible (`recognize.ts`), covered, or too degraded. A null square
contributes **nothing**, and in particular no evidence that the square is
empty. **Detecting occlusion is the producer's job.** A hand that is not
detected will be read as whatever it looks like, at whatever quality the
producer gives it.

## Fusion (`EvidenceAccumulator`), per square

1. **Groups.** Frames that share a `group` are near-duplicates (a burst, one
   pose) and count as one view, the best of them. The scanner assigns groups,
   for example by pose or time window; by default every frame is its own
   group. Thirty identical frames are one confirmation.
2. **Best views.** Only the `bestViews` (3) best groups by quality are kept,
   and only views with at least `minRelativeQuality` (0.5) × the best view's
   quality are pooled. Many poor views cannot outvote or dilute a clear one.
3. **Occupancy and identity are pooled separately.** Each uses a linear pool
   weighted by quality^`qualityPower` (2). Identity is also weighted by that
   view's own occupancy: a view that thought "probably empty" says little
   about which tile. Identity seen in an early, occupancy-uncertain view is
   kept, and counts once later views establish the tile.
4. **Confidence grows only through agreement.**
   The pooled result is sharpened by γ = 1 + `independence` · (n_eff − 1) · κ²
   (capped at `maxSharpen`):
   - n_eff is the effective number of views;
   - κ is their agreement, the chance that two of them name the same class.

   Good views that agree raise confidence. Good views that disagree stay a
   visible mixture ("6 or 8"), never collapsing to the majority or to a third
   class.
5. **Order does not matter.** Ties are broken by `frameId`, and the result is
   a symmetric function of the kept views.
6. **Combined per square:** P(empty) = 1 − P(tile), and
   P(kind) = P(tile) · P(kind | tile). Tile mass with no identity evidence
   becomes `unknown` (a tile, kind unread).

   The top-K rule then turns this into the `CellEvidence` that
   `reconstruct()` already reads, so nothing downstream changed. A
   single-view square (an uploaded photo) is exactly that view's evidence.

**Fusion is visual only.** It never uses equation validity, faces or the
tile inventory. Those belong to `reconstruct()`, which flags
`faceUnresolved` and `overspent` and changes no reading on its own.

The fusion constants (`DEFAULT_FUSION`) are provisional, chosen for safety
by the invariant tests. They should be fitted on real multi-frame captures
once a live recogniser exists.

## Completion: never just "done"

`assessCompletion(accumulator, policy, excluded)` gives each square one
status:

| status | meaning |
|---|---|
| `unobserved` | no usable view |
| `needsView` | fewer than `minViews` independent views, or best view below `minBestQuality` |
| `uncertain` | well seen, but the leading reading is below `clearAt` or is `unknown` |
| `sufficient` | well seen and clear |
| `excluded` | set aside by a person |

This lets the scanner say "198 / 225 sufficiently observed · 17 need another
view · 10 visually uncertain". Semantic and assignment ambiguity (faces,
inventory) is **not** assessed here (`semantic: null`); `reconstruct()`
reports it. The policy has no defaults: its thresholds are to be set from
the measured behaviour of the recogniser in use.

## Invariants (tested)

| | invariant |
|---|---|
| A | Strong evidence is not erased or diluted by later, much worse frames. |
| B | Agreeing independent views raise confidence; near-duplicates in one group do not; frames wrongly declared independent are capped at `bestViews`. |
| C | Good conflicting views stay ambiguous between exactly those readings. |
| D | Quantity does not beat quality (one excellent view vs 50 terrible ones). |
| E | An unseen square is `unknown` with zero observations. |
| F | Out-of-frame or clipped squares add nothing. |
| G | Temporary occlusion does not erase earlier evidence. |
| H | Any order of the same observations gives identical evidence. |
| I | No semantic correction: an equation-invalid, clearly seen board comes out as seen. |

To watch the belief move frame by frame without a camera:
`npx vite-node tools/vision/fusionTrace.ts`.

## Not implemented yet

- **Automatic board detector.** The lock is acquired from a person's corners
  (`manualLock`) or a supplied quad.
- **A real optical tracker** producing `FrameMeasurement` (quad +
  correspondence + blur). The offline simulator
  (`tools/vision/trackingSimulator.ts`, `trackingTrace.ts`) stands in.
- **An occlusion (hand) detector.** Occlusion is honoured only when a mask is
  supplied.
- **Camera UI.** `scanner.ts` still takes its `frame` quad and quality
  directly; wiring it to `BoardLock` is the next step. Its `tracking` phase
  accepts any new quad today, which the lock's jump gate is there to prevent.
- **The Stage-2 model,** and multi-frame use of Stage 1 in the app.
- **Production thresholds.** `DEFAULT_LOCK_POLICY`, `DEFAULT_FUSION` and the
  completion policy are provisional safety values, to be fitted on real
  captures.
