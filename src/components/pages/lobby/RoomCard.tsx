import { useState } from "react";
import { Download, Eye, KeyRound, LogIn, Pencil, Trash2, UserPlus } from "lucide-react";
import type { RoomMeta } from "../../../rooms";
import { ROOM_STATUS_TEXT } from "../../../uiText";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { ConfirmSheet, TextPromptSheet } from "../../ui/Sheet";
import { GameTableRow } from "./GameTable";

/**
 * A two-line table row. Opening or joining is intentionally available only
 * through the labeled action button, never through the row surface.
 */
export function RoomCard({
  room,
  hasOpponent,
  role,
  onOpen,
  onJoinWithCode,
  onRename,
  onDelete,
  onExport,
}: {
  room: RoomMeta;
  hasOpponent: boolean;
  role: { canManage: boolean; canCreate: boolean; label: string };
  onOpen: () => void;
  onJoinWithCode: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isSolo = room.gameMode === "solo";
  const statusLabel = room.status === "draft" ? ROOM_STATUS_TEXT.waiting : ROOM_STATUS_TEXT.playing;
  const spectator = role.label === "Spectator";
  const openSeat = room.status !== "playing" && !hasOpponent;
  const needsCode = spectator && openSeat && room.joinPolicy === "code_only";
  const actionLabel = needsCode
    ? "Join with code"
    : spectator && openSeat && room.joinPolicy === "open"
      ? "Join"
      : spectator
        ? "View game"
        : "Open game";
  const actionIcon = needsCode ? (
    <KeyRound size={16} />
  ) : actionLabel === "Join" ? (
    <LogIn size={16} />
  ) : (
    <Eye size={16} />
  );

  return (
    <>
      <GameTableRow
        primary={
          <>
            <span className="eq-room-card-badges">
              <span className={`eq-privacy-badge eq-privacy-${room.visibility ?? "public"}`}>
                {room.visibility === "region" ? "Region" : "Public"}
              </span>
              <span className={`eq-status eq-status-${room.status}`}>{statusLabel}</span>
            </span>
            <span className="eq-room-card-name">{room.name}</span>
            <span className="eq-room-card-players">
              <em>
                {room.playerA} <b>{room.scoreA}</b>
              </em>
              {!isSolo && (
                <>
                  <span className="eq-room-card-separator">·</span>
                  <em>
                    {room.playerB} <b>{room.scoreB}</b>
                  </em>
                </>
              )}
            </span>
          </>
        }
        secondary={
          <>
            <span className="eq-room-card-owner">
              <i>{role.label}</i>
            </span>
            <span className="eq-room-card-join-hint">
              {room.joinPolicy === "open" ? (
                <>
                  <UserPlus size={14} /> Open join
                </>
              ) : (
                <>
                  <KeyRound size={14} />
                  {room.joinPolicy === "code_only" ? "Code required" : "Invite only"}
                </>
              )}
            </span>
            <span className="eq-room-card-turn">Turn {room.turnNumber}</span>
            <span className="eq-room-card-time">{formatRelative(room.updatedAt)}</span>
          </>
        }
        creator={room.ownerName ?? "Unknown account"}
        actions={
          <>
            <button
              className="eq-button eq-button-secondary eq-game-row-action"
              type="button"
              onClick={needsCode ? onJoinWithCode : onOpen}
            >
              {actionIcon} {actionLabel}
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
          </>
        }
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
    </>
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
