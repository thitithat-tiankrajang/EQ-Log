import { useMemo, useState } from "react";
import { BarChart3, ChevronRight, KeyRound, LayoutGrid, Plus, User, Users } from "lucide-react";
import type { GameState } from "../../game";
import type { RoomMeta } from "../../rooms";
import { AccountChip, useAuth } from "../../auth";
import { AdminButton } from "../../admin";
import { computeAllMemberStats } from "../../stats";
import { HOME_TEXT, ROOM_STATUS_TEXT } from "../../uiText";
import { Sheet } from "../ui/Sheet";
import { LobbyLogo } from "./lobby/LobbyLogo";
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
  const { userId, signInWithGoogle } = useAuth();
  const [tab, setTab] = useState<LobbyTab>("rooms");
  const [signInSheetOpen, setSignInSheetOpen] = useState(false);
  const [statsFocusId, setStatsFocusId] = useState<string | null>(null);
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

  // The most recent unfinished room this account participates in. Opening the
  // app to resume a running match is the most common visit, so it gets a
  // one-tap card above everything else.
  const continueRoom = useMemo(() => {
    return (
      rooms
        .filter((room) => room.status !== "finished")
        .filter((room) => {
          const role = getRoomRole(room);
          return role.canManage || /player/i.test(role.label);
        })
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ?? null
    );
  }, [rooms, getRoomRole]);

  // Tapping a create action while signed out opens an explanation + sign-in
  // sheet instead of showing a dead greyed-out button.
  function guardCreate(action: () => void) {
    if (canCreate) action();
    else setSignInSheetOpen(true);
  }

  return (
    <main className="lobby">
      <div className="lobby-inner">
        <header className="lobby-topbar">
          <LobbyLogo />
          <div className="lobby-topbar-actions">
            <AccountChip />
            <AdminButton />
          </div>
        </header>

        {continueRoom && (
          <section className="home-block" aria-label="Continue">
            <span className="home-eyebrow">{HOME_TEXT.continueEyebrow}</span>
            <button className="continue-card" type="button" onClick={() => onOpen(continueRoom.id)}>
              <span className="continue-card-row">
                <strong className="continue-card-name">{continueRoom.name}</strong>
                <span className={`room-status-pill status-${continueRoom.status}`}>
                  {continueRoom.status === "draft"
                    ? ROOM_STATUS_TEXT.waiting
                    : continueRoom.status === "finished"
                      ? ROOM_STATUS_TEXT.finished
                      : ROOM_STATUS_TEXT.playing}
                </span>
              </span>
              <span className="continue-card-row muted">
                <span className="continue-card-players">
                  {continueRoom.gameMode === "solo"
                    ? `${continueRoom.playerA} ${continueRoom.scoreA}`
                    : `${continueRoom.playerA} ${continueRoom.scoreA} · ${continueRoom.playerB} ${continueRoom.scoreB}`}
                </span>
                <span className="continue-card-turn">
                  Turn {continueRoom.turnNumber}
                  <ChevronRight size={16} />
                </span>
              </span>
            </button>
          </section>
        )}

        <section className="home-block" aria-label="Start">
          <span className="home-eyebrow">{HOME_TEXT.startEyebrow}</span>
          <div className="start-grid">
            <button className="start-card primary" type="button" onClick={() => guardCreate(onCreateRoom)}>
              <span className="start-card-icon"><Plus size={19} /></span>
              <strong>{HOME_TEXT.newMatch}</strong>
              <em>{HOME_TEXT.newMatchSub}</em>
            </button>
            <button className="start-card" type="button" onClick={onJoinRoom}>
              <span className="start-card-icon"><KeyRound size={19} /></span>
              <strong>{HOME_TEXT.joinWithCode}</strong>
              <em>{HOME_TEXT.joinWithCodeSub}</em>
            </button>
          </div>
          <button className="start-row" type="button" onClick={() => guardCreate(onPlayAlone)}>
            <span className="start-card-icon"><User size={17} /></span>
            <strong>{HOME_TEXT.practiceAlone}</strong>
            <em>{HOME_TEXT.practiceAloneSub}</em>
          </button>
        </section>

        <nav className="lobby-tabs" aria-label="Lobby sections">
          <TabButton
            active={tab === "rooms"}
            count={rooms.length}
            label="Rooms"
            icon={<LayoutGrid size={16} />}
            onClick={() => setTab("rooms")}
          />
          <TabButton
            active={tab === "members"}
            count={members.length}
            label="Members"
            icon={<Users size={16} />}
            onClick={() => setTab("members")}
          />
          <TabButton
            active={tab === "stats"}
            count={finishedCount}
            label="Stats"
            icon={<BarChart3 size={16} />}
            onClick={() => {
              setStatsFocusId(null);
              setTab("stats");
            }}
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
              onShowStats={(memberId) => {
                setStatsFocusId(memberId);
                setTab("stats");
              }}
            />
          )}
          {tab === "stats" && (
            <StatsView
              key={statsFocusId ?? "overview"}
              members={members}
              statsByMember={statsByMember}
              initialFocusId={statsFocusId}
            />
          )}
        </section>
      </div>

      <Sheet
        open={signInSheetOpen}
        title={HOME_TEXT.signInSheetTitle}
        onClose={() => setSignInSheetOpen(false)}
      >
        <p className="ui-confirm-consequence">
          {createDisabledReason ?? HOME_TEXT.signInSheetBody}
        </p>
        {!userId && (
          <div className="ui-sheet-actions">
            <button
              type="button"
              className="ui-button-primary"
              onClick={() => {
                setSignInSheetOpen(false);
                void signInWithGoogle();
              }}
            >
              Continue with Google
            </button>
          </div>
        )}
      </Sheet>
    </main>
  );
}

function TabButton({
  active,
  count,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
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
      <span className="lobby-tab-label">
        {label}
        <span className="lobby-tab-count">{count}</span>
      </span>
    </button>
  );
}
