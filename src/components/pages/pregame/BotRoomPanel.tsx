import { Coins, Sparkles, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../../auth";
import type { BotFunding, ProBotStatus } from "../../../bot/catalog";
import { getMyProBotStatus } from "../../../features/probot/repository";
import type { NewGameSettings, Side } from "../../../game";

const BOT_NAME = "Authur";

function formatTime(value: string | null): string {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Why the allowance cannot fund this room, in the server's own terms. */
function allowanceUnavailable(status: ProBotStatus): string | null {
  switch (status.allowance.reason) {
    case "ok":
      return null;
    case "free_plan":
      return "แพ็กเกจ Free ไม่มีโควตา Pro-Bot";
    case "not_configured":
      return "แพ็กเกจนี้ยังไม่มีโควตา Pro-Bot";
    case "weekly_cap":
      return `ใช้โควตาสัปดาห์นี้ครบ ${status.weekly.cap} เกมแล้ว (รีเซ็ตวันจันทร์ 00:00)`;
    case "empty":
      return `โควตาหมดชั่วคราว — ได้คืน 1 ครั้งเวลา ${formatTime(status.allowance.next_unit_at)}`;
  }
}

/**
 * Setup for a match against Authur, the Pro bot.
 *
 * A Pro-bot room is paid for by exactly one of the player's Pro-Bot allowance
 * or one permanent Pro-Bot Credit, and the player chooses which: allowance is
 * pre-selected only when the server says it is available, and a Credit is only
 * ever spent by selecting it. Nothing here decides availability — the numbers
 * are the server's (`get_my_probot_status`), and the server checks them again
 * when the room is created. The bot always plays side B.
 */
export function BotRoomPanel({
  busy,
  onSubmit,
}: {
  busy: boolean;
  engine?: "authur";
  onSubmit: (settings: NewGameSettings) => void;
}) {
  const { profile } = useAuth();
  const accountName = profile?.display_name?.trim() ?? "";
  const [playerName, setPlayerName] = useState(accountName);
  const [nameEdited, setNameEdited] = useState(false);
  const [nameTouched, setNameTouched] = useState(false);
  const [startingSide, setStartingSide] = useState<Side>("A");
  const [status, setStatus] = useState<ProBotStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [funding, setFunding] = useState<BotFunding | null>(null);
  // Minted once per visit to this panel: every submit from it is the same
  // creation intent, so a second click, or a retry after an error whose room
  // was in fact made, gets that room back instead of a second one.
  const [creationRequestId] = useState(() => crypto.randomUUID());
  const trimmedPlayerName = playerName.trim();

  useEffect(() => {
    if (!nameEdited && accountName) setPlayerName(accountName);
  }, [accountName, nameEdited]);

  useEffect(() => {
    let alive = true;
    getMyProBotStatus()
      .then((next) => {
        if (!alive) return;
        setStatus(next);
        // Pre-select the allowance only when the server says it can pay.
        if (next?.allowance.reason === "ok") setFunding((current) => current ?? "allowance");
      })
      .catch((error: unknown) => {
        if (alive) setStatusError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      alive = false;
    };
  }, []);

  const allowanceBlocked = status ? allowanceUnavailable(status) : null;
  const creditsBlocked = status ? status.credits < 1 : false;
  const atBoardLimit = status?.boards.limit != null && status.boards.active >= status.boards.limit;
  const canSubmit = Boolean(trimmedPlayerName) && funding !== null && !busy && !atBoardLimit;

  return (
    <form
      className="pregame-card create-room-panel bot-room-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        setNameTouched(true);
        if (!trimmedPlayerName || !funding) return;
        const playerA = trimmedPlayerName;
        onSubmit({
          name: `${playerA} vs ${BOT_NAME}`,
          gameMode: "versus",
          playerA,
          playerB: BOT_NAME,
          startingSide,
          botSide: "B",
          botEngine: "authur",
          botDifficulty: "super",
          botFunding: funding,
          creationRequestId,
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
          <span className="bot-hero-eyebrow">Your opponent · Pro bot</span>
          <strong className="bot-hero-name">{BOT_NAME}</strong>
          <span className="bot-hero-sub">A new style of challenge</span>
        </span>
        <span className="bot-hero-pill">
          <Sparkles size={13} /> STRONG
        </span>
      </header>

      <section className="bot-config-section" aria-labelledby="bot-player-heading">
        <header className="bot-config-heading">
          <span>1</span>
          <div>
            <h3 id="bot-player-heading">Player</h3>
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
                : "Shown on the board"}
          </small>
        </label>
      </section>

      <fieldset className="bot-config-section bot-section" aria-describedby="bot-funding-status">
        <legend className="bot-config-heading">
          <span>2</span>
          <span>
            <strong>Pro-Bot game</strong>
          </span>
        </legend>
        <p id="bot-funding-status" className="bot-field-hint" data-testid="probot-status">
          {status
            ? `โควตา ${status.allowance.available}/${status.allowance.capacity} · สัปดาห์นี้ใช้ ${status.weekly.used}/${status.weekly.cap} · เครดิต ${status.credits} · กระดาน ${status.boards.active}/${status.boards.limit ?? "–"}`
            : statusError
              ? "โหลดสถานะโควตาไม่สำเร็จ — เซิร์ฟเวอร์จะตรวจอีกครั้งตอนสร้างเกม"
              : "กำลังโหลดสถานะโควตา…"}
        </p>
        <div className="bot-difficulty-grid" role="radiogroup" aria-label="Pro-Bot funding">
          <button
            type="button"
            role="radio"
            aria-checked={funding === "allowance"}
            disabled={Boolean(allowanceBlocked)}
            className={`bot-difficulty-option${funding === "allowance" ? " selected" : ""}`}
            onClick={() => setFunding("allowance")}
          >
            <span className="bot-difficulty-top">
              <span className="bot-difficulty-label">
                <Zap size={14} aria-hidden /> ใช้โควตา Pro-Bot
              </span>
            </span>
            <span className="bot-difficulty-desc">
              {allowanceBlocked ?? "ใช้ 1 ครั้งจากโควตาที่ฟื้นขึ้นทุก 30 นาที"}
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={funding === "credit"}
            disabled={creditsBlocked}
            className={`bot-difficulty-option${funding === "credit" ? " selected" : ""}`}
            onClick={() => setFunding("credit")}
          >
            <span className="bot-difficulty-top">
              <span className="bot-difficulty-label">
                <Coins size={14} aria-hidden /> ใช้ 1 เครดิต
              </span>
            </span>
            <span className="bot-difficulty-desc">
              {creditsBlocked
                ? "ไม่มีเครดิต Pro-Bot"
                : `มีเครดิต ${status?.credits ?? "?"} — ไม่หมดอายุ`}
            </span>
          </button>
        </div>
        {atBoardLimit && (
          <p className="bot-field-error" role="alert">
            คุณมีกระดานที่กำลังเล่นครบ {status?.boards.limit} กระดานแล้ว — จบหรือยกเลิกเกมเดิมก่อน
          </p>
        )}
      </fieldset>

      <section className="bot-config-section" aria-labelledby="bot-rules-heading">
        <header className="bot-config-heading">
          <span>3</span>
          <div>
            <h3 id="bot-rules-heading">Game setup</h3>
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
                <span className="bot-difficulty-label">{side === "A" ? "You" : BOT_NAME}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="bot-submit-row">
        <span>
          <strong>{trimmedPlayerName || "Player Name required"}</strong>
          <small>
            vs {BOT_NAME} ·{" "}
            {funding === "credit"
              ? "ใช้ 1 เครดิต"
              : funding === "allowance"
                ? "ใช้โควตา"
                : "เลือกวิธีใช้สิทธิ์"}{" "}
            · {startingSide === "A" ? "You start" : `${BOT_NAME} starts`}
          </small>
        </span>
        <button className="ui-button-primary" type="submit" disabled={!canSubmit}>
          {busy ? "Creating…" : `Start ${BOT_NAME} match`}
        </button>
      </footer>
    </form>
  );
}
