import { useState } from "react";
import type { RankedMatchView } from "../features/ranked/publicView";
import type { HostedAction } from "./hostedAdmin";

export function HostedControls({
  match,
  busy,
  onAction,
}: {
  match: RankedMatchView;
  busy: boolean;
  onAction(action: HostedAction): void;
}) {
  const [logId, setLogId] = useState("");
  const [score, setScore] = useState("");
  const paused = "paused" in match && Boolean(match.paused);
  const solo = "mode" in match && match.mode === "solo_practice";
  if (match.status === "finished") return null;
  return (
    <section
      aria-label={solo ? "Practice controls" : "Tournament administration"}
      className="pregame-card"
    >
      <h2>{solo ? "Practice controls" : "Tournament administration"}</h2>
      <button
        type="button"
        disabled={busy}
        onClick={() => onAction({ kind: paused ? "resume" : "pause" })}
      >
        {paused ? "Resume game" : "Pause game"}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (window.confirm("Finish this game and publish its completed Replay?"))
            onAction({ kind: "finish" });
        }}
      >
        Finish game
      </button>
      {paused && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onAction({ kind: "correct-score", logId, score: Number(score) });
          }}
        >
          <label>
            Public turn to correct
            <select value={logId} onChange={(event) => setLogId(event.target.value)}>
              <option value="">Choose a turn</option>
              {match.logs
                .filter((log) => log.action !== "end_game")
                .map((log) => (
                  <option key={log.id} value={log.id}>
                    Turn {log.turnNumber} · {log.side} · {log.score} points
                  </option>
                ))}
            </select>
          </label>
          <label>
            Corrected score
            <input
              type="number"
              required
              min={-10000}
              max={10000}
              step={1}
              value={score}
              onChange={(event) => setScore(event.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !logId || score === ""}>
            Correct score
          </button>
        </form>
      )}
    </section>
  );
}
