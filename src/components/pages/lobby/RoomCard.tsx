import { Copy, Download, Mail, Pencil, Trash2 } from "lucide-react";
import type { RoomMeta } from "../../../rooms";
import type { Member } from "../../../members";
import type { Side } from "../../../game";
import { MemberChip, MemberPlaceholderChip } from "./MemberChip";

export function RoomCard({
  room,
  members,
  role,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: {
  room: RoomMeta;
  members: Member[];
  role: { canManage: boolean; canCreate: boolean; label: string };
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const memberA = room.memberAId ? members.find((m) => m.id === room.memberAId) ?? null : null;
  const memberB = room.memberBId ? members.find((m) => m.id === room.memberBId) ?? null : null;
  const startingSide: Side | null = room.startingSide ?? null;
  const winner = room.status === "finished" && room.scoreA !== room.scoreB
    ? room.scoreA > room.scoreB
      ? "A"
      : "B"
    : null;

  const statusLabel =
    room.status === "finished" ? "Finished" : room.status === "draft" ? "Draft" : "Playing";

  return (
    <article className={`room-card status-${room.status}`}>
      <button className="room-card-open" type="button" onClick={onOpen}>
        <header className="room-card-head">
          <span className="room-card-name">{room.name}</span>
          <span className={`room-card-status status-${room.status}`}>{statusLabel}</span>
        </header>

        <div className="room-card-players">
          <PlayerRow
            side="A"
            member={memberA}
            label={room.playerA}
            remote={Boolean(room.inviteEmailA)}
            score={room.scoreA}
            starting={startingSide === "A"}
            winner={winner === "A"}
            finished={room.status === "finished"}
          />
          <span className="room-card-vs">vs</span>
          <PlayerRow
            side="B"
            member={memberB}
            label={room.playerB}
            remote={Boolean(room.inviteEmailB)}
            score={room.scoreB}
            starting={startingSide === "B"}
            winner={winner === "B"}
            finished={room.status === "finished"}
          />
        </div>

        <footer className="room-card-foot">
          <span className="room-card-turn">Turn {room.turnNumber}</span>
          <span className="room-card-owner">
            {room.ownerName ? room.ownerName : "Local"}
            <em>{role.label}</em>
          </span>
          <span className="room-card-time">{formatRelative(room.updatedAt)}</span>
        </footer>
      </button>

      <div className="room-card-actions">
        <button
          type="button"
          disabled={!role.canManage}
          title="Rename room"
          aria-label="Rename room"
          onClick={onRename}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          disabled={!role.canManage || !role.canCreate}
          title="Duplicate room"
          aria-label="Duplicate room"
          onClick={onDuplicate}
        >
          <Copy size={14} />
        </button>
        <button type="button" title="Export room" aria-label="Export room" onClick={onExport}>
          <Download size={14} />
        </button>
        <button
          className="danger"
          type="button"
          disabled={!role.canManage}
          title="Delete room"
          aria-label="Delete room"
          onClick={onDelete}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function PlayerRow({
  side,
  member,
  label,
  remote,
  score,
  starting,
  winner,
  finished,
}: {
  side: Side;
  member: Member | null;
  label: string;
  remote: boolean;
  score: number;
  starting: boolean;
  winner: boolean;
  finished: boolean;
}) {
  return (
    <div className={`room-card-player side-${side.toLowerCase()} ${winner ? "winner" : ""}`}>
      <div className="room-card-player-chip">
        {member ? (
          <MemberChip member={member} hint={starting ? "1st" : null} />
        ) : (
          <MemberPlaceholderChip name={label} hint={starting ? "1st" : null} />
        )}
        {remote && (
          <span className="room-card-remote" title="This side plays from another signed-in account">
            <Mail size={11} />
            Email player
          </span>
        )}
      </div>
      <div className={`room-card-player-score ${finished ? "final" : ""}`}>{score}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
