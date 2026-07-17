import { Check, Copy, Crown, Eye, LogOut, Share2, Trash2, User } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../../auth";
import {
  formatSeconds,
  getGameMode,
  getTileDrawMode,
  normalizeEmail,
  type GameState,
  type NewGameSettings,
  type Side,
} from "../../../game";
import type { RoomMeta } from "../../../rooms";
import { formatRoomCode, settingsFromWaitingGame } from "../../../pregame";
import { PLAY_MODE_TEXT, TILE_DRAW_TEXT, WAITING_TEXT, CREATE_TEXT } from "../../../uiText";
import { ActionDock } from "../../ui/ActionDock";
import { OverflowMenu } from "../../ui/OverflowMenu";
import { ConfirmSheet, Sheet } from "../../ui/Sheet";
import { CreateRoomPanel } from "../lobby/CreateRoomPanel";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { useRegisteredPlayersCatalog } from "../lobby/useRegisteredPlayersCatalog";
import { PreGameShell } from "./PreGameShell";

type Participant = {
  id: string;
  name: string;
  detail: string;
  kind: "host" | "player" | "viewer";
  side?: Side;
  status: string;
  ready?: boolean;
  isYou?: boolean;
};

export function WaitingRoomPage({
  busy,
  game,
  meta,
  onBack,
  onCancel,
  onReady,
  onSaveConfig,
  onShare,
  onStart,
}: {
  busy: boolean;
  game: GameState;
  meta: RoomMeta;
  onBack: () => void;
  onCancel: () => void;
  onReady: (side: Side, ready: boolean) => void;
  onSaveConfig: (settings: NewGameSettings) => void;
  onShare: () => Promise<void>;
  onStart: () => void;
}) {
  const { profile, userId } = useAuth();
  const { members } = useMembersCatalog(userId);
  const playerDirectory = useRegisteredPlayersCatalog(Boolean(userId));
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [settings, setSettings] = useState<NewGameSettings>(() => settingsFromWaitingGame(game));
  const accountEmail = normalizeEmail(profile?.email);
  const ownerEmail = normalizeEmail(meta.ownerEmail);
  const isDirectEmailRoom = isDirectOnlineGame(game, meta.ownerId, ownerEmail);
  const isOwner = !meta.ownerId || Boolean(userId && meta.ownerId === userId);
  const canManage = isDirectEmailRoom
    ? isOwner
    : isOwner || Boolean(userId && profile?.is_admin);
  const playerSide: Side | null = findAccountSide(game, userId, accountEmail);
  const role = isDirectEmailRoom
    ? playerSide
      ? `Player · Side ${playerSide}`
      : "Viewer"
    : canManage
      ? "Host"
      : playerSide
        ? `Player · Side ${playerSide}`
        : "Viewer";
  const participants = useMemo(
    () =>
      buildParticipants({
        accountEmail,
        game,
        meta,
        ownerEmail,
        profileName: profile?.display_name,
        userId,
      }),
    [accountEmail, game, meta, ownerEmail, profile?.display_name, userId],
  );
  const requiredReadySides = (["A", "B"] as Side[]).filter((side) => {
    if (getGameMode(game) === "solo" && side === "B") return false;
    if (!hasPlayerIdentity(game, side)) return false;
    return !accountMatchesSide(game, side, meta.ownerId ?? null, ownerEmail);
  });
  const waitingFor = requiredReadySides.filter((side) => !game.lobbyReadyBySide?.[side]);
  const waitingForNames = waitingFor.map((side) => game.players[side]?.trim() || `Side ${side}`);
  const startBlockedReason =
    waitingFor.length > 0
      ? `Waiting for ${waitingForNames.join(" and ")} to tap Ready`
      : null;
  const isReady = playerSide ? Boolean(game.lobbyReadyBySide?.[playerSide]) : false;

  // One sentence that answers "what is everyone waiting on right now?"
  const statusLine =
    waitingFor.length > 0
      ? `Waiting for ${waitingForNames.join(" and ")} to be ready`
      : canManage
        ? "Everyone is ready — you can start the game"
        : isDirectEmailRoom && playerSide
          ? isReady
            ? "Waiting for the game to start"
            : "Tap Ready when you can play"
          : playerSide
            ? isReady
              ? "Waiting for the host to start the game"
              : "Tap Ready when you can play"
            : "Waiting for the host to start the game";

  async function copyCode() {
    const code = formatRoomCode(meta.id);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (http / permission denied). The code is already
      // rendered full-size on this card, so there is nothing more to show.
    }
  }

  const solo = getGameMode(game) === "solo";
  const timerA = game.timers.sideUntimed?.A
    ? "No timer"
    : formatSeconds(game.timers.initialSecondsBySide?.A ?? game.timers.A);
  const timerB = game.timers.sideUntimed?.B
    ? "No timer"
    : formatSeconds(game.timers.initialSecondsBySide?.B ?? game.timers.B);

  return (
    <PreGameShell
      eyebrow="Waiting room"
      title={game.name}
      onBack={onBack}
      actions={
        <OverflowMenu
          label="Room options"
          items={
            canManage
              ? [
                  {
                    icon: <Trash2 size={16} />,
                    label: WAITING_TEXT.deleteRoom,
                    danger: true,
                    onSelect: () => setDeleteOpen(true),
                  },
                ]
              : [
                  {
                    icon: <LogOut size={16} />,
                    label: WAITING_TEXT.leaveRoom,
                    onSelect: onBack,
                  },
                ]
          }
        />
      }
    >
      {/* Room code first: before the game starts, getting the other player in
          IS the job of this page. */}
      <section className="pregame-card code-card">
        <span className="home-eyebrow">{WAITING_TEXT.roomCode}</span>
        <button type="button" className="code-card-code" onClick={copyCode}>
          <strong>{formatRoomCode(meta.id)}</strong>
          <span className="code-card-copy">
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? WAITING_TEXT.copied : WAITING_TEXT.copyCode}
          </span>
        </button>
        <button type="button" className="ui-button-ghost" onClick={() => void onShare()}>
          <Share2 size={16} />
          {WAITING_TEXT.shareLink}
        </button>
        <span className="code-card-role">You are: {role}</span>
      </section>

      <p className="waiting-status-line" role="status">
        <span className="waiting-status-dot" aria-hidden />
        {statusLine}
      </p>

      <section className="pregame-card waiting-section">
        <header className="waiting-section-head">
          <h2>{WAITING_TEXT.playersHeading}</h2>
          <span className="pregame-count">{participants.length}</span>
        </header>
        <div className="participant-list">
          {participants.map((participant) => (
            <div className="participant-row" key={participant.id}>
              <span className={`participant-icon ${participant.kind}`} aria-hidden>
                {participant.kind === "host" ? (
                  <Crown size={17} />
                ) : participant.kind === "viewer" ? (
                  <Eye size={17} />
                ) : (
                  <User size={17} />
                )}
              </span>
              <div className="participant-copy">
                <strong>
                  {participant.name}
                  {participant.isYou && <span className="participant-you">you</span>}
                </strong>
                <span>{participant.detail}</span>
              </div>
              {participant.side && <span className="participant-side">Side {participant.side}</span>}
              <span className={`participant-status ${participant.ready ? "ready" : ""}`}>
                {participant.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="pregame-card waiting-section">
        <header className="waiting-section-head">
          <h2>{WAITING_TEXT.settingsHeading}</h2>
          {canManage && (
            <button
              type="button"
              className="waiting-edit-button"
              disabled={busy}
              onClick={() => {
                setSettings(settingsFromWaitingGame(game));
                setEditing(true);
              }}
            >
              {WAITING_TEXT.edit}
            </button>
          )}
        </header>
        {/* Same words the host just used on the Create form (design.md D7). */}
        <dl className="settings-summary">
          <SummaryRow label="Mode" value={playModeSummary(game)} />
          <SummaryRow
            label="Time"
            value={solo ? timerA : `A ${timerA} · B ${timerB}`}
          />
          <SummaryRow
            label="Tiles"
            value={
              getTileDrawMode(game) === "play"
                ? TILE_DRAW_TEXT.appDraws
                : game.emailPlayMode === "hosted"
                  ? TILE_DRAW_TEXT.hostEnters
                  : TILE_DRAW_TEXT.realTiles
            }
          />
          {!solo && (game.playerUserIds || game.playerEmails) && (
            <SummaryRow
              label="Rack"
              value={
                game.emailPlayersCanSeeOpponentRack ? CREATE_TEXT.rackVisible : CREATE_TEXT.rackHidden
              }
            />
          )}
          {!solo && (
            <SummaryRow
              label="First move"
              value={`${game.players[game.startingSide ?? "A"]?.trim() || `Side ${game.startingSide ?? "A"}`} (Side ${game.startingSide ?? "A"})`}
            />
          )}
        </dl>
      </section>

      <ActionDock reason={canManage ? startBlockedReason : null}>
        {canManage ? (
          <button
            className="ui-button-primary"
            type="button"
            disabled={busy || Boolean(startBlockedReason)}
            onClick={onStart}
          >
            {WAITING_TEXT.startGame}
          </button>
        ) : playerSide ? (
          <button
            className={isReady ? "ui-button-ghost" : "ui-button-primary"}
            type="button"
            disabled={busy}
            onClick={() => onReady(playerSide, !isReady)}
          >
            {isReady ? WAITING_TEXT.readyUndo : WAITING_TEXT.imReady}
          </button>
        ) : (
          <p className="waiting-viewer-note">{WAITING_TEXT.viewerNote}</p>
        )}
      </ActionDock>

      <Sheet open={editing && canManage} title="Edit room settings" onClose={() => setEditing(false)}>
        <CreateRoomPanel
          settings={settings}
          members={members}
          registeredPlayers={playerDirectory.players}
          busy={busy}
          submitLabel={WAITING_TEXT.saveChanges}
          onChange={setSettings}
          onSubmit={() => {
            onSaveConfig({
              ...settings,
              playerA:
                settings.playerA.trim() ||
                members.find((member) => member.id === settings.playerAMemberId)?.name ||
                "Player A",
              playerB:
                settings.gameMode === "solo"
                  ? ""
                  : settings.playerB.trim() ||
                    members.find((member) => member.id === settings.playerBMemberId)?.name ||
                    "Player B",
            });
            setEditing(false);
          }}
        />
      </Sheet>

      <ConfirmSheet
        open={deleteOpen}
        title={WAITING_TEXT.deleteRoom}
        consequence={`Delete "${game.name}"? The room and its code stop working for everyone.`}
        confirmLabel={WAITING_TEXT.deleteRoom}
        busy={busy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => {
          setDeleteOpen(false);
          onCancel();
        }}
      />
    </PreGameShell>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-summary-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function playModeSummary(game: GameState): string {
  if (getGameMode(game) === "solo") {
    return game.playerUserIds?.A || game.playerEmails?.A
      ? `${PLAY_MODE_TEXT.online} · ${PLAY_MODE_TEXT.roleHostOne.toLowerCase()}`
      : PLAY_MODE_TEXT.solo;
  }
  if (game.emailPlayMode === "direct") return `${PLAY_MODE_TEXT.online} · both players invited`;
  if (game.emailPlayMode === "hosted") return `${PLAY_MODE_TEXT.online} · run by a host`;
  return PLAY_MODE_TEXT.passPlay;
}

function buildParticipants({
  accountEmail,
  game,
  meta,
  ownerEmail,
  profileName,
  userId,
}: {
  accountEmail: string | null;
  game: GameState;
  meta: RoomMeta;
  ownerEmail: string | null;
  profileName: string | null | undefined;
  userId: string | null;
}): Participant[] {
  const isDirectEmailRoom = isDirectOnlineGame(game, meta.ownerId, ownerEmail);
  const participants: Participant[] = [];
  if (!isDirectEmailRoom) {
    participants.push({
      id: `host:${meta.ownerId ?? "local"}`,
      name: meta.ownerName ?? "Local host",
      detail: "Room creator",
      kind: "host",
      status: WAITING_TEXT.statusHost,
      ready: true,
      isYou: Boolean(userId && meta.ownerId === userId),
    });
  }
  for (const side of ["A", "B"] as Side[]) {
    if (getGameMode(game) === "solo" && side === "B") continue;
    const assignedAccount = hasPlayerIdentity(game, side);
    const controlledByHost =
      !isDirectEmailRoom &&
      (!assignedAccount || accountMatchesSide(game, side, meta.ownerId ?? null, ownerEmail));
    const ready =
      controlledByHost ||
      Boolean(game.lobbyReadyBySide?.[side]) ||
      (isDirectEmailRoom && accountMatchesSide(game, side, meta.ownerId ?? null, ownerEmail));
    participants.push({
      id: `player:${side}`,
      name: game.players[side] || `Player ${side}`,
      detail: controlledByHost ? WAITING_TEXT.statusHostBoard : "Registered player",
      kind: "player",
      side,
      status: controlledByHost
        ? WAITING_TEXT.statusHostBoard
        : ready
          ? WAITING_TEXT.statusReady
          : WAITING_TEXT.statusNotReady,
      ready,
      isYou: accountMatchesSide(game, side, userId, accountEmail),
    });
  }
  const assigned = findAccountSide(game, userId, accountEmail) !== null;
  if (userId && userId !== meta.ownerId && !assigned) {
    participants.push({
      id: `viewer:${userId}`,
      name: profileName ?? "Viewer",
      detail: "Viewer",
      kind: "viewer",
      status: "Viewer",
      isYou: true,
    });
  }
  return participants;
}

function isDirectOnlineGame(
  game: GameState,
  ownerId: string | null | undefined,
  ownerEmail: string | null,
): boolean {
  if (game.emailPlayMode === "direct") return true;
  return (["A", "B"] as Side[]).some(
    (side) => accountMatchesSide(game, side, ownerId ?? null, ownerEmail),
  );
}

function findAccountSide(
  game: GameState,
  userId: string | null,
  email: string | null,
): Side | null {
  return (["A", "B"] as Side[]).find((side) => accountMatchesSide(game, side, userId, email)) ?? null;
}

function hasPlayerIdentity(game: GameState, side: Side): boolean {
  return Boolean(game.playerUserIds?.[side] || normalizeEmail(game.playerEmails?.[side]));
}

function accountMatchesSide(
  game: GameState,
  side: Side,
  userId: string | null,
  email: string | null,
): boolean {
  const assignedUserId = game.playerUserIds?.[side];
  if (assignedUserId) return Boolean(userId && assignedUserId === userId);
  return Boolean(email && normalizeEmail(game.playerEmails?.[side]) === email);
}
