/** The browser, installed app, and lobby all use the same brand asset. */
export function LobbyLogo() {
  return (
    <span className="lobby-logo" aria-label="EQ Lab">
      <span className="lobby-logo-mark" aria-hidden>
        <img src="/icons/eqlab-mark.svg" width="34" height="34" alt="" />
      </span>
      <span className="lobby-logo-word">
        <b>EQ</b>
        <i>Lab</i>
      </span>
    </span>
  );
}
