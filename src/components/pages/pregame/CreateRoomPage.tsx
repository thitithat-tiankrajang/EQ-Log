import { useState } from "react";
import { useAuth } from "../../../auth";
import type { NewGameSettings } from "../../../game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../../../constants/roomDefaults";
import { CreateRoomPanel } from "../lobby/CreateRoomPanel";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
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
  preset?: "solo";
  submitting: boolean;
  onBack: () => void;
  onCreate: (settings: NewGameSettings) => void;
}) {
  const { userId } = useAuth();
  const { error, loading, members } = useMembersCatalog(userId);
  const [settings, setSettings] = useState<NewGameSettings>(() =>
    preset === "solo"
      ? { ...DEFAULT_NEW_GAME_SETTINGS, gameMode: "solo", tileDrawMode: "play", startingSide: "A" }
      : { ...DEFAULT_NEW_GAME_SETTINGS },
  );

  return (
    <PreGameShell
      eyebrow="Room setup"
      title={preset === "solo" ? "Play alone" : "Create room"}
      subtitle="Configure the room before anyone enters the board."
      onBack={onBack}
    >
      {!canCreate && createDisabledReason && <p className="info-banner">{createDisabledReason}</p>}
      {error && <p className="sync-banner">{error}</p>}
      {loading ? (
        <div className="pregame-card pregame-loading">Loading player directory...</div>
      ) : (
        <div className={submitting ? "pregame-disabled" : ""}>
          <CreateRoomPanel
            settings={settings}
            members={members}
            onChange={setSettings}
            onSubmit={() => {
              if (!canCreate || submitting) return;
              onCreate({
                ...settings,
                playerA:
                  settings.playerA.trim() ||
                  resolveMemberLabel(settings.playerAMemberId, members) ||
                  "Player A",
                playerB:
                  settings.gameMode === "solo"
                    ? ""
                    : settings.playerB.trim() ||
                      resolveMemberLabel(settings.playerBMemberId, members) ||
                      "Player B",
              });
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
