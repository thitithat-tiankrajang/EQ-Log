import { useEffect, useMemo, useRef, useState } from "react";
import type { PendingPlacement } from "../../game";
import {
  createSequence,
  receiveTentative,
  visibleTentative,
  type RemoteTentativeState,
  type TentativeProposalTile,
} from "../tentative";
import type { OpponentTentative } from "./LiveBoard";
import type { MatchClient, ShellModel } from "./model";

const RETRY_AFTER_LIMIT_MS = 300;

/**
 * Phase B on the client: publish this seat's public tentative set while it is
 * this seat's turn, and show the opponent's. Both only where the server says
 * so (`tentativeSync` in the projection).
 *
 * Publishing never blocks the local draft: placements render at once, the
 * proposal follows asynchronously. At most one request is in flight; changes
 * made meanwhile collapse into the latest set, which is sent next (latest
 * state wins, so a burst of taps costs one request per round trip).
 *
 * Receiving keeps the newest message for the current epoch only. A different
 * revision on the board hides it at once, so a commit replaces the overlay in
 * the same render that draws the committed tiles.
 */
export function useTentativeSync({
  client,
  model,
  placements,
  active,
}: {
  client: MatchClient;
  model: ShellModel | null;
  placements: PendingPlacement[];
  /** This seat may act now (its turn, not reviewing, not paused). */
  active: boolean;
}): OpponentTentative[] {
  const relay = client.tentative;
  const enabled = Boolean(relay && model?.live?.tentativeSync && model.yourSide);
  const id = model?.id ?? "";
  const revision = model?.revision ?? -1;
  const myUserId = model?.live
    ? model.yourSide === "A"
      ? model.live.playerAId
      : (model.live.playerBId ?? "")
    : "";

  // ── Receive ──
  const [held, setHeld] = useState<RemoteTentativeState>(null);
  const revisionRef = useRef(revision);
  revisionRef.current = revision;
  useEffect(() => {
    if (!enabled || !relay || !id || !myUserId) return;
    return relay.subscribe(id, myUserId, (message) =>
      setHeld((current) => receiveTentative(current, message, revisionRef.current)),
    );
  }, [enabled, relay, id, myUserId]);
  const remote = useMemo(
    () =>
      visibleTentative(held, revision, model?.yourSide ?? null).map((tile) => ({
        row: tile.row,
        col: tile.col,
        tile: { token: tile.kind, ...(tile.face ? { assignedToken: tile.face } : {}) },
      })),
    [held, revision, model?.yourSide],
  );

  // ── Publish ──
  const tiles: TentativeProposalTile[] = useMemo(
    () =>
      placements.map((item) => ({
        tileId: item.tile.id,
        row: item.row,
        col: item.col,
        ...(item.assignedToken ? { face: item.assignedToken } : {}),
      })),
    [placements],
  );
  const key = JSON.stringify(tiles);
  const sender = useRef<{
    sequence: () => number;
    inFlight: boolean;
    pending: { revision: number; tiles: TentativeProposalTile[] } | null;
    last: { revision: number; key: string } | null;
    mounted: boolean;
    timer?: ReturnType<typeof setTimeout>;
  }>({ sequence: createSequence(), inFlight: false, pending: null, last: null, mounted: false });
  useEffect(() => () => clearTimeout(sender.current.timer), []);
  useEffect(() => {
    const state = sender.current;
    if (!enabled || !relay || !active || !id) return;
    if (state.last?.revision === revision && state.last.key === key) return;
    // A new epoch starts empty on the opponent's side too: no CLEAR needed,
    // except right after this page loaded (a reload must clear a stale overlay).
    if (state.mounted && state.last?.revision !== revision && tiles.length === 0) {
      state.last = { revision, key };
      return;
    }
    state.mounted = true;
    state.last = { revision, key };
    state.pending = { revision, tiles };
    const pump = () => {
      if (state.inFlight || !state.pending) return;
      const next = state.pending;
      state.pending = null;
      state.inFlight = true;
      relay
        .publish({ id, revision: next.revision, seq: state.sequence(), tiles: next.tiles })
        .catch((error: unknown) => {
          // Rate limited: resend the latest set shortly. Anything else (a newer
          // revision, a finished game): the authoritative projection wins.
          if (String(error).includes("Too many") && !state.pending) {
            state.pending = next;
            clearTimeout(state.timer);
            state.timer = setTimeout(pump, RETRY_AFTER_LIMIT_MS);
          }
        })
        .finally(() => {
          state.inFlight = false;
          pump();
        });
    };
    pump();
  }, [enabled, relay, active, id, revision, key, tiles]);

  return enabled ? remote : NONE;
}

const NONE: OpponentTentative[] = [];
