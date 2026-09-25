import {
  Check,
  Copy,
  Crown,
  Eye,
  LogOut,
  Rocket,
  Settings2,
  Share2,
  Trash2,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { playLaunchSound, unlockLaunchSound } from "./launchSound";

const SOUND_PREFERENCE = "eq-lab-launch-sound";

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
  const { configured, profile, userId } = useAuth();
  const { members } = useMembersCatalog(userId);
  const playerDirectory = useRegisteredPlayersCatalog(Boolean(userId), meta.visibility ?? "public");
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(
    () => window.localStorage.getItem(SOUND_PREFERENCE) !== "off",
  );
  const [clock, setClock] = useState(Date.now);
  const lastCue = useRef<string | null>(null);
  const [settings, setSettings] = useState<NewGameSettings>(() => settingsFromWaitingGame(game));
  const displayedCode = meta.roomCode ?? (!configured ? formatRoomCode(meta.id) : null);
  const accountEmail = normalizeEmail(profile?.email);
  const ownerEmail = normalizeEmail(meta.ownerEmail);
  const isDirectEmailRoom = isDirectOnlineGame(game, meta.ownerId, ownerEmail);
  const isOwner = !meta.ownerId || Boolean(userId && meta.ownerId === userId);
  const canManage = isDirectEmailRoom ? isOwner : isOwner || Boolean(userId && profile?.is_admin);
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
  const hostParticipant = participants.find((participant) => participant.kind === "host");
  const requiredReadySides = (["A", "B"] as Side[]).filter((side) => {
    if (getGameMode(game) === "solo" && side === "B") return false;
    if (!hasPlayerIdentity(game, side)) return false;
    return !accountMatchesSide(game, side, meta.ownerId ?? null, ownerEmail);
  });
  const waitingFor = requiredReadySides.filter((side) => !game.lobbyReadyBySide?.[side]);
  const waitingForNames = waitingFor.map((side) => game.players[side]?.trim() || `Side ${side}`);
  const startBlockedReason =
    waitingFor.length > 0 ? `Waiting for ${waitingForNames.join(" and ")} to tap Ready` : null;
  const isReady = playerSide ? Boolean(game.lobbyReadyBySide?.[playerSide]) : false;
  const launchAt = game.lobbyLaunchAt;
  const secondsLeft = launchAt
    ? Math.max(0, Math.ceil((Date.parse(launchAt) - clock) / 1000))
    : null;

  useEffect(() => {
    if (!launchAt) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [launchAt]);

  useEffect(() => {
    if (secondsLeft === null) {
      lastCue.current = null;
      return;
    }
    const cue = `${launchAt}:${secondsLeft}`;
    if (lastCue.current === cue) return;
    lastCue.current = cue;
    if (soundEnabled) playLaunchSound(secondsLeft);
  }, [launchAt, secondsLeft, soundEnabled]);

  function toggleSound() {
    if (!soundEnabled) unlockLaunchSound();
    const enabled = !soundEnabled;
    setSoundEnabled(enabled);
    window.localStorage.setItem(SOUND_PREFERENCE, enabled ? "on" : "off");
  }

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
    const code = displayedCode;
    if (!code) return;
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
      visibility={meta.visibility ?? "public"}
      regionName={profile?.region_name ?? null}
      variant="waiting"
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
      <div className="waiting-top">
        <section className="waiting-stage" aria-labelledby="waiting-stage-title">
          <div className="waiting-stage-top">
            <span className="waiting-live-tag">
              <span aria-hidden /> LAB STAGING
            </span>
            <span className="waiting-role">{role}</span>
          </div>
          <div className="waiting-stage-orbit" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <h2 id="waiting-stage-title">
            {waitingFor.length ? "Gather your crew" : "Ready to launch"}
          </h2>
          <p className="waiting-stage-status" id="waiting-room-status" role="status">
            {statusLine}
          </p>
          <div className="waiting-stage-steps" aria-hidden>
            <span className="complete">ROOM</span>
            <span className={waitingFor.length ? "" : "complete"}>READY</span>
            <span className={launchAt ? "complete" : ""}>LAUNCH</span>
          </div>
        </section>

        <section className="waiting-invite" aria-label="Invite a player">
          <div className="waiting-invite-head">
            <span>{WAITING_TEXT.roomCode}</span>
            <button
              type="button"
              className="waiting-sound"
              onClick={toggleSound}
              aria-label={soundEnabled ? "Mute launch sounds" : "Enable launch sounds"}
              title={soundEnabled ? "Mute launch sounds" : "Enable launch sounds"}
            >
              {soundEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>
          <button
            type="button"
            className="waiting-code"
            onClick={copyCode}
            disabled={!displayedCode}
            aria-label={displayedCode ? `Copy room code ${displayedCode}` : "Room code unavailable"}
          >
            <strong>{displayedCode ?? "Invite link available"}</strong>
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
          <span className="waiting-copy-feedback" role="status">
            {copied ? "Code copied" : "Tap code to copy"}
          </span>
          <button type="button" className="waiting-share" onClick={() => void onShare()}>
            <Share2 size={15} /> {WAITING_TEXT.shareLink}
          </button>
        </section>
      </div>

      <div className="waiting-grid">
        <section className="waiting-panel waiting-roster">
          <header className="waiting-panel-head">
            <div>
              <span className="waiting-panel-index">01 / CREW</span>
              <h2>{WAITING_TEXT.playersHeading}</h2>
            </div>
            <span className="waiting-player-count">
              {participants.filter((participant) => participant.side).length} slots
            </span>
          </header>
          <div className="waiting-player-list">
            {participants
              .filter((participant) => participant.kind !== "host")
              .map((participant) => (
                <div
                  className={`waiting-player ${participant.ready ? "is-ready" : ""}`}
                  key={participant.id}
                >
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
                    <span>
                      {participant.side ? `SIDE ${participant.side}` : participant.detail}
                    </span>
                  </div>
                  <span className={`participant-status ${participant.ready ? "ready" : ""}`}>
                    {participant.status}
                  </span>
                </div>
              ))}
          </div>
          {hostParticipant && (
            <p className="waiting-host-line">
              <Crown size={13} aria-hidden /> Hosted by <strong>{hostParticipant.name}</strong>
            </p>
          )}
        </section>

        <section className="waiting-panel waiting-config">
          <header className="waiting-panel-head">
            <div>
              <span className="waiting-panel-index">02 / RULES</span>
              <h2>{WAITING_TEXT.settingsHeading}</h2>
            </div>
            {canManage && (
              <button
                type="button"
                className="waiting-edit-button"
                disabled={busy || Boolean(launchAt)}
                onClick={() => {
                  setSettings(settingsFromWaitingGame(game));
                  setEditing(true);
                }}
              >
                <Settings2 size={14} /> {WAITING_TEXT.edit}
              </button>
            )}
          </header>
          {/* Same words the host just used on the Create form (design.md D7). */}
          <dl className="settings-summary">
            <SummaryRow label="Mode" value={playModeSummary(game)} />
            <SummaryRow label="Time" value={solo ? timerA : `A ${timerA} · B ${timerB}`} />
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
                  game.emailPlayersCanSeeOpponentRack
                    ? CREATE_TEXT.rackVisible
                    : CREATE_TEXT.rackHidden
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
      </div>

      <ActionDock>
        {canManage ? (
          <button
            className="waiting-primary-action"
            type="button"
            disabled={busy || Boolean(startBlockedReason) || Boolean(launchAt)}
            aria-busy={busy}
            aria-describedby="waiting-room-status"
            onClick={() => {
              if (soundEnabled) unlockLaunchSound();
              onStart();
            }}
          >
            <Rocket size={17} /> Start Lab <span aria-hidden>→</span>
          </button>
        ) : playerSide ? (
          <button
            className={isReady ? "waiting-ready-action is-ready" : "waiting-primary-action"}
            type="button"
            disabled={busy || Boolean(launchAt)}
            aria-busy={busy}
            onClick={() => {
              if (soundEnabled) unlockLaunchSound();
              onReady(playerSide, !isReady);
            }}
          >
            {isReady ? <Check size={17} /> : <Rocket size={17} />}
            {isReady ? "Ready · tap to undo" : WAITING_TEXT.imReady}
          </button>
        ) : (
          <p className="waiting-viewer-note">{WAITING_TEXT.viewerNote}</p>
        )}
      </ActionDock>

      {launchAt &&
        createPortal(
          <LaunchSequence
            secondsLeft={secondsLeft ?? 0}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
          />,
          document.body,
        )}

      <Sheet
        open={editing && canManage}
        title="Edit room settings"
        onClose={() => setEditing(false)}
      >
        <div className="eq-flow-page eq-edit-room-form">
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
        </div>
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

function LaunchSequence({
  secondsLeft,
  soundEnabled,
  onToggleSound,
}: {
  secondsLeft: number;
  soundEnabled: boolean;
  onToggleSound: () => void;
}) {
  const launching = secondsLeft === 0;
  const dialogRef = useRef<HTMLDivElement>(null);
  const soundRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const keepFocusInside = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current?.contains(document.activeElement)) return;
      event.preventDefault();
      soundRef.current?.focus();
    };
    document.addEventListener("keydown", keepFocusInside);
    return () => document.removeEventListener("keydown", keepFocusInside);
  }, []);

  return (
    <div
      ref={dialogRef}
      className="lab-launch"
      role="dialog"
      aria-modal="true"
      aria-label="Starting Lab"
      tabIndex={-1}
    >
      <div className="lab-launch-grid" aria-hidden />
      <div className="lab-launch-center">
        <span className="eq-visually-hidden" role="status" aria-live="assertive">
          {launching ? "Starting Lab" : `Lab starts in ${secondsLeft}`}
        </span>
        <span className="lab-launch-kicker">EQ LAB / INITIALIZING MATCH</span>
        <div className="lab-launch-reactor" aria-hidden>
          <span className="lab-launch-ring one" />
          <span className="lab-launch-ring two" />
          <span className="lab-launch-number" key={secondsLeft}>
            {launching ? <Rocket size={44} /> : secondsLeft}
          </span>
        </div>
        <h2>{launching ? "Starting Lab" : "Lab starts in"}</h2>
        <p>{launching ? "Opening your game…" : "Get ready to play"}</p>
        <div className="lab-launch-progress" aria-hidden>
          <span />
        </div>
        <button
          ref={soundRef}
          type="button"
          className="lab-launch-sound"
          aria-label={soundEnabled ? "Mute launch sounds" : "Enable launch sounds"}
          onClick={onToggleSound}
        >
          {soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}
          {soundEnabled ? "Sound on" : "Sound off"}
        </button>
      </div>
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
        ? WAITING_TEXT.statusReady
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
  return (["A", "B"] as Side[]).some((side) =>
    accountMatchesSide(game, side, ownerId ?? null, ownerEmail),
  );
}

function findAccountSide(
  game: GameState,
  userId: string | null,
  email: string | null,
): Side | null {
  return (
    (["A", "B"] as Side[]).find((side) => accountMatchesSide(game, side, userId, email)) ?? null
  );
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
