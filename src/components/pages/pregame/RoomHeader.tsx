import { Check, Copy, Share2 } from "lucide-react";
import { useState } from "react";

export function RoomHeader({
  name,
  roomCode,
  role,
  onCopyCode,
  onShare,
}: {
  name: string;
  roomCode: string;
  role: string;
  onCopyCode: () => Promise<void>;
  onShare: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await onCopyCode();
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return (
    <section className="pregame-card room-header-card">
      <div className="room-title-block">
        <span className="pregame-badge">{role}</span>
        <h2>{name}</h2>
        <p>Waiting room</p>
      </div>
      <div className="room-code-block">
        <span>Room code</span>
        <button type="button" className="room-code-button" onClick={copy}>
          <strong>{roomCode}</strong>
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>
      <button className="pregame-secondary room-share-button" type="button" onClick={onShare}>
        <Share2 size={17} />
        Share room
      </button>
    </section>
  );
}
