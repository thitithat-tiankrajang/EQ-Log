# Phase B — baseline performance (measured, not optimized)

Date 2026-10-03 · data: `docs/evidence/phase-b/baseline-local.json`, `baseline-lan.json` · spec `tests/local-realplay/tentative.spec.ts` ("baseline").

## Environment

- One MacBook (Apple silicon), host load average ≈ 5–6 during the runs (other apps, a VM).
- Disposable local Supabase stack in Docker (Kong, GoTrue, PostgREST, Realtime); Edge functions via `supabase functions serve` (local edge runtime).
- Two Chromium contexts (Playwright), 390×844 touch phones, genuine local password accounts, a real Online Match.
- **local**: app at `http://127.0.0.1:5192` → stack on loopback.
- **lan**: app at the phone/LAN origin `http://192.168.1.36:5196` (Vite LAN proxy → stack). Both browsers are still on the same Mac; this exercises the LAN origin and proxy hop, not a physical phone radio.
- These are **local** numbers; they are not production latency.

## Method

120 sequential samples per path: the mover moves one tentative tile between two squares (select + tap); the next sample starts once the opponent shows it. Times: the in-page click (capture listener), request start/end and the relay's `Server-Timing` (auth, read, broadcast, total), the opponent's WebSocket frame receipt, and the opponent's DOM change (MutationObserver). One clock (same machine). Plus a 20-move rapid burst.

## Results (ms)

| Segment                                        | local p50 | p95     | p99     | max     | lan p50 | p95     | p99     | max     |
| ---------------------------------------------- | --------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| local render of own tile (optimistic)          | 5         | 18      | 19      | 32      | 8       | 19      | 22      | 23      |
| action → relay request start                   | 8         | 22      | 23      | 37      | 11      | 23      | 26      | 28      |
| relay request round trip                       | 38        | 70      | 113     | 148     | 44      | 103     | 169     | 225     |
| relay total (server)                           | 33.7      | 62.4    | 100.7   | 125.4   | 37.2    | 67.4    | 106.3   | 158.8   |
| · auth (`auth.getUser` → GoTrue)               | 27.5      | 50.1    | 86.0    | 91.6    | 30.3    | 56.9    | 95.3    | 145.4   |
| · read `room_live` (+ decode/validate)         | 2.3       | 4.5     | 14.8    | 21.0    | 2.6     | 6.2     | 13.8    | 18.0    |
| · broadcast API call                           | 3.5       | 6.1     | 13.9    | 28.9    | 3.9     | 7.9     | 13.4    | 13.6    |
| relay broadcast start → opponent frame receipt | 3.8       | 6.3     | 11.8    | 35.2    | 4.5     | 9.3     | 39.6    | 95.4    |
| opponent frame → rendered overlay              | 16        | 18      | 21      | 23      | 17      | 18      | 22      | 22      |
| **end to end: action → opponent sees it**      | **69**    | **100** | **139** | **200** | **75**  | **128** | **207** | **260** |

Payload: proposal 149 bytes (one tile); relayed WebSocket frame 305 bytes including the Realtime envelope. Per user action: **1** relay request, **1** Realtime message to **1** recipient, **0** durable writes (verified: no `realtime.messages` rows for tentative topics). Rapid burst: 20 moves in 2.19 s (≈ 9 moves/s, Playwright-driven) → 20 requests, 20 frames, converged; under 0–400 ms injected jitter, 12 rapid moves produced 8 relayed states (coalescing) and converged without rollback.

## Bottleneck analysis

- The local draft is immediate (own tile rendered before the request even starts).
- **Authentication dominates the relay**: `auth.getUser` is a network round trip to GoTrue per event — ≈ 80% of relay time at p50 (27.5 of 33.7 ms) and most of the p95.
- Reading/validating the authoritative row and the broadcast call are small (≈ 2–4 ms p50 each).
- Realtime fan-out is fast (≈ 4 ms p50) with occasional tail spikes.
- The opponent's render is ≈ one React commit/frame (≈ 16 ms).
- Coalescing matters only when a request is slower than the gap between taps; at tap speed with ~40 ms round trips each tap is its own request.

## Sufficiency at scale (reasoning, not a load test)

Per active Online game only the mover publishes, only during its own turn, ≤ 1 request per round trip (rate limited 10/s, burst 20), each delivered to exactly one opponent topic. Spectators receive nothing, so traffic does not amplify with audience size. Each event costs one JWT check, one single-row primary-key read and one broadcast call — no writes. A typical turn involves a handful of placements, so the expected shape is a few requests and messages per turn per game.

## Recommended next step (evidence-driven)

Remove the per-event GoTrue round trip: verify the JWT in the Edge function (the gateway already enforces `verify_jwt`; verify signature/claims locally, or cache the verified identity per token for its lifetime). Expected effect at this baseline: ≈ −27 ms p50, ≈ −50 ms p95 end to end. Re-measure with this same spec before any other change.
