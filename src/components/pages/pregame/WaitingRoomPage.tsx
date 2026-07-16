import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "../../../auth";
import {
  getGameMode,
  normalizeEmail,
  type GameState,
  type NewGameSettings,
  type Side,
} from "../../../game";
import type { RoomMeta } from "../../../rooms";
import { formatRoomCode, settingsFromWaitingGame } from "../../../pregame";
import { CreateRoomPanel } from "../lobby/CreateRoomPanel";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { PlayerList, type WaitingParticipant } from "./PlayerList";
import { PreGameShell } from "./PreGameShell";
import { RoomActions } from "./RoomActions";
import { RoomConfigCard } from "./RoomConfigCard";
import { RoomHeader } from "./RoomHeader";

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
  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<NewGameSettings>(() => settingsFromWaitingGame(game));
  const accountEmail = normalizeEmail(profile?.email);
  const ownerEmail = normalizeEmail(meta.ownerEmail);
  const canManage = !meta.ownerId || Boolean(userId && (profile?.is_admin || meta.ownerId === userId));
  const playerSide: Side | null = accountEmail
    ? normalizeEmail(game.playerEmails?.A) === accountEmail
      ? "A"
      : normalizeEmail(game.playerEmails?.B) === accountEmail
        ? "B"
        : null
    : null;
  const role = canManage ? "Host" : playerSide ? `Player · Side ${playerSide}` : "Viewer";
  const participants = useMemo(
    () => buildParticipants({ accountEmail, game, meta, ownerEmail, profileName: profile?.display_name }),
    [accountEmail, game, meta, ownerEmail, profile?.display_name],
  );
  const requiredReadySides = (["A", "B"] as Side[]).filter((side) => {
    if (getGameMode(game) === "solo" && side === "B") return false;
    const email = normalizeEmail(game.playerEmails?.[side]);
    return Boolean(email && email !== ownerEmail);
  });
  const waitingFor = requiredReadySides.filter((side) => !game.lobbyReadyBySide?.[side]);
  const startDisabledReason = waitingFor.length > 0
    ? `Waiting for Side ${waitingFor.join(" and ")} to be ready.`
    : null;
  const isReady = playerSide ? Boolean(game.lobbyReadyBySide?.[playerSide]) : false;

  async function copyCode() {
    const code = formatRoomCode(meta.id);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(code);
      return;
    }
    window.prompt("Room code", code);
  }

  return (
    <PreGameShell
      eyebrow="Waiting room"
      title="Ready to play"
      subtitle="Review the room before the host starts the game."
      onBack={onBack}
    >
      <RoomHeader
        name={game.name}
        roomCode={formatRoomCode(meta.id)}
        role={role}
        onCopyCode={copyCode}
        onShare={onShare}
      />

      {editing && canManage ? (
        <section className="waiting-edit-panel">
          <header className="waiting-edit-head">
            <div>
              <span className="pregame-eyebrow">Host controls</span>
              <h2>Edit configuration</h2>
            </div>
            <button type="button" aria-label="Close configuration" onClick={() => setEditing(false)}>
              <X size={18} />
            </button>
          </header>
          <CreateRoomPanel
            settings={settings}
            members={members}
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
        </section>
      ) : (
        <div className="waiting-grid">
          <div className="waiting-main-column">
            <PlayerList participants={participants} />
            <RoomConfigCard game={game} />
          </div>
          <RoomActions
            busy={busy}
            canManage={canManage}
            canReady={Boolean(playerSide && !canManage)}
            isReady={isReady}
            startDisabledReason={startDisabledReason}
            onCancel={onCancel}
            onEdit={() => {
              setSettings(settingsFromWaitingGame(game));
              setEditing(true);
            }}
            onLeave={onBack}
            onReady={() => {
              if (playerSide) onReady(playerSide, !isReady);
            }}
            onStart={onStart}
          />
        </div>
      )}
    </PreGameShell>
  );
}

function buildParticipants({
  accountEmail,
  game,
  meta,
  ownerEmail,
  profileName,
}: {
  accountEmail: string | null;
  game: GameState;
  meta: RoomMeta;
  ownerEmail: string | null;
  profileName: string | null | undefined;
}): WaitingParticipant[] {
  const participants: WaitingParticipant[] = [
    {
      id: `host:${meta.ownerId ?? "local"}`,
      name: meta.ownerName ?? "Local host",
      detail: "Room creator",
      kind: "host",
      status: "Host",
      ready: true,
    },
  ];
  for (const side of ["A", "B"] as Side[]) {
    if (getGameMode(game) === "solo" && side === "B") continue;
    const email = normalizeEmail(game.playerEmails?.[side]);
    const controlledByHost = !email || email === ownerEmail;
    participants.push({
      id: `player:${side}`,
      name: game.players[side] || `Player ${side}`,
      detail: email ?? (controlledByHost ? "Controlled by host" : "Assigned player"),
      kind: "player",
      side,
      status: controlledByHost ? "Host controlled" : game.lobbyReadyBySide?.[side] ? "Ready" : "Not ready",
      ready: controlledByHost || Boolean(game.lobbyReadyBySide?.[side]),
    });
  }
  const assigned = (["A", "B"] as Side[]).some(
    (side) => normalizeEmail(game.playerEmails?.[side]) === accountEmail,
  );
  if (accountEmail && accountEmail !== ownerEmail && !assigned) {
    participants.push({
      id: `viewer:${accountEmail}`,
      name: profileName ?? accountEmail,
      detail: accountEmail,
      kind: "viewer",
      status: "Viewer",
    });
  }
  return participants;
}
