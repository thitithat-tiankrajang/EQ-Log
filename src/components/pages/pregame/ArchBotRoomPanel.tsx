import { Cpu } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../../auth";
import { ARCHBOT_DIFFICULTY, ARCHBOT_ENGINE, ARCHBOT_NAME } from "../../../bot/archbot/identity";
import type { NewGameSettings, Side } from "../../../game";

/**
 * Setup for a match against ArchBot, the free bot that thinks on the player's
 * own device.
 *
 * Free means free: there is no allowance or Credit step, and the room is created
 * with no funding at all — the server refuses funding for a free bot. ArchBot
 * always plays side B, at its one full strength.
 */
export function ArchBotRoomPanel({
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
  // One creation intent per visit: a double click or a retry returns the room
  // the first attempt made instead of a second one.
  const [creationRequestId] = useState(() => crypto.randomUUID());
  const trimmedPlayerName = playerName.trim();

  useEffect(() => {
    if (!nameEdited && accountName) setPlayerName(accountName);
  }, [accountName, nameEdited]);

  const canSubmit = Boolean(trimmedPlayerName) && !busy;

  return (
    <form
      className="pregame-card create-room-panel bot-room-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setNameTouched(true);
        if (!trimmedPlayerName) return;
        onSubmit({
          name: `${trimmedPlayerName} vs ${ARCHBOT_NAME}`,
          gameMode: "versus",
          playerA: trimmedPlayerName,
          playerB: ARCHBOT_NAME,
          startingSide,
          botSide: "B",
          botEngine: ARCHBOT_ENGINE,
          botDifficulty: ARCHBOT_DIFFICULTY,
          creationRequestId,
          // The bot cannot draw for itself by hand; its racks are auto-drawn.
          tileDrawMode: "play",
          untimed: true,
        });
      }}
    >
      <header className="bot-hero">
        <span className="bot-hero-avatar" aria-hidden="true">
          <Cpu size={26} />
        </span>
        <span className="bot-hero-copy">
          <span className="bot-hero-eyebrow">Your opponent · Free bot</span>
          <strong className="bot-hero-name">{ARCHBOT_NAME}</strong>
          <span className="bot-hero-sub">Thinks on your device</span>
        </span>
      </header>

      <section className="bot-config-section" aria-labelledby="archbot-player-heading">
        <header className="bot-config-heading">
          <span>1</span>
          <div>
            <h3 id="archbot-player-heading">Player</h3>
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
            aria-describedby="archbot-player-name-message"
            onBlur={() => setNameTouched(true)}
            onChange={(event) => {
              setNameEdited(true);
              setPlayerName(event.target.value);
            }}
          />
          <small
            id="archbot-player-name-message"
            className={nameTouched && !trimmedPlayerName ? "bot-field-error" : "bot-field-hint"}
          >
            {nameTouched && !trimmedPlayerName
              ? "Player Name is required."
              : accountName
                ? "Filled from your account. You can edit it for this game."
                : "Shown on the board"}
          </small>
        </label>
      </section>

      <section className="bot-config-section" aria-labelledby="archbot-rules-heading">
        <header className="bot-config-heading">
          <span>2</span>
          <div>
            <h3 id="archbot-rules-heading">Game setup</h3>
          </div>
        </header>
        <p className="bot-field-hint" data-testid="archbot-free-note">
          เล่นฟรี ไม่ใช้โควตา Pro-Bot หรือเครดิต · {ARCHBOT_NAME} คิดบนเครื่องของคุณ
          ตาที่ซับซ้อนอาจใช้เวลาคิดนานขึ้น
        </p>
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
                <span className="bot-difficulty-label">{side === "A" ? "You" : ARCHBOT_NAME}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="bot-submit-row">
        <span>
          <strong>{trimmedPlayerName || "Player Name required"}</strong>
          <small>
            vs {ARCHBOT_NAME} · Free ·{" "}
            {startingSide === "A" ? "You start" : `${ARCHBOT_NAME} starts`}
          </small>
        </span>
        <button className="ui-button-primary" type="submit" disabled={!canSubmit}>
          {busy ? "Creating…" : `Start ${ARCHBOT_NAME} match`}
        </button>
      </footer>
    </form>
  );
}
