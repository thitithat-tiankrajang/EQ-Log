// The way out of a bot turn the engine cannot finish.
//
// It exists because a different way out was closed. The room owner used to be
// able to play the bot's move themselves, so an engine that could not answer was
// an annoyance rather than a dead end. Now that the bot's turn is the bot's, a
// wedged search would strand the room with no legal action available to anybody
// — the retry loop deliberately never converts a failure into a pass, and it is
// right not to.
//
// So the offer is explicit, and it is not made early: three consecutive
// failures, desyncs excluded, because a desync fixes itself the moment sync
// catches up and putting an emergency button in front of that would be noise.
//
// Taking over STOPS the retry loop for this turn. That is the whole reason it is
// a button and not just an unlocking of the controls: a search that succeeded
// while the player was mid-exchange would be a second move for one turn.
export function BotStuckNotice({
  botName,
  variant,
  onTakeOver,
  onRetry,
}: {
  botName: string;
  variant: "panel" | "mobile";
  onTakeOver: () => void;
  onRetry: () => void;
}) {
  if (variant === "mobile") {
    return (
      <div className="mobile-action-bar">
        <div className="mab-status invalid">
          <strong>{botName} ติดขัด</strong>
          <span>คิดไม่สำเร็จ 3 ครั้งติด</span>
        </div>
        <button className="mab-btn primary" type="button" onClick={onTakeOver}>
          เล่นแทน
        </button>
        <button className="mab-btn" type="button" onClick={onRetry}>
          ลองใหม่
        </button>
      </div>
    );
  }

  return (
    <div className="bot-stuck" role="status" aria-live="polite">
      <p className="bot-stuck-line">
        {botName} คิดไม่สำเร็จ 3 ครั้งติด — คุณเล่นตานี้แทนได้
      </p>
      <div className="action-buttons two">
        <button className="bot-stuck-take" type="button" onClick={onTakeOver}>
          เล่นแทน {botName} ตานี้
        </button>
        <button type="button" onClick={onRetry}>
          ให้ {botName} ลองอีกครั้ง
        </button>
      </div>
    </div>
  );
}
