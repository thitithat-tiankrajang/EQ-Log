import { Crown, Eye, User } from "lucide-react";
import type { Side } from "../../../game";

export type WaitingParticipant = {
  id: string;
  name: string;
  detail: string;
  kind: "host" | "player" | "viewer";
  side?: Side;
  status: string;
  ready?: boolean;
};

export function PlayerList({ participants }: { participants: WaitingParticipant[] }) {
  return (
    <section className="pregame-card waiting-section">
      <header className="waiting-section-head">
        <div>
          <span className="pregame-eyebrow">Participants</span>
          <h2>Room members</h2>
        </div>
        <span className="pregame-count">{participants.length}</span>
      </header>
      <div className="participant-list">
        {participants.map((participant) => (
          <div className="participant-row" key={participant.id}>
            <span className={`participant-icon ${participant.kind}`} aria-hidden="true">
              {participant.kind === "host" ? (
                <Crown size={17} />
              ) : participant.kind === "viewer" ? (
                <Eye size={17} />
              ) : (
                <User size={17} />
              )}
            </span>
            <div className="participant-copy">
              <strong>{participant.name}</strong>
              <span>{participant.detail}</span>
            </div>
            {participant.side && <span className="participant-side">Side {participant.side}</span>}
            <span className={`participant-status ${participant.ready ? "ready" : ""}`}>
              {participant.status}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
