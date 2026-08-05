import { useState } from "react";
import type { NewGameSettings, Side } from "../../../game";

/**
 * Setup for a match against the built-in engine. There is a single AI model —
 * the strongest the engine can play — so there is no strength selector. The bot
 * always plays side B; timers default to untimed so the engine's thinking time
 * never costs anyone the game.
 */
export function BotRoomPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (settings: NewGameSettings) => void;
}) {
  const [playerName, setPlayerName] = useState("");
  const [startingSide, setStartingSide] = useState<Side>("A");
  const [manualTiles, setManualTiles] = useState(false);

  return (
    <form
      className="pregame-card create-room-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const playerA = playerName.trim() || "Player";
        onSubmit({
          name: `${playerA} vs BOT`,
          gameMode: "versus",
          playerA,
          playerB: "BOT",
          startingSide,
          botSide: "B",
          botDifficulty: "max",
          // manual = the player hand-picks every drawn tile for both sides
          // (same refill flow as recorded matches); play = auto draw.
          tileDrawMode: manualTiles ? "manual" : "play",
          untimed: true,
        });
      }}
    >
      <label className="create-field">
        <span>Your name</span>
        <input
          type="text"
          value={playerName}
          placeholder="Player"
          maxLength={24}
          onChange={(event) => setPlayerName(event.target.value)}
        />
      </label>

      <p className="bot-model-note">
        You'll face the full-strength engine: it explores every legal move,
        weighs the tiles it would keep and the space it opens, simulates your
        likely replies, and solves the endgame exactly.
      </p>

      <fieldset className="create-field">
        <legend>Who starts</legend>
        <div className="bot-start-row">
          <label className={`bot-difficulty-option${startingSide === "A" ? " selected" : ""}`}>
            <input
              type="radio"
              name="bot-start"
              checked={startingSide === "A"}
              onChange={() => setStartingSide("A")}
            />
            <span className="bot-difficulty-label">You</span>
          </label>
          <label className={`bot-difficulty-option${startingSide === "B" ? " selected" : ""}`}>
            <input
              type="radio"
              name="bot-start"
              checked={startingSide === "B"}
              onChange={() => setStartingSide("B")}
            />
            <span className="bot-difficulty-label">Bot</span>
          </label>
        </div>
      </fieldset>

      <fieldset className="create-field">
        <legend>Tile drawing</legend>
        <div className="bot-start-row">
          <label className={`bot-difficulty-option${!manualTiles ? " selected" : ""}`}>
            <input
              type="radio"
              name="bot-tiles"
              checked={!manualTiles}
              onChange={() => setManualTiles(false)}
            />
            <span className="bot-difficulty-label">Auto draw</span>
            <span className="bot-difficulty-desc">The app draws random tiles for both sides.</span>
          </label>
          <label className={`bot-difficulty-option${manualTiles ? " selected" : ""}`}>
            <input
              type="radio"
              name="bot-tiles"
              checked={manualTiles}
              onChange={() => setManualTiles(true)}
            />
            <span className="bot-difficulty-label">I pick the tiles</span>
            <span className="bot-difficulty-desc">
              You choose every drawn tile from the bag — for your rack and the bot's.
            </span>
          </label>
        </div>
      </fieldset>

      <button className="ui-button-primary" type="submit" disabled={busy}>
        {busy ? "Creating..." : "Start bot match"}
      </button>
    </form>
  );
}
