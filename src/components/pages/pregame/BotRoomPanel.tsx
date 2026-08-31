import { Check, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../auth";
import type { BotDifficulty, NewGameSettings, Side } from "../../../game";

/** The AI opponent's display name, used for both sides of the match. */
const BOT_NAME = "Aether";

const DIFFICULTY_OPTIONS: Array<{
  value: BotDifficulty;
  label: string;
  desc: string;
  /** Filled bars in the strength meter (1–4). */
  level: number;
}> = [
  { value: "medium", label: "Fast", desc: "Quick thinking, still solid play.", level: 1 },
  { value: "hard", label: "Balanced", desc: "Searches deeper and plays sharply.", level: 2 },
  {
    value: "max",
    label: "Deep",
    desc: "Full strength — explores every move and solves the endgame exactly.",
    level: 3,
  },
  {
    value: "super",
    label: "Unlimited",
    desc: "No time limit — thinks until the search is 100% finished. Minutes a move.",
    level: 4,
  },
];

/** Four-bar strength meter; the first `level` bars light up. */
function StrengthMeter({ level }: { level: number }) {
  return (
    <span className="bot-strength" aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <i key={bar} className={bar <= level ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * Setup for a match against the built-in engine (Aether). Pick a strength: it
 * maps to how long the engine may think, from a fast reply up to Unlimited,
 * which has no clock on it at all and returns when the search has finished
 * rather than when time ran out. The bot always plays side B; timers default to
 * untimed so the engine's thinking time never costs anyone the game.
 */
export function BotRoomPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (settings: NewGameSettings) => void;
}) {
  const { profile } = useAuth();
  const accountName = profile?.display_name?.trim() ?? "";
  const [playerName, setPlayerName] = useState(accountName);
  const [nameEdited, setNameEdited] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [startingSide, setStartingSide] = useState<Side>("A");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("max");
  const trimmedPlayerName = playerName.trim();
  const selectedDifficulty = useMemo(
    () => DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)!,
    [difficulty],
  );

  useEffect(() => {
    if (!nameEdited && accountName) setPlayerName(accountName);
  }, [accountName, nameEdited]);

  return (
    <form
      className="pregame-card create-room-panel bot-room-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setNameTouched(true);
        if (!trimmedPlayerName) return;
        const playerA = trimmedPlayerName;
        onSubmit({
          name: `${playerA} vs ${BOT_NAME}`,
          gameMode: "versus",
          playerA,
          playerB: BOT_NAME,
          startingSide,
          botSide: "B",
          botDifficulty: difficulty,
          // Always auto-draw, and no longer a choice.
          //
          // Hand-picking the draws meant the HUMAN drew tiles for the bot's
          // rack, which was fine while they could also play the bot's move and
          // is a dead end now that they cannot: the turn would sit in `refill`
          // waiting for a player who is not allowed to act. Rooms created before
          // this still work — the refill carve-out on the bot's turn exists for
          // exactly them — but no new one can be made.
          tileDrawMode: "play",
          untimed: true,
        });
      }}
    >
      <header className="bot-hero">
        <span className="bot-hero-avatar" aria-hidden="true">
          <svg
            width="26"
            height="26"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="4" y="8" width="16" height="11" rx="3" />
            <path d="M12 8V4" />
            <circle cx="12" cy="3" r="1.4" fill="currentColor" stroke="none" />
            <path d="M9 13h.01M15 13h.01" />
            <path d="M2 12v3M22 12v3" />
          </svg>
        </span>
        <span className="bot-hero-copy">
          <span className="bot-hero-eyebrow">Your opponent</span>
          <strong className="bot-hero-name">{BOT_NAME}</strong>
          <span className="bot-hero-sub">
            The built-in A-Math engine — it solves the endgame exactly.
          </span>
        </span>
        <span className="bot-hero-pill">
          <Sparkles size={13} /> {selectedDifficulty.label}
        </span>
      </header>

      <section className="bot-config-section" aria-labelledby="bot-player-heading">
        <header className="bot-config-heading">
          <span>1</span>
          <div>
            <h3 id="bot-player-heading">Player</h3>
            <p>This name appears on the board and in game history.</p>
          </div>
        </header>
        <label className="create-field bot-field">
          <span>Player Name</span>
          <input
            type="text"
            value={playerName}
            placeholder="Enter player name"
            maxLength={24}
            required
            aria-invalid={nameTouched && !trimmedPlayerName}
            aria-describedby="bot-player-name-message"
            onBlur={() => setNameTouched(true)}
            onChange={(event) => {
              setNameEdited(true);
              setPlayerName(event.target.value);
            }}
          />
          <small
            id="bot-player-name-message"
            className={nameTouched && !trimmedPlayerName ? "bot-field-error" : "bot-field-hint"}
          >
            {nameTouched && !trimmedPlayerName
              ? "Player Name is required."
              : accountName
                ? "Filled from your account. You can edit it for this game."
                : "Enter the name you want to use for this game."}
          </small>
        </label>
      </section>

      <fieldset className="bot-config-section bot-section">
        <legend className="bot-config-heading">
          <span>2</span>
          <span>
            <strong>Difficulty</strong>
            <small>Choose how deeply Aether searches for its move.</small>
          </span>
        </legend>
        <div className="bot-difficulty-grid" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTY_OPTIONS.map((option) => (
            <button
              type="button"
              role="radio"
              aria-checked={difficulty === option.value}
              key={option.value}
              className={`bot-difficulty-option${difficulty === option.value ? " selected" : ""}`}
              onClick={() => setDifficulty(option.value)}
            >
              <span className="bot-difficulty-top">
                <span className="bot-difficulty-label">{option.label}</span>
                <StrengthMeter level={option.level} />
              </span>
              <span className="bot-difficulty-desc">{option.desc}</span>
              <span className="bot-option-check" aria-hidden="true">
                {difficulty === option.value && <Check size={14} />}
              </span>
            </button>
          ))}
        </div>
      </fieldset>

      <section className="bot-config-section" aria-labelledby="bot-rules-heading">
        <header className="bot-config-heading">
          <span>3</span>
          <div>
            <h3 id="bot-rules-heading">Game setup</h3>
            <p>Choose who opens. Aether rooms always draw tiles automatically.</p>
          </div>
        </header>
        <div className="bot-rule-group">
          <strong>Who starts</strong>
          <div className="bot-start-row" role="radiogroup" aria-label="Who starts">
            {(["A", "B"] as Side[]).map((side) => (
              <button
                key={side}
                type="button"
                role="radio"
                aria-checked={startingSide === side}
                className={`bot-difficulty-option${startingSide === side ? " selected" : ""}`}
                onClick={() => setStartingSide(side)}
              >
                <span className="bot-difficulty-label">{side === "A" ? "You" : "Aether"}</span>
                <span className="bot-difficulty-desc">
                  {side === "A" ? "Take the first turn." : "Let Aether make the opening move."}
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="bot-submit-row">
        <span>
          <strong>{trimmedPlayerName || "Player Name required"}</strong>
          <small>
            vs Aether · {selectedDifficulty.label} ·{" "}
            {startingSide === "A" ? "You start" : "Aether starts"}
          </small>
        </span>
        <button className="ui-button-primary" type="submit" disabled={busy || !trimmedPlayerName}>
          {busy ? "Creating…" : "Start Aether match"}
        </button>
      </footer>
    </form>
  );
}
