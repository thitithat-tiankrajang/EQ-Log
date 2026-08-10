import type { RoomMeta } from "../../../rooms";
import { RoomCard } from "./RoomCard";
import { GameTable } from "./GameTable";

export function RoomsView({
  rooms,
  loading,
  syncError,
  getRoomRole,
  onOpen,
  onJoinWithCode,
  onRename,
  onDelete,
  onExport,
}: {
  rooms: RoomMeta[];
  loading: boolean;
  syncError?: string | null;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onJoinWithCode: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}) {
  const { openSeats, matched } = partitionLiveRooms(rooms);

  return (
    <div className="eq-rooms-view">
      {syncError && <p className="eq-alert eq-alert-error">{syncError}</p>}

      {loading ? (
        <div className="eq-skeleton-list" aria-label="Loading rooms" role="status">
          {[0, 1, 2].map((item) => (
            <span key={item} />
          ))}
        </div>
      ) : (
        <div className="eq-live-tables">
          <LiveTable
            title="Waiting for an opponent"
            description="Open games that still have a player seat available."
            rooms={openSeats}
            emptyMessage="No games are waiting for an opponent."
            getRoomRole={getRoomRole}
            onOpen={onOpen}
            onJoinWithCode={onJoinWithCode}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
          />
          <LiveTable
            title="Matched & in progress"
            description="Games with both sides assigned, including waiting and active matches."
            rooms={matched}
            emptyMessage="No matched or active games right now."
            getRoomRole={getRoomRole}
            onOpen={onOpen}
            onJoinWithCode={onJoinWithCode}
            onRename={onRename}
            onDelete={onDelete}
            onExport={onExport}
          />
        </div>
      )}
    </div>
  );
}

function LiveTable({
  title,
  description,
  rooms,
  emptyMessage,
  getRoomRole,
  onOpen,
  onJoinWithCode,
  onRename,
  onDelete,
  onExport,
}: {
  title: string;
  description: string;
  rooms: RoomMeta[];
  emptyMessage: string;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onJoinWithCode: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
}) {
  return (
    <section className="eq-live-table-section" aria-labelledby={`live-table-${slug(title)}`}>
      <div className="eq-live-table-heading">
        <div>
          <h3 id={`live-table-${slug(title)}`}>{title}</h3>
          <p>{description}</p>
        </div>
        <span className="eq-count">{rooms.length}</span>
      </div>
      <GameTable label={title} emptyMessage={emptyMessage}>
        {rooms.map((room) => (
          <RoomCard
            key={room.id}
            room={room}
            hasOpponent={roomHasOpponent(room)}
            role={getRoomRole(room)}
            onOpen={() => onOpen(room.id)}
            onJoinWithCode={onJoinWithCode}
            onRename={(name) => onRename(room.id, name)}
            onDelete={() => onDelete(room.id)}
            onExport={() => onExport(room.id)}
          />
        ))}
      </GameTable>
    </section>
  );
}

export function partitionLiveRooms(rooms: RoomMeta[]): {
  openSeats: RoomMeta[];
  matched: RoomMeta[];
} {
  const liveRooms = rooms.filter((room) => room.status !== "finished");
  return {
    openSeats: liveRooms.filter((room) => room.status !== "playing" && !roomHasOpponent(room)),
    matched: liveRooms.filter((room) => room.status === "playing" || roomHasOpponent(room)),
  };
}

function roomHasOpponent(room: RoomMeta): boolean {
  if (room.gameMode === "solo" || room.modeKey?.startsWith("aether_")) return true;
  if (typeof room.hasOpponent === "boolean") return room.hasOpponent;
  const participants = new Set(
    [room.inviteUserAId, room.inviteUserBId].filter((id): id is string => Boolean(id)),
  );
  if (participants.size > 1) return true;
  return room.joinPolicy === "invite_only";
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/(^-|-$)/g, "");
}
