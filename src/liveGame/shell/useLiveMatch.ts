import { useCallback, useEffect, useRef, useState } from "react";
import type { RankedMatchView } from "../../features/ranked/publicView";
import type { MatchClient } from "./model";
import { heldTerminals } from "./terminalHold";

/**
 * The authoritative lane, unchanged: read the recipient projection, refresh on
 * the commit broadcast, poll as a fallback, and keep the newest revision. Once
 * the game is finished nothing is read again — the Result stays as it was.
 */
export function useLiveMatch(matchId: string, client: MatchClient, loadError: string) {
  const [match, setMatch] = useState<RankedMatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const finished = useRef(false);

  const accept = useCallback(
    (next: RankedMatchView) =>
      setMatch((current) => (current && current.revision > next.revision ? current : next)),
    [],
  );

  useEffect(() => {
    let alive = true;
    finished.current = false;
    const refresh = async () => {
      if (finished.current) return;
      try {
        const { match: next } = await client.read(matchId);
        if (!alive) return;
        accept(next);
        setError(null);
      } catch (cause) {
        if (alive && !finished.current)
          setError(cause instanceof Error ? cause.message : loadError);
      }
    };
    void refresh();
    const unsubscribe = client.subscribe?.(matchId, () => void refresh());
    const poll = window.setInterval(() => void refresh(), 4000);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      window.clearInterval(poll);
      window.clearInterval(tick);
      unsubscribe?.();
    };
  }, [matchId, client, accept, loadError]);

  const isFinished = match?.status === "finished";
  useEffect(() => {
    if (!isFinished) return;
    finished.current = true;
    heldTerminals.add(matchId);
    return () => {
      heldTerminals.delete(matchId);
    };
  }, [isFinished, matchId]);

  return { match, setMatch, accept, error, setError, now };
}
