import { useState } from "react";
import type { RankedMatchView } from "../features/ranked/publicView";
import type { HostedAction } from "./hostedAdmin";
import { ToolSection } from "./ToolSection";

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
  // Pause / Resume / Finish are match controls (MatchControls). A referee's
  // score correction is a record edit, and the server accepts it only while paused.
  if (!paused) return null;
  return (
    <ToolSection title={solo ? "Practice score correction" : "Score correction"}>
      <form
        className="live-tool-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAction({ kind: "correct-score", logId, score: Number(score) });
        }}
      >
        <label className="eq-field">
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
        <label className="eq-field">
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
        <div className="live-tool-actions">
          <button
            type="submit"
            className="eq-button eq-button-primary"
            disabled={busy || !logId || score === ""}
          >
            Correct score
          </button>
        </div>
      </form>
    </ToolSection>
  );
}
