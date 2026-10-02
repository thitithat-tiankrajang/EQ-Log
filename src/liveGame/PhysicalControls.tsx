import { useState } from "react";
import { AMATH_TOKENS, type Side } from "../game";
import type { LiveGameView } from "./projection";
import type { PhysicalAction } from "./physical";
import { ToolSection } from "./ContextTools";

export function PhysicalControls({
  match,
  busy,
  onAction,
}: {
  match: LiveGameView;
  busy: boolean;
  onAction(action: PhysicalAction): void;
}) {
  const [side, setSide] = useState<Side>("A");
  const [tokens, setTokens] = useState("");
  if (
    !match.hostRacks &&
    !(match.localHandoff && match.localConfirmed && match.tileDrawMode === "manual")
  )
    return null;
  const targetSide = match.hostRacks ? side : match.activeSide;
  return (
    <ToolSection title="Physical game controls">
      {match.hostRacks &&
        (["A", "B"] as const).map((seat) => (
          <p key={seat} className="live-tool-rack" aria-label={`Current rack ${seat}`}>
            {match.players[seat]}:{" "}
            {match.hostRacks![seat].map((tile) => tile.token).join(" · ") || "Empty"}
          </p>
        ))}
      {(match.paused || match.phase === "refill") && (
        <div className="live-tool-actions">
          {(match.hostRacks ? match.hostRacks[targetSide] : match.yourRack).map((tile) => (
            <button
              key={tile.id}
              type="button"
              className="eq-button eq-button-secondary live-tile-pick"
              disabled={busy}
              onClick={() => onAction({ kind: "return-tile", side: targetSide, tileId: tile.id })}
              onKeyDown={(event) => {
                if (!busy && ["Delete", "Backspace"].includes(event.key)) {
                  event.preventDefault();
                  onAction({ kind: "return-tile", side: targetSide, tileId: tile.id });
                }
              }}
            >
              Return {tile.token}
            </button>
          ))}
        </div>
      )}
      <p className="live-tool-note">
        Record the tiles physically drawn. Bag order and future draws stay private.
      </p>
      <div className="live-tile-palette" aria-label="Physical tile palette">
        {Object.keys(AMATH_TOKENS).map((token) => (
          <button
            key={token}
            type="button"
            className="eq-button eq-button-secondary live-tile-pick"
            aria-label={`Pick ${token}`}
            disabled={busy || tokens.trim().split(/\s+/).filter(Boolean).length >= 8}
            onClick={() => setTokens((current) => `${current} ${token}`.trim())}
          >
            {token}
          </button>
        ))}
      </div>
      <form
        className="live-tool-form"
        onSubmit={(event) => {
          event.preventDefault();
          onAction({
            kind: match.paused ? "correct-rack" : "refill",
            side: targetSide,
            tokens: tokens.trim().split(/\s+/).filter(Boolean),
          });
          setTokens("");
        }}
      >
        {match.hostRacks && (
          <div className="eq-field">
            <label htmlFor="physical-player">Physical player</label>
            <select
              id="physical-player"
              value={side}
              onChange={(event) => setSide(event.target.value as Side)}
            >
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </div>
        )}
        <label className="eq-field">
          Physical tiles
          <input
            value={tokens}
            onChange={(event) => setTokens(event.target.value)}
            placeholder="1 2 + ="
          />
        </label>
        <div className="live-tool-actions">
          <button type="submit" className="eq-button eq-button-primary" disabled={busy}>
            {match.paused ? "Correct recorded rack" : "Record physical draw"}
          </button>
        </div>
      </form>
    </ToolSection>
  );
}
