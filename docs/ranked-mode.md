# Ranked mode

## Match contract

- An approved account creates a public ranked room and takes seat A. Any other approved account can take seat B. After joining, both players press Ready; the clock starts only after both are ready. The first mover is drawn randomly by the server.
- The creator chooses only the clock, from 10, 15, 20 or 30 minutes. Both players get the same time. All other rules are fixed: an automatic shuffled 100 tile bag, eight tiles per rack, the normal A Math scoring rules, and hidden racks.
- The server owns the full position, draw queue, clocks and result. A player sends only a move intent: placed tile IDs and squares, tile IDs to exchange, pass, or resign. The server checks seat, turn, rack ownership, assignments, equation validity, exchange reserve, score and time before saving. A revision check rejects simultaneous or stale moves.
- Ranked room setup uses the ordinary Create game flow and its timer selector, with the other configuration controls fixed. Once play starts, ranked uses the same Board, Rack, Scoreboard and ActionPanel components as ordinary games. Its transport remains server-owned because ordinary room state contains both players' racks.
- Ranked play has no undo, branches, manual scoring, host controls, analysis, shared rack view or early mutual stop. A player can resign at any time. If a clock reaches zero, the other player wins. Natural rack out and the existing no score streak rule use the ordinary final game score; equal scores are a draw.
- Leaving the page does not pause a running clock. A waiting or matched room has no running clock and may be cancelled without rating loss before play starts. An open seat is offered for 24 hours. The next read or action settles an expired clock against server time.

## Rating and leaderboard

Every approved account starts at **1000 rating**. A win is worth 1, draw 0.5 and loss 0 in the Elo calculation:

`expected = 1 / (1 + 10 ^ ((opponent_rating - own_rating) / 400))`

`delta = round(K × (outcome - expected))`

`K = 40` for the first 10 completed ranked games, then `K = 24`. The minimum rating is 100. The margin of victory and number of points scored do not change rating. Resignation and timeout count as losses. Only a finished ranked match changes rating. Room creation, waiting, cancellation and ordinary modes do not. Both ratings and the result are written in one database transaction, once per match ID.

| Tier | Rating |
| --- | ---: |
| Bronze | below 1000 |
| Silver | 1000–1199 |
| Gold | 1200–1399 |
| Platinum | 1400–1599 |
| Diamond | 1600–1799 |
| Master | 1800+ |

The leaderboard shows the top 100 players with at least 10 completed ranked games, ordered by rating then wins. The player's own rating remains visible before qualification. Tiers change immediately with rating; there are no promotion matches or seasonal resets in this version.

## Information contract

`ranked_matches.state` holds the complete game and is never granted to a browser role or published to Realtime. The ranked Edge Function returns an explicit projection containing the board, scores, clocks, bag **count**, both rack **counts**, the caller's own rack, and a turn log. Neither rack is revealed until both players are ready. Each log entry exposes the action, score or number of exchanged tiles, and the board after that turn. A caller sees historical rack tiles only for their own turns. The other side's rack, draws, exchanges, full bag order, raw snapshots, and canonical tile map never enter the browser response.

The log's “view shot” control renders the board snapshot from that entry. The opponent's rack is always shown as closed tiles, including in finished matches. The client has no path to `room_live` or its older, full state transport for ranked games.

Normal game information can still support deduction when the bag is empty: every physical tile must be somewhere. Hiding a network field cannot prevent logical deduction from all publicly played tiles. The guarantee is that no unplayed tile identity is disclosed by a client payload or UI inspection.

## Deployment

1. Apply `supabase/migrations/20260925120000_ranked_matches.sql` to the target database.
2. Run `npm run build:ranked` whenever the shared rules or function change; the generated `supabase/functions/ranked/index.js` is the configured Edge Function entrypoint.
3. Deploy the `ranked` Supabase function. It requires the normal Supabase URL, anon key and service role key in the function environment.
4. Verify create → join → move → replay → finish → rating on two approved test accounts before enabling the UI in production.

## Deployment status (25 September 2026)

- The ranked migration `20260925120000` is applied to the linked Supabase project. The `ranked` Edge Function is deployed and ACTIVE with JWT verification enabled. An unauthenticated request returns HTTP 401.
- The earlier, unrelated Survival migration `20260924180000` remains local and unapplied. A normal `supabase db push` now reports a migration ordering gap; apply that migration with `--include-all` only when Survival is approved for release. Do not mark it as applied without running it.
- The web client changes are in this workspace. A production web deployment and a two-account live gameplay check are still required before players can use the mode through the production site.
