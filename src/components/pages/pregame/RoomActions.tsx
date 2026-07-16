import { LogOut, Pencil, Play, Trash2 } from "lucide-react";

export function RoomActions({
  canManage,
  canReady,
  isReady,
  startDisabledReason,
  busy,
  onCancel,
  onEdit,
  onLeave,
  onReady,
  onStart,
}: {
  canManage: boolean;
  canReady: boolean;
  isReady: boolean;
  startDisabledReason?: string | null;
  busy: boolean;
  onCancel: () => void;
  onEdit: () => void;
  onLeave: () => void;
  onReady: () => void;
  onStart: () => void;
}) {
  return (
    <section className="pregame-card room-actions-card">
      {canManage ? (
        <>
          <button className="pregame-primary" type="button" disabled={busy || Boolean(startDisabledReason)} title={startDisabledReason ?? undefined} onClick={onStart}>
            <Play size={18} />
            Start game
          </button>
          <button className="pregame-secondary" type="button" disabled={busy} onClick={onEdit}>
            <Pencil size={17} />
            Edit configuration
          </button>
          <button className="pregame-danger" type="button" disabled={busy} onClick={onCancel}>
            <Trash2 size={17} />
            Cancel room
          </button>
        </>
      ) : canReady ? (
        <button className={isReady ? "pregame-secondary" : "pregame-primary"} type="button" disabled={busy} onClick={onReady}>
          {isReady ? "Not ready" : "Ready"}
        </button>
      ) : (
        <p className="viewer-note">You are viewing this room. You will enter spectator mode when the game starts.</p>
      )}
      {!canManage && (
        <button className="pregame-secondary" type="button" disabled={busy} onClick={onLeave}>
          <LogOut size={17} />
          Leave room
        </button>
      )}
    </section>
  );
}
