import { ChangeEvent, useRef, useState } from "react";
import { Copy, Download, Pencil, Play, Plus, Trash2, Upload } from "lucide-react";
import type { GameState, NewGameSettings, Side } from "../game";
import type { RoomMeta } from "../rooms";
import { AccountChip } from "../auth";
import { AdminButton } from "../admin";

export function Lobby({
  canCreate,
  createDisabledReason,
  loading = false,
  rooms,
  syncError,
  getRoomRole,
  onOpen,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  onImport,
}: {
  canCreate: boolean;
  createDisabledReason: string | null;
  loading?: boolean;
  rooms: RoomMeta[];
  syncError?: string | null;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onCreate: (settings: NewGameSettings) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (game: GameState) => void;
}) {
  const [showCreate, setShowCreate] = useState(rooms.length === 0);
  const [settings, setSettings] = useState<NewGameSettings>({
    name: "A-math Lab",
    playerA: "A",
    playerB: "B",
    minutes: 22,
    startingSide: "A",
    untimed: false,
  });
  const importRef = useRef<HTMLInputElement | null>(null);

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as GameState;
        if (!parsed.gameId || !Array.isArray(parsed.history)) throw new Error("invalid");
        onImport(parsed);
      })
      .catch(() => window.alert("This file is not an A-math Lab Board export."));
    event.target.value = "";
  }

  return (
    <main className="lobby-shell">
      <div className="lobby-inner">
        <header className="lobby-head">
          <div>
            <p className="eyebrow">A-math Lab Board</p>
            <h1>Rooms</h1>
          </div>
          <div className="lobby-head-actions">
            <AccountChip />
            <AdminButton />
            <button
              className="icon-button"
              disabled={!canCreate}
              title={createDisabledReason ?? "Import"}
              type="button"
              onClick={() => importRef.current?.click()}
            >
              <Upload size={18} />
              Import
            </button>
            <input
              ref={importRef}
              accept="application/json"
              className="hidden-input"
              type="file"
              onChange={handleImport}
            />
            <button
              className="primary-action lobby-new"
              disabled={!canCreate}
              title={createDisabledReason ?? "New Room"}
              type="button"
              onClick={() => setShowCreate((value) => !value)}
            >
              <Plus size={18} />
              New Room
            </button>
          </div>
        </header>

        {syncError && <p className="sync-error">{syncError}</p>}
        {!canCreate && createDisabledReason && <p className="spectator-note">{createDisabledReason}</p>}

        {showCreate && canCreate && (
          <section className="setup-panel lobby-create">
            <div className="setup-grid">
              <label>
                Room name
                <input
                  value={settings.name}
                  onChange={(event) => setSettings((current) => ({ ...current, name: event.target.value }))}
                />
              </label>
              <label>
                Side A
                <input
                  value={settings.playerA}
                  onChange={(event) => setSettings((current) => ({ ...current, playerA: event.target.value }))}
                />
              </label>
              <label>
                Side B
                <input
                  value={settings.playerB}
                  onChange={(event) => setSettings((current) => ({ ...current, playerB: event.target.value }))}
                />
              </label>
              <label>
                Time per side (minutes)
                <input
                  min={1}
                  step={1}
                  type="number"
                  disabled={Boolean(settings.untimed)}
                  value={settings.minutes}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, minutes: Number(event.target.value) || 22 }))
                  }
                />
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(settings.untimed)}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, untimed: event.target.checked }))
                  }
                />
                <span>No timer (untimed game)</span>
              </label>
              <fieldset>
                <legend>Starting side</legend>
                <div className="segmented">
                  {(["A", "B"] as Side[]).map((side) => (
                    <button
                      className={settings.startingSide === side ? "active" : ""}
                      key={side}
                      type="button"
                      onClick={() => setSettings((current) => ({ ...current, startingSide: side }))}
                    >
                      {side}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>
            <button className="primary-action" type="button" onClick={() => onCreate(settings)}>
              <Play size={18} />
              Start Room
            </button>
          </section>
        )}

        {loading ? (
          <p className="empty-text lobby-empty">Loading rooms…</p>
        ) : rooms.length === 0 ? (
          <p className="empty-text lobby-empty">No rooms yet. Rooms will appear here as soon as someone opens one.</p>
        ) : (
          <div className="room-grid">
            {rooms.map((room) => (
              <RoomCard
                key={room.id}
                room={room}
                role={getRoomRole(room)}
                onOpen={() => onOpen(room.id)}
                onRename={() => {
                  const name = window.prompt("Rename room", room.name);
                  if (name && name.trim()) onRename(room.id, name.trim());
                }}
                onDuplicate={() => onDuplicate(room.id)}
                onDelete={() => onDelete(room.id)}
                onExport={() => onExport(room.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function RoomCard({
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
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  return (
    <article className={`room-card ${room.status === "finished" ? "finished" : ""}`}>
      <button className="room-open" type="button" onClick={onOpen}>
        <div className="room-card-head">
          <strong>{room.name}</strong>
          <span className={`room-status ${room.status}`}>
            {room.status === "finished" ? "Finished" : "Playing"}
          </span>
        </div>
        <div className="room-players">
          {room.playerA} <span>vs</span> {room.playerB}
        </div>
        <div className="room-owner">
          <span>{room.ownerName ? `Opened by ${room.ownerName}` : "Local room"}</span>
          <em>{role.label}</em>
        </div>
        <div className="room-meta">
          <span>Turn {room.turnNumber}</span>
          <span>
            {room.scoreA} : {room.scoreB} pts
          </span>
        </div>
        <div className="room-updated">{formatRelative(room.updatedAt)}</div>
      </button>
      <div className="room-card-actions">
        <button type="button" disabled={!role.canManage} title="Rename" onClick={onRename}>
          <Pencil size={15} />
        </button>
        <button type="button" disabled={!role.canManage || !role.canCreate} title="Duplicate" onClick={onDuplicate}>
          <Copy size={15} />
        </button>
        <button type="button" title="Export" onClick={onExport}>
          <Download size={15} />
        </button>
        <button className="danger" type="button" disabled={!role.canManage} title="Delete" onClick={onDelete}>
          <Trash2 size={15} />
        </button>
      </div>
    </article>
  );
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en-US");
}
