import { useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Globe2,
  LockKeyhole,
  MapPin,
  Save,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
} from "lucide-react";
import { useAuth } from "../../../auth";
import type { NewGameSettings } from "../../../game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../../../constants/roomDefaults";
import { CreateRoomPanel, TimerChips } from "../lobby/CreateRoomPanel";
import { CheckboxControl } from "../../ui/CheckboxControl";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { useRegisteredPlayersCatalog } from "../lobby/useRegisteredPlayersCatalog";
import { BotRoomPanel } from "./BotRoomPanel";
import { PreGameShell } from "./PreGameShell";
import { navigate } from "../../../router";
import { isEngineApiConfigured } from "../../../bot/engineApi";
import { isSupabaseConfigured } from "../../../supabaseClient";
import type { RoomVisibility } from "../../../roomScope";
import type { CreateRoomPolicy, JoinPolicy } from "../../../remoteRooms";
import { RANKED_TIME_OPTIONS } from "../../../features/ranked/rules";

type Destination = "public" | "region" | "private";
type PlayChoice = "match" | "solo" | "authur" | "ranked";

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
  onCreateRanked,
}: {
  canCreate: boolean;
  createDisabledReason: string | null;
  visibility: RoomVisibility;
  regionAvailable: boolean;
  regionId: string | null;
  regionName: string | null;
  preset?: "solo" | "bot" | "ranked";
  submitting: boolean;
  onBack: () => void;
  onCreate: (settings: NewGameSettings, policy: CreateRoomPolicy) => void;
  onCreateRanked: (minutes: number) => Promise<void>;
}) {
  const { userId } = useAuth();
  const botServerAvailable = isSupabaseConfigured && isEngineApiConfigured;
  const [destination, setDestination] = useState<Destination | null>(
    preset === "ranked" ? "public" : null,
  );
  const [playChoice, setPlayChoice] = useState<PlayChoice | null>(
    preset === "solo"
      ? "solo"
      : preset === "bot"
        ? "authur"
        : preset === "ranked"
          ? "ranked"
          : null,
  );
  const [rankedMinutes, setRankedMinutes] = useState(15);
  const [rankedBusy, setRankedBusy] = useState(false);
  const [rankedError, setRankedError] = useState<string | null>(null);
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
        title="Choose a space"
        subtitle="Who can see your game?"
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
            description="Approved members can watch. Replays go to History."
            onClick={() => chooseDestination("public")}
            disabled={!canCreate}
          />
          <DestinationCard
            icon={<MapPin />}
            title={regionName ?? "Region"}
            description="Your region can watch. Replays stay there."
            onClick={() => chooseDestination("region")}
            disabled={!canCreate || !regionAvailable}
            note={!regionAvailable ? "Ask an admin to assign your region" : undefined}
          />
          <DestinationCard
            icon={<LockKeyhole />}
            title="Private"
            description="Invite only. Save or discard when done."
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
        subtitle="Pick your opponent"
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
            description="Challenge a friend or play together."
            onClick={() => choosePlayChoice("match")}
          />
          <DestinationCard
            icon={<UserRound />}
            title="Solo Practice"
            description="Practice and build your score."
            onClick={() => choosePlayChoice("solo")}
          />
          <DestinationCard
            icon={<Bot />}
            title="Authur"
            description="Challenge Authur on the server."
            disabled={!botServerAvailable}
            note={!botServerAvailable ? "ต้องเชื่อมต่อเซิร์ฟเวอร์เกมก่อน" : undefined}
            onClick={() => choosePlayChoice("authur")}
          />
          <DestinationCard
            icon={<Sparkles />}
            title="Study"
            description="ตั้งกระดานและเบี้ยในมือเอง แล้วให้บอทวิเคราะห์ว่าจะเล่นตาไหน"
            onClick={() => navigate({ kind: "study" })}
          />
          {destination === "public" && (
            <DestinationCard
              icon={<Trophy />}
              title="Ranked"
              description="สร้างห้องจัดอันดับแบบเปิด รอผู้เล่นคนใดก็ได้"
              disabled={!isSupabaseConfigured || !userId}
              onClick={() => choosePlayChoice("ranked")}
            />
          )}
          <DestinationCard
            icon={<Trophy />}
            title="Survival"
            description="เล่นต่อจากสถานการณ์ที่กำหนดจนเอาชนะ Authur"
            disabled={!botServerAvailable}
            note={!botServerAvailable ? "ต้องเชื่อมต่อเซิร์ฟเวอร์เกมก่อน" : undefined}
            onClick={() => navigate({ kind: "survival" })}
          />
        </div>
      </PreGameShell>
    );
  }

  const title =
    playChoice === "ranked"
      ? "Configure ranked match"
      : playChoice === "authur"
        ? "Play vs Authur"
        : playChoice === "solo"
          ? "Solo Practice"
          : "Configure match";
  return (
    <PreGameShell
      eyebrow={`${destinationLabel(destination, regionName)} · ${archiveLabel(destination, privateSaved)}`}
      title={title}
      subtitle="Set up your game."
      onBack={() => (preset === "ranked" ? navigate({ kind: "ranked" }) : setPlayChoice(null))}
      visibility={effectiveVisibility}
      regionName={regionName}
      variant="form"
      visual="glass"
    >
      {!canCreate && createDisabledReason && <p className="info-banner">{createDisabledReason}</p>}
      {error && <p className="sync-banner">{error}</p>}
      {rankedError && (
        <p className="sync-banner" role="alert">
          {rankedError}
        </p>
      )}
      {playerDirectory.error && <p className="sync-banner">{playerDirectory.error}</p>}

      {(playChoice === "match" || destination === "private") && (
        <section className="eq-create-policy" aria-labelledby="access-policy-heading">
          <div>
            <span className="eq-eyebrow">
              {playChoice === "match" ? "Room access" : "Private game"}
            </span>
            <h2 id="access-policy-heading">
              {playChoice === "match" ? "Join policy" : "Save replay"}
            </h2>
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
          ) : null}
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
      )}

      <div className={submitting ? "pregame-disabled" : ""}>
        {playChoice === "ranked" ? (
          <section className="create-form" aria-label="Ranked room setup">
            <div className="create-section">
              <h3 className="create-section-title">
                <span aria-hidden="true">1</span>เวลาแข่งขันต่อฝ่าย
              </h3>
              <TimerChips
                value={rankedMinutes}
                options={RANKED_TIME_OPTIONS}
                onSelect={(value) => {
                  if (value !== null) setRankedMinutes(value);
                }}
              />
              <p>กติกาแข่งและการปิดเบี้ยถูกกำหนดไว้แล้ว ผู้เล่นที่ได้รับอนุมัติคนใดก็ได้เข้าร่วม</p>
            </div>
            <div className="action-dock">
              <div className="action-dock-buttons">
                <button
                  className="eq-button eq-button-primary"
                  type="button"
                  disabled={!canCreate || rankedBusy}
                  onClick={() => {
                    setRankedBusy(true);
                    setRankedError(null);
                    void onCreateRanked(rankedMinutes)
                      .catch((cause) => {
                        setRankedError(
                          cause instanceof Error ? cause.message : "สร้างห้องจัดอันดับไม่สำเร็จ",
                        );
                      })
                      .finally(() => setRankedBusy(false));
                  }}
                >
                  {rankedBusy ? "กำลังสร้างห้อง…" : "สร้างห้องจัดอันดับ"}
                </button>
              </div>
            </div>
          </section>
        ) : playChoice === "authur" ? (
          <>
            {!botServerAvailable && (
              <p className="info-banner">ต้องเชื่อมต่อเซิร์ฟเวอร์เกมก่อนเล่นกับ Authur</p>
            )}
            <BotRoomPanel
              engine={playChoice}
              busy={submitting || !botServerAvailable}
              onSubmit={(botSettings) => {
                if (canCreate && !submitting && botServerAvailable) onCreate(botSettings, policy());
              }}
            />
          </>
        ) : loading ? (
          <div className="pregame-card eq-skeleton-list" role="status" aria-label="Loading players">
            <span />
            <span />
          </div>
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
      <span className="eq-choice-icon">{icon}</span>
      <span className="eq-choice-copy">
        <strong>{title}</strong>
        <span>{description}</span>
        {note && <small>{note}</small>}
      </span>
      <ArrowUpRight className="eq-choice-arrow" size={18} aria-hidden="true" />
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
