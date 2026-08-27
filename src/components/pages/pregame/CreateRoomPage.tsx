import { useState } from "react";
import { Bot, Globe2, LockKeyhole, MapPin, Save, Sparkles, Swords, UserRound } from "lucide-react";
import { useAuth } from "../../../auth";
import type { NewGameSettings } from "../../../game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../../../constants/roomDefaults";
import { CreateRoomPanel } from "../lobby/CreateRoomPanel";
import { CheckboxControl } from "../../ui/CheckboxControl";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { useRegisteredPlayersCatalog } from "../lobby/useRegisteredPlayersCatalog";
import { BotRoomPanel } from "./BotRoomPanel";
import { PreGameShell } from "./PreGameShell";
import { navigate } from "../../../router";
import type { RoomVisibility } from "../../../roomScope";
import type { CreateRoomPolicy, JoinPolicy } from "../../../remoteRooms";

type Destination = "public" | "region" | "private";
type PlayChoice = "match" | "solo" | "aether";

export function CreateRoomPage({
  canCreate,
  createDisabledReason,
  regionAvailable,
  regionId,
  regionName,
  preset,
  submitting,
  onBack,
  onCreate,
}: {
  canCreate: boolean;
  createDisabledReason: string | null;
  visibility: RoomVisibility;
  regionAvailable: boolean;
  regionId: string | null;
  regionName: string | null;
  preset?: "solo" | "bot";
  submitting: boolean;
  onBack: () => void;
  onCreate: (settings: NewGameSettings, policy: CreateRoomPolicy) => void;
}) {
  const { userId } = useAuth();
  const [destination, setDestination] = useState<Destination | null>(null);
  const [playChoice, setPlayChoice] = useState<PlayChoice | null>(
    preset === "solo" ? "solo" : preset === "bot" ? "aether" : null,
  );
  const [privateSaved, setPrivateSaved] = useState(true);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>("invite_only");
  const effectiveVisibility: RoomVisibility = destination === "region" ? "region" : "public";
  const { error, loading, members } = useMembersCatalog(userId);
  const playerDirectory = useRegisteredPlayersCatalog(Boolean(userId), effectiveVisibility);
  const [settings, setSettings] = useState<NewGameSettings>(() =>
    preset === "solo" ? soloSettings(DEFAULT_NEW_GAME_SETTINGS) : { ...DEFAULT_NEW_GAME_SETTINGS },
  );

  function chooseDestination(next: Destination) {
    if (next === "region" && !regionAvailable) return;
    setDestination(next);
    setJoinPolicy(next === "private" ? "invite_only" : "open");
  }

  /**
   * Seed the settings for the chosen opponent once, rather than re-forcing
   * them on every render. The forced version produced the same room but left
   * the tile-draw control unable to hold a change the user made.
   */
  function choosePlayChoice(next: PlayChoice) {
    setPlayChoice(next);
    if (next === "solo") setSettings(soloSettings);
    else if (next === "match")
      setSettings((current) =>
        current.gameMode === "solo" ? { ...current, gameMode: "versus" } : current,
      );
  }

  function policy(): CreateRoomPolicy {
    const resolvedJoinPolicy = playChoice === "match" ? joinPolicy : "invite_only";
    if (destination === "region") {
      return {
        accessScope: "region",
        archivePolicy: "region",
        joinPolicy: resolvedJoinPolicy,
        regionId,
      };
    }
    if (destination === "private") {
      return {
        accessScope: "private",
        archivePolicy: privateSaved ? "private" : "none",
        joinPolicy: resolvedJoinPolicy === "open" ? "invite_only" : resolvedJoinPolicy,
        regionId: null,
      };
    }
    return {
      accessScope: "public",
      archivePolicy: "public",
      joinPolicy: resolvedJoinPolicy,
      regionId: null,
    };
  }

  if (!destination) {
    return (
      <PreGameShell
        eyebrow="Create game"
        title="Where should this game live?"
        subtitle="The destination controls who can watch live and where the finished replay is retained."
        onBack={onBack}
        variant="form"
        visual="glass"
      >
        {!canCreate && createDisabledReason && (
          <p className="info-banner">{createDisabledReason}</p>
        )}
        <div className="eq-create-choice-grid">
          <DestinationCard
            icon={<Globe2 />}
            title="Public"
            description="All approved members can watch. Finished games enter Public History."
            onClick={() => chooseDestination("public")}
            disabled={!canCreate}
          />
          <DestinationCard
            icon={<MapPin />}
            title={regionName ?? "Region"}
            description="Only your current region can watch. Finished games enter Region History."
            onClick={() => chooseDestination("region")}
            disabled={!canCreate || !regionAvailable}
            note={!regionAvailable ? "Ask an admin to assign your region" : undefined}
          />
          <DestinationCard
            icon={<LockKeyhole />}
            title="Private"
            description="Only invited players can enter. Save permanently to your library or discard on finish."
            onClick={() => chooseDestination("private")}
            disabled={!canCreate}
          />
        </div>
      </PreGameShell>
    );
  }

  if (!playChoice) {
    return (
      <PreGameShell
        eyebrow={`${destinationLabel(destination, regionName)} game`}
        title="Choose how to play"
        subtitle="Every play mode uses the same board rules and destination policy."
        onBack={() => setDestination(null)}
        visibility={effectiveVisibility}
        regionName={regionName}
        variant="form"
        visual="glass"
      >
        <div className="eq-create-choice-grid">
          <DestinationCard
            icon={<Swords />}
            title="Match"
            description="Pass & Play, direct online, or a hosted two-player match."
            onClick={() => choosePlayChoice("match")}
          />
          <DestinationCard
            icon={<UserRound />}
            title="Solo Practice"
            description="Play alone and accumulate your lifetime practice score."
            onClick={() => choosePlayChoice("solo")}
          />
          <DestinationCard
            icon={<Bot />}
            title="Aether"
            description="Play Versus against the built-in AI at your chosen difficulty."
            onClick={() => choosePlayChoice("aether")}
          />
          <DestinationCard
            icon={<Sparkles />}
            title="Study"
            description="ตั้งกระดานและเบี้ยในมือเอง แล้วให้บอทวิเคราะห์ว่าจะเล่นตาไหน"
            onClick={() => navigate({ kind: "study" })}
          />
        </div>
      </PreGameShell>
    );
  }

  const title =
    playChoice === "aether"
      ? "Play vs Aether"
      : playChoice === "solo"
        ? "Solo Practice"
        : "Configure match";
  return (
    <PreGameShell
      eyebrow={`${destinationLabel(destination, regionName)} · ${archiveLabel(destination, privateSaved)}`}
      title={title}
      subtitle="Review access and retention before creating the waiting room."
      onBack={() => setPlayChoice(null)}
      visibility={effectiveVisibility}
      regionName={regionName}
      variant="form"
      visual="glass"
    >
      {!canCreate && createDisabledReason && <p className="info-banner">{createDisabledReason}</p>}
      {error && <p className="sync-banner">{error}</p>}
      {playerDirectory.error && <p className="sync-banner">{playerDirectory.error}</p>}

      <section className="eq-create-policy" aria-labelledby="access-policy-heading">
        <div>
          <span className="eq-eyebrow">Room access</span>
          <h2 id="access-policy-heading">Join policy</h2>
        </div>
        {playChoice === "match" ? (
          <div className="eq-segmented-control" aria-label="Join policy">
            {destination !== "private" && (
              <button
                type="button"
                className={joinPolicy === "open" ? "is-active" : ""}
                aria-pressed={joinPolicy === "open"}
                onClick={() => setJoinPolicy("open")}
              >
                Open join
              </button>
            )}
            <button
              type="button"
              className={joinPolicy === "code_only" ? "is-active" : ""}
              aria-pressed={joinPolicy === "code_only"}
              onClick={() => setJoinPolicy("code_only")}
            >
              Code only
            </button>
            <button
              type="button"
              className={joinPolicy === "invite_only" ? "is-active" : ""}
              aria-pressed={joinPolicy === "invite_only"}
              onClick={() => setJoinPolicy("invite_only")}
            >
              Invite only
            </button>
          </div>
        ) : (
          <p className="eq-policy-note">
            Solo and Aether reserve every player seat. Other members can watch but cannot claim a
            side.
          </p>
        )}
        {destination === "private" && (
          <CheckboxControl
            className="eq-private-save-toggle"
            checked={privateSaved}
            ariaLabel="Save finished game to Private"
            onChange={setPrivateSaved}
          >
            <Save size={18} />
            <span>
              <strong>Save finished game to Private</strong>
              <small>
                {privateSaved
                  ? "A quota slot is reserved now."
                  : "The game is deleted permanently after finish."}
              </small>
            </span>
          </CheckboxControl>
        )}
      </section>

      <div className={submitting ? "pregame-disabled" : ""}>
        {playChoice === "aether" ? (
          <BotRoomPanel
            busy={submitting}
            onSubmit={(botSettings) => {
              if (canCreate && !submitting) onCreate(botSettings, policy());
            }}
          />
        ) : loading ? (
          <div className="pregame-card pregame-loading">Loading player directory…</div>
        ) : (
          <CreateRoomPanel
            settings={settings}
            intent={playChoice === "solo" ? "solo" : "match"}
            submitLabel={playChoice === "solo" ? "Create solo room" : undefined}
            members={members}
            registeredPlayers={playerDirectory.players}
            busy={submitting}
            onChange={setSettings}
            onSubmit={() => {
              if (!canCreate || submitting) return;
              const base = settings;
              const playerA =
                base.playerA.trim() ||
                resolveMemberLabel(base.playerAMemberId, members) ||
                "Player A";
              const playerB =
                base.gameMode === "solo"
                  ? ""
                  : base.playerB.trim() ||
                    resolveMemberLabel(base.playerBMemberId, members) ||
                    "Player B";
              const name =
                base.name.trim() ||
                (base.gameMode === "solo" ? `${playerA} · solo` : `${playerA} vs ${playerB}`);
              onCreate({ ...base, name, playerA, playerB }, policy());
            }}
          />
        )}
      </div>
    </PreGameShell>
  );
}

function DestinationCard({
  icon,
  title,
  description,
  note,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  note?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="eq-create-choice" type="button" disabled={disabled} onClick={onClick}>
      <span>{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      {note && <small>{note}</small>}
    </button>
  );
}

/** The configuration a Solo Practice room starts from. */
function soloSettings(current: NewGameSettings): NewGameSettings {
  return { ...current, gameMode: "solo", tileDrawMode: "play", startingSide: "A" };
}

function destinationLabel(destination: Destination, regionName: string | null): string {
  if (destination === "region") return regionName ?? "Region";
  return destination === "public" ? "Public" : "Private";
}

function archiveLabel(destination: Destination, privateSaved: boolean): string {
  if (destination === "public") return "Public History";
  if (destination === "region") return "Region History";
  return privateSaved ? "Auto-save" : "No log";
}

function resolveMemberLabel(
  memberId: string | null | undefined,
  members: Array<{ id: string; name: string }>,
): string | null {
  return members.find((member) => member.id === memberId)?.name ?? null;
}
