import { useState } from "react";
import type { BotDifficulty, NewGameSettings, Side } from "../../../game";

/** The AI opponent's display name, used for both sides of the match. */
const BOT_NAME = "Aether";

const DIFFICULTY_OPTIONS: Array<{ value: BotDifficulty; label: string; desc: string }> = [
  { value: "easy", label: "Easy", desc: "Thinks briefly — a relaxed game." },
  { value: "medium", label: "Medium", desc: "Balanced thinking time." },
  { value: "hard", label: "Hard", desc: "Searches deeper and plays sharply." },
  {
    value: "max",
    label: "Max",
    desc: "Full strength — explores every move and solves the endgame exactly.",
  },
];

/**
 * Setup for a match against the built-in engine (Aether). Pick a strength: it
 * maps to how long the engine may think, from a quick Easy reply up to the
 * full-strength Max that solves the endgame exactly. The bot always plays side
 * B; timers default to untimed so the engine's thinking time never costs anyone
 * the game.
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
  const [difficulty, setDifficulty] = useState<BotDifficulty>("max");

  return (
    <form
      className="pregame-card create-room-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const playerA = playerName.trim() || "Player";
        onSubmit({
          name: `${playerA} vs ${BOT_NAME}`,
          gameMode: "versus",
          playerA,
          playerB: BOT_NAME,
          startingSide,
          botSide: "B",
          botDifficulty: difficulty,
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

      <fieldset className="create-field">
        <legend>Difficulty</legend>
        <div className="bot-difficulty-grid">
          {DIFFICULTY_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={`bot-difficulty-option${difficulty === option.value ? " selected" : ""}`}
            >
              <input
                type="radio"
                name="bot-difficulty"
                checked={difficulty === option.value}
                onChange={() => setDifficulty(option.value)}
              />
              <span className="bot-difficulty-label">{option.label}</span>
              <span className="bot-difficulty-desc">{option.desc}</span>
            </label>
          ))}
        </div>
      </fieldset>

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
