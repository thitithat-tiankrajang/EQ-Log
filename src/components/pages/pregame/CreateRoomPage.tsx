import { useState } from "react";
import { useAuth } from "../../../auth";
import type { NewGameSettings } from "../../../game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../../../constants/roomDefaults";
import { CreateRoomPanel } from "../lobby/CreateRoomPanel";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { useRegisteredPlayersCatalog } from "../lobby/useRegisteredPlayersCatalog";
import { BotRoomPanel } from "./BotRoomPanel";
import { PreGameShell } from "./PreGameShell";

export function CreateRoomPage({
  canCreate,
  createDisabledReason,
  preset,
  submitting,
  onBack,
  onCreate,
}: {
  canCreate: boolean;
  createDisabledReason: string | null;
  preset?: "solo" | "bot";
  submitting: boolean;
  onBack: () => void;
  onCreate: (settings: NewGameSettings) => void;
}) {
  const { userId } = useAuth();
  const { error, loading, members } = useMembersCatalog(userId);
  const playerDirectory = useRegisteredPlayersCatalog(Boolean(userId));
  const [settings, setSettings] = useState<NewGameSettings>(() =>
    preset === "solo"
      ? { ...DEFAULT_NEW_GAME_SETTINGS, gameMode: "solo", tileDrawMode: "play", startingSide: "A" }
      : { ...DEFAULT_NEW_GAME_SETTINGS },
  );

  if (preset === "bot") {
    return (
      <PreGameShell
        eyebrow="Room setup"
        title="Play vs BOT"
        subtitle="Face the built-in engine. Pick a strength and start immediately."
        onBack={onBack}
        visual="glass"
      >
        {!canCreate && createDisabledReason && <p className="info-banner">{createDisabledReason}</p>}
        <div className={submitting ? "pregame-disabled" : ""}>
          <BotRoomPanel
            busy={submitting}
            onSubmit={(botSettings) => {
              if (!canCreate || submitting) return;
              onCreate(botSettings);
            }}
          />
        </div>
      </PreGameShell>
    );
  }

  return (
    <PreGameShell
      eyebrow="Room setup"
      title={preset === "solo" ? "Play alone" : "Create room"}
      subtitle="Configure the room before anyone enters the board."
      onBack={onBack}
      visual="glass"
    >
      {!canCreate && createDisabledReason && <p className="info-banner">{createDisabledReason}</p>}
      {error && <p className="sync-banner">{error}</p>}
      {playerDirectory.error && <p className="sync-banner">{playerDirectory.error}</p>}
      {playerDirectory.loading && <p className="info-banner">Loading registered players...</p>}
      {loading ? (
        <div className="pregame-card pregame-loading">Loading player directory...</div>
      ) : (
        <div className={submitting ? "pregame-disabled" : ""}>
          <CreateRoomPanel
            settings={settings}
            members={members}
            registeredPlayers={playerDirectory.players}
            busy={submitting}
            onChange={setSettings}
            onSubmit={() => {
              if (!canCreate || submitting) return;
              const playerA =
                settings.playerA.trim() ||
                resolveMemberLabel(settings.playerAMemberId, members) ||
                "Player A";
              const playerB =
                settings.gameMode === "solo"
                  ? ""
                  : settings.playerB.trim() ||
                    resolveMemberLabel(settings.playerBMemberId, members) ||
                    "Player B";
              // Blank names fall back to the players — "Namfon vs Mek" makes
              // the rooms list searchable, unlike a repeated app name.
              const name =
                settings.name.trim() ||
                (settings.gameMode === "solo" ? `${playerA} · solo` : `${playerA} vs ${playerB}`);
              onCreate({ ...settings, name, playerA, playerB });
            }}
          />
        </div>
      )}
    </PreGameShell>
  );
}

function resolveMemberLabel(
  memberId: string | null | undefined,
  members: Array<{ id: string; name: string }>,
): string | null {
  return members.find((member) => member.id === memberId)?.name ?? null;
}
