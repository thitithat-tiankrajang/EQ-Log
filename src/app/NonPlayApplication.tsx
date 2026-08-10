import { Coffee } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPage } from "../admin";
import { useAuth } from "../auth";
import { GlobalActivity } from "../components/feedback/LoadingActivity";
import { Lobby } from "../components/pages/Lobby";
import { CreateRoomPage } from "../components/pages/pregame/CreateRoomPage";
import { JoinRoomPage } from "../components/pages/pregame/JoinRoomPage";
import { WaitingRoomPage } from "../components/pages/pregame/WaitingRoomPage";
import { PrivateLibraryPage } from "../components/pages/PrivateLibraryPage";
import { ProfilePage } from "../components/pages/ProfilePage";
import { STORAGE_KEYS } from "../constants/storage";
import {
  getGameMode,
  normalizeEmail,
  normalizeUserId,
  type GameState,
  type NewGameSettings,
  type Side,
} from "../game";
import {
  createWaitingGame,
  formatRoomCode,
  getRoomStage,
  parseRemoteJoinTarget,
  resolveRoomCode,
  startWaitingGame,
  updateWaitingGame,
} from "../pregame";
import * as remoteRooms from "../remoteRooms";
import {
  makeRoomScope,
  roomBelongsToScope,
  type RoomScope,
  type RoomVisibility,
} from "../roomScope";
import * as localRooms from "../rooms";
import type { RoomMeta } from "../rooms";
import { navigate, useRoute } from "../router";
import { isSupabaseConfigured } from "../supabaseClient";
import { ApplicationShell } from "./shells/ApplicationShell";
import {
  ARCHIVE_PAGE_SIZE,
  listArchiveGames,
  saveArchiveToPrivate,
  type ArchiveGame,
} from "../features/gameRecords/repository";

export default function NonPlayApplication() {
  const { configured, isApproved, profile, userId } = useAuth();
  const route = useRoute();
  const remoteEnabled = isSupabaseConfigured;
  const regionId = profile?.region_id ?? null;
  const regionName = profile?.region_name ?? null;
  const accountEmail = normalizeEmail(profile?.email);
  const hasAdminAccess = remoteEnabled && Boolean(userId && profile?.is_admin);
  const canCreateRoom = !remoteEnabled || Boolean(userId && (isApproved || hasAdminAccess));
  const initialVisibility = scopedVisibility(route) ?? "public";
  const initialScope = makeRoomScope(initialVisibility, regionId);
  const [lobbyVisibility, setLobbyVisibility] = useState<RoomVisibility>(initialVisibility);
  const [rooms, setRooms] = useState<RoomMeta[]>(() =>
    remoteEnabled || !initialScope ? [] : localRooms.listRooms(initialScope),
  );
  const [roomsLoading, setRoomsLoading] = useState(remoteEnabled);
  const [archives, setArchives] = useState<ArchiveGame[]>([]);
  const [archivesTotal, setArchivesTotal] = useState(0);
  const [archivesLoading, setArchivesLoading] = useState(remoteEnabled);
  const [archivesLoadingMore, setArchivesLoadingMore] = useState(false);
  const [archiveEpoch, setArchiveEpoch] = useState(0);
  const [foregroundLoading, setForegroundLoading] = useState<string | null>(null);
  const [backgroundSyncing, setBackgroundSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(
    route.kind === "room" ? route.roomId : null,
  );
  const [activeRoomMeta, setActiveRoomMeta] = useState<RoomMeta | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [coffeeRoomId, setCoffeeRoomId] = useState<string | null>(() =>
    window.localStorage.getItem(STORAGE_KEYS.coffeeRoom),
  );

  const requestedVisibility = scopedVisibility(route) ?? lobbyVisibility;
  const requestedScope = useMemo(
    () => makeRoomScope(requestedVisibility, regionId),
    [regionId, requestedVisibility],
  );
  const roomRouteId = route.kind === "room" ? route.roomId : null;
  const canCreateInScope = canCreateRoom && requestedScope !== null;
  const createDisabledReason = configured
    ? !userId
      ? "Sign in to create a room."
      : !isApproved && !hasAdminAccess
        ? "Your account must be approved before creating a room."
        : requestedVisibility === "region" && !regionId
          ? "An admin must assign your account to a region before you can create a region room."
          : null
    : null;

  const readRoom = useCallback(
    async (id: string): Promise<{ game: GameState; meta: RoomMeta } | null> => {
      if (remoteEnabled) {
        const payload = await remoteRooms.readRoom(id);
        return payload ? { game: payload.game, meta: payload.meta } : null;
      }
      const saved = localRooms.readRoom(id);
      const scopes: RoomScope[] = [
        { visibility: "public", regionId: null },
        ...(regionId ? [{ visibility: "region" as const, regionId }] : []),
      ];
      const meta =
        scopes.flatMap((scope) => localRooms.listRooms(scope)).find((room) => room.id === id) ??
        null;
      return saved && meta ? { game: saved, meta } : null;
    },
    [regionId, remoteEnabled],
  );

  useEffect(() => {
    const visibility = scopedVisibility(route);
    if (visibility) setLobbyVisibility(visibility);
  }, [route]);

  useEffect(() => {
    if (route.kind !== "home" && route.kind !== "create" && route.kind !== "join") return;
    let active = true;
    if (!requestedScope) {
      setRooms([]);
      setRoomsLoading(false);
      return;
    }
    setRoomsLoading(true);
    setSyncError(null);
    const request = remoteEnabled
      ? remoteRooms.listRooms(requestedScope)
      : Promise.resolve(localRooms.listRooms(requestedScope));
    void request
      .then((next) => {
        if (active) setRooms(next);
      })
      .catch((error: Error) => {
        if (active) setSyncError(error.message);
      })
      .finally(() => {
        if (active) setRoomsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [remoteEnabled, requestedScope, route.kind]);

  useEffect(() => {
    if (route.kind !== "home") return;
    let active = true;
    setArchivesLoading(true);
    void listArchiveGames(route.visibility, route.visibility === "region" ? regionId : null)
      .then((next) => {
        if (active) {
          setArchives(next.games);
          setArchivesTotal(next.total);
        }
      })
      .catch((error: Error) => {
        if (active) setSyncError(error.message);
      })
      .finally(() => {
        if (active) setArchivesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [archiveEpoch, regionId, route]);

  async function loadMoreArchives() {
    if (route.kind !== "home" || archivesLoadingMore || archives.length >= archivesTotal) return;
    setArchivesLoadingMore(true);
    try {
      const next = await listArchiveGames(
        route.visibility,
        route.visibility === "region" ? regionId : null,
        archives.length,
        ARCHIVE_PAGE_SIZE,
      );
      setArchives((current) => [
        ...current,
        ...next.games.filter((game) => !current.some((item) => item.gameId === game.gameId)),
      ]);
      setArchivesTotal(next.total);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Unable to load more game history.");
    } finally {
      setArchivesLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!roomRouteId) return;
    let active = true;
    setActiveRoomId(roomRouteId);
    setForegroundLoading("Opening waiting room…");
    void readRoom(roomRouteId)
      .then((payload) => {
        if (!active) return;
        if (!payload) {
          setSyncError("This room is unavailable or you do not have access to it.");
          return;
        }
        setActiveRoomMeta((current) => ({
          ...payload.meta,
          roomCode: payload.meta.roomCode ?? current?.roomCode ?? null,
        }));
        setGame(payload.game);
        setLobbyVisibility(payload.meta.visibility ?? "public");
        if (getRoomStage(payload.game) === "playing") {
          navigate({ kind: "play", roomId: roomRouteId }, true);
        }
      })
      .catch((error: Error) => {
        if (active) setSyncError(error.message);
      })
      .finally(() => {
        if (active) setForegroundLoading(null);
      });
    return () => {
      active = false;
    };
  }, [readRoom, roomRouteId]);

  useEffect(() => {
    if (!remoteEnabled || !roomRouteId) return;
    return remoteRooms.subscribeToRoom(
      roomRouteId,
      (change) => {
        if (!change.new || !("id" in change.new)) return;
        const payload = remoteRooms.payloadFromRow(change.new);
        setActiveRoomMeta((current) => ({
          ...payload.meta,
          roomCode: payload.meta.roomCode ?? current?.roomCode ?? null,
        }));
        setGame(payload.game);
        if (getRoomStage(payload.game) === "playing") {
          navigate({ kind: "play", roomId: roomRouteId }, true);
        }
      },
      () => undefined,
      (status) => {
        setBackgroundSyncing(status !== "SUBSCRIBED");
        if (status !== "SUBSCRIBED") return;
        void readRoom(roomRouteId).then((payload) => {
          if (!payload) return;
          setActiveRoomMeta((current) => ({
            ...payload.meta,
            roomCode: payload.meta.roomCode ?? current?.roomCode ?? null,
          }));
          setGame(payload.game);
        });
      },
    );
  }, [readRoom, remoteEnabled, roomRouteId]);

  const invitedSides = useMemo(
    () =>
      activeRoomMeta
        ? (["A", "B"] as Side[]).filter((side) =>
            accountMatchesInvite(
              side === "A" ? activeRoomMeta.inviteUserAId : activeRoomMeta.inviteUserBId,
              side === "A" ? activeRoomMeta.inviteEmailA : activeRoomMeta.inviteEmailB,
              userId,
              accountEmail,
            ),
          )
        : [],
    [accountEmail, activeRoomMeta, userId],
  );
  const canManageActive =
    !remoteEnabled || Boolean(userId && (hasAdminAccess || activeRoomMeta?.ownerId === userId));
  const activeDirectRoom = Boolean(
    activeRoomMeta &&
    ((activeRoomMeta.ownerId &&
      [activeRoomMeta.inviteUserAId, activeRoomMeta.inviteUserBId].includes(
        activeRoomMeta.ownerId,
      )) ||
      (normalizeEmail(activeRoomMeta.ownerEmail) &&
        [
          normalizeEmail(activeRoomMeta.inviteEmailA),
          normalizeEmail(activeRoomMeta.inviteEmailB),
        ].includes(normalizeEmail(activeRoomMeta.ownerEmail)))),
  );
  const canConfigureWaiting =
    canManageActive && (!activeDirectRoom || activeRoomMeta?.ownerId === userId);

  async function withLoading<T>(
    message: string,
    operation: () => Promise<T>,
  ): Promise<{ ok: true; value: T } | { ok: false }> {
    setForegroundLoading(message);
    setSyncError(null);
    try {
      return { ok: true, value: await operation() };
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Something went wrong.");
      return { ok: false };
    } finally {
      setForegroundLoading(null);
    }
  }

  async function openRoom(id: string, expectedScope?: RoomScope | null): Promise<boolean> {
    if (expectedScope === null) return false;
    const result = await withLoading("Opening room…", () => readRoom(id));
    if (!result.ok || !result.value) return false;
    const payload = result.value;
    if (expectedScope && !roomBelongsToScope(payload.meta, expectedScope)) return false;
    setActiveRoomId(id);
    setActiveRoomMeta(payload.meta);
    setGame(payload.game);
    setLobbyVisibility(payload.meta.visibility ?? "public");
    if (!remoteEnabled) localRooms.setActiveRoomId(id);
    navigate(
      getRoomStage(payload.game) === "waiting"
        ? { kind: "room", roomId: id }
        : { kind: "play", roomId: id },
    );
    return true;
  }

  async function createAndOpenRoom(
    settings: NewGameSettings,
    policy: remoteRooms.CreateRoomPolicy,
  ) {
    const visibility = policy.accessScope === "region" ? "region" : "public";
    const scope = makeRoomScope(visibility, regionId);
    if (!scope || !canCreateRoom) {
      setSyncError(createDisabledReason ?? "You cannot create a room right now.");
      return;
    }
    const solo = getGameMode(settings) === "solo";
    const playerAUserId = normalizeUserId(settings.playerAUserId);
    const playerBUserId = solo ? null : normalizeUserId(settings.playerBUserId);
    const playerAEmail = normalizeEmail(settings.playerAEmail);
    const playerBEmail = solo ? null : normalizeEmail(settings.playerBEmail);
    const waiting = markOwnerSideReady(
      createWaitingGame({
        ...settings,
        playerAUserId,
        playerBUserId,
        playerAEmail,
        playerBEmail,
        tileDrawMode:
          settings.emailPlayMode === "direct" || (solo && !playerAUserId && !playerAEmail)
            ? "play"
            : settings.tileDrawMode,
      }),
      userId,
      accountEmail,
    );
    const created = await withLoading("Creating room…", async () => {
      if (remoteEnabled) {
        if (!userId) throw new Error("Sign in to create a room.");
        return remoteRooms.createRoom(
          waiting,
          userId,
          remoteRooms.emptyLiveSession(userId),
          scope,
          policy,
        );
      }
      const local = localRooms.createRoom(waiting, scope);
      return {
        id: local.id,
        meta: local.index.find((room) => room.id === local.id)!,
        game: waiting,
      };
    });
    if (!created.ok) return;
    const { value } = created;
    setRooms((current) => [value.meta, ...current.filter((room) => room.id !== value.id)]);
    setActiveRoomId(value.id);
    setActiveRoomMeta(value.meta);
    setGame(value.game);
    if (!remoteEnabled) localRooms.setActiveRoomId(value.id);
    navigate({ kind: "room", roomId: value.id });
  }

  async function joinRoomByCode(value: string) {
    setJoinError(null);
    if (remoteEnabled) {
      try {
        const joined = await remoteRooms.joinRoom(parseRemoteJoinTarget(value));
        if (await openRoom(joined.id)) return;
        setJoinError("The room was joined but could not be opened.");
        return;
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : "Unable to join this room.");
        return;
      }
    }
    let availableRooms = rooms;
    const sharedMatch = value.match(/#\/(?:room|play)\/([^/?#]+)/i);
    const sharedId = sharedMatch?.[1] ? decodeURIComponent(sharedMatch[1]) : null;
    const directId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value.trim()) ? value.trim() : null;
    let id =
      resolveRoomCode(
        value,
        availableRooms.map((room) => room.id),
      ) ??
      sharedId ??
      directId;
    if (!id && remoteEnabled && requestedScope) {
      try {
        availableRooms = await remoteRooms.listRooms(requestedScope);
        setRooms(availableRooms);
        id = resolveRoomCode(
          value,
          availableRooms.map((room) => room.id),
        );
      } catch (error) {
        setJoinError(error instanceof Error ? error.message : "Unable to look up this room.");
        return;
      }
    }
    if (!id || !(await openRoom(id, requestedScope))) {
      setJoinError("Room not found in this space, or your account does not have access.");
    }
  }

  async function openLiveRoom(id: string) {
    const target = rooms.find((room) => room.id === id);
    const role = target ? getRoomRole(target) : null;
    if (remoteEnabled && target?.joinPolicy === "open" && role?.label === "Spectator") {
      try {
        await remoteRooms.joinRoom({ gameId: id });
      } catch (error) {
        setSyncError(error instanceof Error ? error.message : "Unable to join this game.");
        return;
      }
    }
    await openRoom(id, requestedScope);
  }

  async function persistWaiting(next: GameState) {
    if (!activeRoomId) return;
    if (remoteEnabled) {
      await remoteRooms.updateRoomState({
        id: activeRoomId,
        game: next,
        session: remoteRooms.emptyLiveSession(userId),
        event: "state",
      });
    } else {
      localRooms.writeRoom(activeRoomId, next);
      const scope = currentScope();
      if (scope) setRooms(localRooms.listRooms(scope));
    }
    setGame(next);
    setActiveRoomMeta((current) =>
      current
        ? {
            ...current,
            name: next.name,
            playerA: next.players.A,
            playerB: next.players.B,
            gameMode: getGameMode(next),
            status: next.status,
            updatedAt: new Date().toISOString(),
          }
        : current,
    );
  }

  async function saveWaitingConfig(settings: NewGameSettings) {
    if (!game || !canConfigureWaiting) return;
    await withLoading("Saving configuration…", () =>
      persistWaiting(markOwnerSideReady(updateWaitingGame(game, settings), userId, accountEmail)),
    );
  }

  async function updateReady(side: Side, ready: boolean) {
    if (!game || !activeRoomId || !invitedSides.includes(side) || canConfigureWaiting) return;
    const previous = game;
    const next = { ...game, lobbyReadyBySide: { ...game.lobbyReadyBySide, [side]: ready } };
    setGame(next);
    const result = await withLoading(ready ? "Marking ready…" : "Updating status…", async () => {
      if (remoteEnabled) await remoteRooms.updateRoomReady(activeRoomId, side, ready);
      else {
        localRooms.writeRoom(activeRoomId, next);
        const scope = currentScope();
        if (scope) setRooms(localRooms.listRooms(scope));
      }
    });
    if (!result.ok) setGame(previous);
  }

  async function startRoom() {
    if (!game || !activeRoomId || !canConfigureWaiting) return;
    const waiting = requiredReadySides(
      game,
      activeRoomMeta?.ownerId ?? null,
      normalizeEmail(activeRoomMeta?.ownerEmail),
    ).filter((side) => !game.lobbyReadyBySide?.[side]);
    if (waiting.length > 0) return;
    const started = startWaitingGame(game);
    const result = await withLoading("Starting game…", () => persistWaiting(started));
    if (result.ok) navigate({ kind: "play", roomId: activeRoomId });
  }

  async function deleteRoom(id: string) {
    if (!canManageRoom(id)) return;
    const result = await withLoading("Deleting room…", async () => {
      if (remoteEnabled) await remoteRooms.deleteRoom(id);
      else localRooms.deleteRoom(id);
    });
    if (!result.ok) return;
    setRooms((current) => current.filter((room) => room.id !== id));
    if (id === activeRoomId) {
      setActiveRoomId(null);
      setActiveRoomMeta(null);
      setGame(null);
      navigate({ kind: "home", visibility: lobbyVisibility, section: "live" });
    }
  }

  async function renameRoom(id: string, name: string) {
    if (!canManageRoom(id) || !name.trim()) return;
    await withLoading("Renaming room…", async () => {
      if (remoteEnabled) {
        const payload = await remoteRooms.readRoom(id);
        if (!payload) throw new Error("Room not found.");
        await remoteRooms.updateRoomState({
          id,
          game: { ...payload.game, name: name.trim(), lastSavedAt: new Date().toISOString() },
          session: remoteRooms.emptyLiveSession(userId),
          event: "rename",
        });
        setRooms((current) =>
          current.map((room) => (room.id === id ? { ...room, name: name.trim() } : room)),
        );
      } else {
        const scope = currentScope();
        localRooms.renameRoom(id, name);
        if (scope) setRooms(localRooms.listRooms(scope));
      }
    });
  }

  async function exportRoom(id: string) {
    await withLoading("Preparing export…", async () => {
      const saved = remoteEnabled
        ? ((await remoteRooms.readRoom(id))?.game ?? null)
        : localRooms.readRoom(id);
      if (!saved) throw new Error("Room not found.");
      downloadGame(saved);
    });
  }

  function currentScope() {
    return makeRoomScope(lobbyVisibility, regionId);
  }

  function canManageRoom(id: string) {
    if (!remoteEnabled) return true;
    const room =
      rooms.find((candidate) => candidate.id === id) ??
      (activeRoomMeta?.id === id ? activeRoomMeta : null);
    return room?.canManage ?? Boolean(userId && (hasAdminAccess || room?.ownerId === userId));
  }

  function getRoomRole(room: RoomMeta) {
    const canManage = canManageRoom(room.id);
    const sides = (["A", "B"] as Side[]).filter((side) =>
      accountMatchesInvite(
        side === "A" ? room.inviteUserAId : room.inviteUserBId,
        side === "A" ? room.inviteEmailA : room.inviteEmailB,
        userId,
        accountEmail,
      ),
    );
    return {
      canManage,
      canCreate: canCreateRoom,
      label: !remoteEnabled
        ? "Local"
        : room.viewerRole
          ? room.viewerRole
          : canManage
            ? room.ownerId === userId
              ? "Owner"
              : "Admin"
            : sides.length > 0
              ? `Player ${sides.join("/")}`
              : "Spectator",
    };
  }

  async function leaveWaitingRoom() {
    if (game && activeRoomId && !canConfigureWaiting) {
      for (const side of invitedSides) {
        if (!game.lobbyReadyBySide?.[side]) continue;
        try {
          if (remoteEnabled) await remoteRooms.updateRoomReady(activeRoomId, side, false);
        } catch {
          // Navigation remains available even if presence cleanup fails.
        }
      }
    }
    navigate({ kind: "home", visibility: lobbyVisibility, section: "live" });
  }

  async function shareWaitingRoom() {
    if (!activeRoomId) return;
    const visibility = activeRoomMeta?.visibility === "region" ? "region" : "public";
    const code = activeRoomMeta?.roomCode ?? (!remoteEnabled ? formatRoomCode(activeRoomId) : null);
    const destination = code
      ? `#/${visibility}/join?code=${encodeURIComponent(code)}`
      : `#/room/${encodeURIComponent(activeRoomId)}`;
    const url = `${window.location.origin}${window.location.pathname}${window.location.search}${destination}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: game?.name ?? "EQ Lab room", url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copyText(url);
  }

  const coffeeReturn =
    coffeeRoomId && !(route.kind === "room" && route.roomId === coffeeRoomId) ? (
      <button
        className="eq-coffee-return"
        type="button"
        onClick={() => {
          navigate({ kind: "play", roomId: coffeeRoomId });
          window.localStorage.removeItem(STORAGE_KEYS.coffeeRoom);
          setCoffeeRoomId(null);
        }}
      >
        <Coffee size={18} /> Return to game
      </button>
    ) : null;

  if (route.kind === "admin") return <AdminPage section={route.section} />;
  if (route.kind === "private") {
    return <PrivateLibraryPage folderId={route.folderId} trash={route.trash} />;
  }
  if (route.kind === "profile") return <ProfilePage />;

  if (route.kind === "home") {
    return (
      <>
        <Lobby
          visibility={route.visibility}
          section={route.section ?? "live"}
          regionName={regionName}
          regionAvailable={Boolean(userId && regionId)}
          loading={roomsLoading}
          rooms={rooms}
          archives={archives}
          archivesTotal={archivesTotal}
          archivesLoading={archivesLoading}
          archivesLoadingMore={archivesLoadingMore}
          syncError={syncError}
          getRoomRole={getRoomRole}
          onOpen={(id) => void openLiveRoom(id)}
          onJoinRoom={() => navigate({ kind: "join", visibility: route.visibility })}
          onRename={(id, name) => void renameRoom(id, name)}
          onDelete={(id) => void deleteRoom(id)}
          onExport={(id) => void exportRoom(id)}
          onSaveArchive={async (gameId) => {
            await saveArchiveToPrivate(route.visibility, gameId);
          }}
          onArchivesChanged={() => setArchiveEpoch((value) => value + 1)}
          onLoadMoreArchives={() => void loadMoreArchives()}
          onChangeSection={(section) =>
            navigate({ kind: "home", visibility: route.visibility, section })
          }
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncing} />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "create") {
    return (
      <>
        <CreateRoomPage
          key={route.preset ?? "create"}
          canCreate={canCreateInScope}
          createDisabledReason={createDisabledReason}
          visibility={route.visibility}
          regionAvailable={Boolean(userId && regionId)}
          regionId={regionId}
          regionName={regionName}
          preset={route.preset}
          submitting={Boolean(foregroundLoading)}
          onBack={() => navigate({ kind: "home", visibility: "public", section: "live" })}
          onCreate={(settings, policy) => void createAndOpenRoom(settings, policy)}
        />
        <GlobalActivity
          error={syncError}
          foreground={foregroundLoading}
          syncing={backgroundSyncing}
        />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "join") {
    return (
      <>
        <JoinRoomPage
          busy={Boolean(foregroundLoading)}
          error={joinError}
          visibility={route.visibility}
          regionName={regionName}
          initialCode={route.code}
          onBack={() => navigate({ kind: "home", visibility: route.visibility, section: "live" })}
          onJoin={(value) => void joinRoomByCode(value)}
        />
        <GlobalActivity foreground={foregroundLoading} syncing={backgroundSyncing} />
        {coffeeReturn}
      </>
    );
  }

  if (route.kind === "room") {
    if (!game || !activeRoomMeta || activeRoomMeta.id !== route.roomId) {
      return (
        <ApplicationShell title="Opening waiting room">
          <div className="eq-state" role="status">
            <h2>{syncError ? "Unable to open room" : "Loading room…"}</h2>
            <p>{syncError ?? "Checking the room and your access."}</p>
            {syncError && (
              <a className="eq-button eq-button-primary" href={`#/${lobbyVisibility}`}>
                Back to rooms
              </a>
            )}
          </div>
        </ApplicationShell>
      );
    }
    return (
      <>
        <WaitingRoomPage
          busy={Boolean(foregroundLoading)}
          game={game}
          meta={activeRoomMeta}
          onBack={() => void leaveWaitingRoom()}
          onCancel={() => void deleteRoom(activeRoomMeta.id)}
          onReady={(side, ready) => void updateReady(side, ready)}
          onSaveConfig={(settings) => void saveWaitingConfig(settings)}
          onShare={shareWaitingRoom}
          onStart={() => void startRoom()}
        />
        <GlobalActivity
          error={syncError}
          foreground={foregroundLoading}
          syncing={backgroundSyncing}
        />
        {coffeeReturn}
      </>
    );
  }

  return null;
}

function scopedVisibility(route: ReturnType<typeof useRoute>): RoomVisibility | null {
  return route.kind === "home" || route.kind === "create" || route.kind === "join"
    ? route.visibility
    : null;
}

function accountMatchesInvite(
  invitedUserId: string | null | undefined,
  invitedEmail: string | null | undefined,
  userId: string | null,
  email: string | null,
) {
  if (invitedUserId) return Boolean(userId && invitedUserId === userId);
  return Boolean(email && normalizeEmail(invitedEmail) === email);
}

function markOwnerSideReady(
  game: GameState,
  ownerId: string | null,
  ownerEmail: string | null,
): GameState {
  const ready = { ...game.lobbyReadyBySide };
  for (const side of ["A", "B"] as Side[]) {
    if (
      accountMatchesInvite(
        game.playerUserIds?.[side],
        game.playerEmails?.[side],
        ownerId,
        ownerEmail,
      )
    ) {
      ready[side] = true;
    }
  }
  return { ...game, lobbyReadyBySide: ready };
}

function requiredReadySides(
  game: GameState,
  ownerId: string | null,
  ownerEmail: string | null,
): Side[] {
  return (["A", "B"] as Side[]).filter((side) => {
    if (getGameMode(game) === "solo" && side === "B") return false;
    const hasIdentity = Boolean(
      game.playerUserIds?.[side] || normalizeEmail(game.playerEmails?.[side]),
    );
    return (
      hasIdentity &&
      !accountMatchesInvite(
        game.playerUserIds?.[side],
        game.playerEmails?.[side],
        ownerId,
        ownerEmail,
      )
    );
  });
}

function downloadGame(game: GameState) {
  const blob = new Blob([JSON.stringify(game, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${game.name.replace(/[^a-z0-9]+/gi, "-") || "eq-lab"}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}
