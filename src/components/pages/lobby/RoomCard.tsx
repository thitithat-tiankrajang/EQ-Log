import { useState } from "react";
import { Copy, Download, Pencil, Trash2 } from "lucide-react";
import type { RoomMeta } from "../../../rooms";
import { ROOM_STATUS_TEXT } from "../../../uiText";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { ConfirmSheet, TextPromptSheet } from "../../ui/Sheet";

/**
 * Compact 3-line room card: the whole surface opens the room; rare actions
 * live behind "⋯" with labels and confirmations (design.md §4.2).
 */
export function RoomCard({
  room,
  role,
  onOpen,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
}: {
  room: RoomMeta;
  role: { canManage: boolean; canCreate: boolean; label: string };
  onOpen: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isSolo = room.gameMode === "solo";
  const winner =
    !isSolo && room.status === "finished" && room.scoreA !== room.scoreB
      ? room.scoreA > room.scoreB
        ? "A"
        : "B"
      : null;

  const statusLabel =
    room.status === "finished"
      ? ROOM_STATUS_TEXT.finished
      : room.status === "draft"
        ? ROOM_STATUS_TEXT.waiting
        : ROOM_STATUS_TEXT.playing;

  return (
    <article className={`room-card status-${room.status}`}>
      <button className="room-card-open" type="button" onClick={onOpen}>
        <span className="room-card-line head">
          <span className="room-card-name">{room.name}</span>
          <span className={`room-status-pill status-${room.status}`}>{statusLabel}</span>
        </span>
        <span className="room-card-line score">
          <span className="room-card-players">
            <em className={winner === "A" ? "winner" : ""}>
              {room.playerA} <b>{room.scoreA}</b>
            </em>
            {!isSolo && (
              <>
                <span className="room-card-sep">·</span>
                <em className={winner === "B" ? "winner" : ""}>
                  {room.playerB} <b>{room.scoreB}</b>
                </em>
              </>
            )}
          </span>
          <span className="room-card-turn">Turn {room.turnNumber}</span>
        </span>
        <span className="room-card-line meta">
          <span className="room-card-owner">
            {room.ownerName ? `Hosted by ${room.ownerName}` : "Local room"}
            <i>{role.label}</i>
          </span>
          <span className="room-card-time">{formatRelative(room.updatedAt)}</span>
        </span>
      </button>

      <OverflowMenu
        label={`Room actions · ${room.name}`}
        items={[
          {
            icon: <Pencil size={16} />,
            label: "Rename",
            disabled: !role.canManage,
            disabledReason: "Only the room owner can rename it",
            onSelect: () => setRenameOpen(true),
          },
          {
            icon: <Copy size={16} />,
            label: "Duplicate",
            disabled: !role.canManage || !role.canCreate,
            disabledReason: "Only the room owner can duplicate it",
            onSelect: onDuplicate,
          },
          {
            icon: <Download size={16} />,
            label: "Export file",
            onSelect: onExport,
          },
          {
            icon: <Trash2 size={16} />,
            label: "Delete room",
            danger: true,
            disabled: !role.canManage,
            disabledReason: "Only the room owner can delete it",
            onSelect: () => setDeleteOpen(true),
          },
        ]}
      />

      <TextPromptSheet
        open={renameOpen}
        title="Rename room"
        label="Room name"
        initialValue={room.name}
        submitLabel="Save name"
        onCancel={() => setRenameOpen(false)}
        onSubmit={(name) => {
          setRenameOpen(false);
          onRename(name);
        }}
      />

      <ConfirmSheet
        open={deleteOpen}
        title="Delete room"
        consequence={`Delete "${room.name}"? The board and its full turn history will be gone for everyone.`}
        confirmLabel="Delete room"
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          onDelete();
        }}
      />
    </article>
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
