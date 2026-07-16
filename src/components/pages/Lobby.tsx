import { useMemo, useState } from "react";
import { BarChart3, LayoutGrid, LogIn, Plus, User, Users } from "lucide-react";
import type { GameState } from "../../game";
import type { RoomMeta } from "../../rooms";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { computeAllMemberStats } from "../../stats";
import { RoomsView } from "./lobby/RoomsView";
import { MembersView } from "./lobby/MembersView";
import { StatsView } from "./lobby/StatsView";
import { useMembersCatalog } from "./lobby/useMembersCatalog";

type LobbyTab = "rooms" | "members" | "stats";

export function Lobby({
  canCreate,
  createDisabledReason,
  loading = false,
  rooms,
  syncError,
  canManageMembers,
  getRoomRole,
  onOpen,
  onCreateRoom,
  onJoinRoom,
  onPlayAlone,
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
  canManageMembers: boolean;
  getRoomRole: (room: RoomMeta) => { canManage: boolean; canCreate: boolean; label: string };
  onOpen: (id: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onPlayAlone: () => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onImport: (game: GameState) => void;
}) {
  const { userId } = useAuth();
  const [tab, setTab] = useState<LobbyTab>("rooms");
  const {
    error: membersError,
    loading: membersLoading,
    members,
    setMembers,
  } = useMembersCatalog(userId);

  const statsByMember = useMemo(
    () => computeAllMemberStats(members, rooms),
    [members, rooms],
  );

  const finishedCount = useMemo(
    () => rooms.filter((room) => room.status === "finished").length,
    [rooms],
  );

  return (
    <main className="lobby">
      <div className="lobby-inner">
        <header className="lobby-head">
          <div className="lobby-brand">
            <span className="lobby-brand-eyebrow">Equation Board</span>
            <h1>Match Lab</h1>
            <p className="lobby-brand-sub">
              Record real-life matches and review the numbers behind your organization.
            </p>
          </div>
          <div className="lobby-head-actions">
            <AccountChip />
            <AdminButton />
          </div>
        </header>

        <section className="home-actions" aria-label="Start playing">
          <button className="home-action primary" type="button" disabled={!canCreate} onClick={onPlayAlone}>
            <span><User size={21} /></span>
            <strong>Play Alone</strong>
            <em>Start a solo board with system draw</em>
          </button>
          <button className="home-action" type="button" disabled={!canCreate} onClick={onCreateRoom}>
            <span><Plus size={21} /></span>
            <strong>Create Room</strong>
            <em>Configure local or email play</em>
          </button>
          <button className="home-action" type="button" onClick={onJoinRoom}>
            <span><LogIn size={21} /></span>
            <strong>Join Room</strong>
            <em>Use a room code or shared link</em>
          </button>
        </section>

        <nav className="lobby-tabs" aria-label="Lobby sections">
          <TabButton
            active={tab === "rooms"}
            count={rooms.length}
            label="Rooms"
            icon={<LayoutGrid size={15} />}
            onClick={() => setTab("rooms")}
          />
          <TabButton
            active={tab === "members"}
            count={members.length}
            label="Members"
            icon={<Users size={15} />}
            onClick={() => setTab("members")}
          />
          <TabButton
            active={tab === "stats"}
            count={finishedCount}
            countLabel={finishedCount === 1 ? "finished" : "finished"}
            label="Stats"
            icon={<BarChart3 size={15} />}
            onClick={() => setTab("stats")}
          />
        </nav>

        <section className="lobby-body">
          {tab === "rooms" && (
            <RoomsView
              rooms={rooms}
              members={members}
              loading={loading}
              canCreate={canCreate}
              createDisabledReason={createDisabledReason}
              syncError={syncError}
              getRoomRole={getRoomRole}
              onOpen={onOpen}
              onCreateRoom={onCreateRoom}
              onRename={onRename}
              onDuplicate={onDuplicate}
              onDelete={onDelete}
              onExport={onExport}
              onImport={onImport}
            />
          )}
          {tab === "members" && (
            <MembersView
              members={members}
              statsByMember={statsByMember}
              canManage={canManageMembers}
              error={membersError}
              loading={membersLoading}
              ownerId={userId}
              onChange={setMembers}
            />
          )}
          {tab === "stats" && (
            <StatsView members={members} statsByMember={statsByMember} />
          )}
        </section>
      </div>
    </main>
  );
}

function TabButton({
  active,
  count,
  countLabel,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  countLabel?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={`lobby-tab ${active ? "active" : ""}`}
      onClick={onClick}
    >
      <span className="lobby-tab-icon">{icon}</span>
      <span className="lobby-tab-label">{label}</span>
      <span className="lobby-tab-count">
        {count}
        {countLabel && <em> {countLabel}</em>}
      </span>
    </button>
  );
}
