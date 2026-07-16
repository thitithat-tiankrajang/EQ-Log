import { useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import { useRef } from "react";
import { Plus, Upload } from "lucide-react";
import type { GameState, Side } from "../../../game";
import type { RoomMeta } from "../../../rooms";
import type { Member } from "../../../members";
import { RoomCard } from "./RoomCard";
import {
  RoomFilters,
  defaultRoomsFilter,
  type RoomsFilterState,
} from "./RoomFilters";

export function RoomsView({
  rooms,
  members,
  loading,
  canCreate,
  createDisabledReason,
  syncError,
  getRoomRole,
  onOpen,
  onCreateRoom,
  onRename,
  onDuplicate,
  onDelete,
  onExport,
  onImport,
}: {
  rooms: RoomMeta[];
  members: Member[];
  loading: boolean;
  canCreate: boolean;
  createDisabledReason: string | null;
  syncError?: string | null;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onCreateRoom: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (game: GameState) => void;
}) {
  const [filter, setFilter] = useState<RoomsFilterState>(defaultRoomsFilter);
  const importRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => filterRooms(rooms, filter), [rooms, filter]);

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
      .catch(() => window.alert("This file is not an Equation Lab Board export."));
    event.target.value = "";
  }

  return (
    <div className="rooms-view">
      <div className="rooms-view-actions">
        <input
          ref={importRef}
          accept="application/json"
          className="hidden-input"
          type="file"
          onChange={handleImport}
        />
        <button
          className="ghost-button"
          type="button"
          disabled={!canCreate}
          title={createDisabledReason ?? "Import a saved game"}
          onClick={() => importRef.current?.click()}
        >
          <Upload size={15} />
          Import
        </button>
        <button
          className="solid-button"
          type="button"
          disabled={!canCreate}
          title={createDisabledReason ?? "Create a new room"}
          onClick={onCreateRoom}
        >
          <Plus size={15} />
          New room
        </button>
      </div>

      {syncError && <p className="sync-banner">{syncError}</p>}
      {!canCreate && createDisabledReason && (
        <p className="info-banner">{createDisabledReason}</p>
      )}

      <RoomFilters
        filter={filter}
        members={members}
        totalCount={rooms.length}
        visibleCount={filtered.length}
        onChange={setFilter}
      />

      {loading ? (
        <p className="empty-state">Loading rooms…</p>
      ) : rooms.length === 0 ? (
        <p className="empty-state">
          No rooms yet. Tap <strong>New room</strong> to record your first match.
        </p>
      ) : filtered.length === 0 ? (
        <p className="empty-state">
          No rooms match these filters. Try clearing them or broadening the search.
        </p>
      ) : (
        <div className="room-grid">
          {filtered.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              members={members}
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
  );
}

function filterRooms(rooms: RoomMeta[], filter: RoomsFilterState): RoomMeta[] {
  const query = filter.search.trim().toLowerCase();
  return rooms.filter((room) => {
    if (filter.status !== "all" && room.status !== filter.status) return false;
    if (query) {
      const haystack = [room.name, room.playerA, room.playerB, room.ownerName ?? ""]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    for (const constraint of filter.members) {
      if (!matchesMember(room, constraint.memberId, constraint.position)) return false;
    }
    return true;
  });
}

function matchesMember(
  room: RoomMeta,
  memberId: string,
  position: "any" | "first" | "second",
): boolean {
  const memberSide: Side | null =
    room.memberAId === memberId ? "A" : room.memberBId === memberId ? "B" : null;
  if (!memberSide) return false;
  if (position === "any") return true;
  const startingSide = room.startingSide ?? "A";
  if (position === "first") return memberSide === startingSide;
  return memberSide !== startingSide;
}
