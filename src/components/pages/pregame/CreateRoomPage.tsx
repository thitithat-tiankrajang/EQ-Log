import { useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Globe2,
  LockKeyhole,
  MapPin,
  Save,
  Swords,
  UserRound,
} from "lucide-react";
import { useAuth } from "../../../auth";
import type { NewGameSettings } from "../../../game";
import { DEFAULT_NEW_GAME_SETTINGS } from "../../../constants/roomDefaults";
import {
  CreateRoomPanel,
  TimerChips,
  accountUsernameOf,
  settingsForPlayMode,
} from "../lobby/CreateRoomPanel";
import { CheckboxControl } from "../../ui/CheckboxControl";
import { useMembersCatalog } from "../lobby/useMembersCatalog";
import { useRegisteredPlayersCatalog } from "../lobby/useRegisteredPlayersCatalog";
import { BotRoomPanel } from "./BotRoomPanel";
import { CreateChooser } from "./CreateChooser";
import { ArchBotRoomPanel } from "./ArchBotRoomPanel";
import { useArchBotOffer, type ArchBotOffer } from "../../../bot/archbot/availability";
import { ARCHBOT_NAME } from "../../../bot/archbot/identity";
import { PreGameShell } from "./PreGameShell";
import { navigate, type CreatePreset, type ReturnDestination } from "../../../router";
import { isEngineApiConfigured } from "../../../bot/engineApi";
import { isSupabaseConfigured } from "../../../supabaseClient";
import type { RoomVisibility } from "../../../roomScope";
import type { CreateRoomPolicy, JoinPolicy } from "../../../remoteRooms";
import { RANKED_TIME_OPTIONS } from "../../../features/ranked/rules";
import {
  initialCreateScope,
  isDirectCreateChoice,
  type CreateRoute,
  type CreateScope,
} from "../../../features/rooms/create/createChoices";
import type { CreatePlayMode } from "../../../features/rooms/create/createRoomReadiness";
import { useLocale } from "../../../i18n/LocaleProvider";
import type { MessageKey } from "../../../i18n/translate";

type Destination = CreateScope;
type PlayChoice = "match" | "solo" | "authur" | "archbot" | "ranked";

/** The opponent step each address answers in advance (none for Custom). */
function playChoiceFor(preset: CreatePreset | undefined): PlayChoice | null {
  switch (preset) {
    case "match":
    case "host":
    case "passplay":
      return "match";
    case "solo":
      return "solo";
    case "bot":
      return "authur";
    case "archbot":
      return "archbot";
    case "ranked":
      return "ranked";
    default:
      return null;
  }
}

const DIRECT_TITLES: Record<"match" | "host" | "passplay" | "solo", MessageKey> = {
  match: "create.choice.match.title",
  host: "create.choice.host.title",
  passplay: "create.choice.passplay.title",
  solo: "create.choice.solo.title",
};

export function CreateRoomPage({
  canCreate,
  createDisabledReason,
  visibility,
  returnTo,
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
  /** Where the player came from; with `visibility`, the context of the choices. */
  returnTo?: ReturnDestination;
  regionAvailable: boolean;
  regionId: string | null;
  regionName: string | null;
  preset?: CreatePreset;
  submitting: boolean;
  onBack: () => void;
  onCreate: (settings: NewGameSettings, policy: CreateRoomPolicy) => void;
  onCreateRanked: (minutes: number) => Promise<void>;
}) {
  const { profile, userId } = useAuth();
  const { t } = useLocale();
  const botServerAvailable = isSupabaseConfigured && isEngineApiConfigured;
  const context: CreateRoute = { kind: "create", visibility, ...(returnTo ? { returnTo } : {}) };
  // A Create choice opens its settings form directly, in the space the player
  // came from; Custom (and the older bot address) still asks step by step.
  const direct = isDirectCreateChoice(preset) ? preset : null;
  const startDestination: Destination | null =
    preset === "ranked" ? "public" : direct ? initialCreateScope(context, regionAvailable) : null;
  const [destination, setDestination] = useState<Destination | null>(startDestination);
  const [playChoice, setPlayChoice] = useState<PlayChoice | null>(() => playChoiceFor(preset));
  const [rankedMinutes, setRankedMinutes] = useState(15);
  const [rankedBusy, setRankedBusy] = useState(false);
  const [rankedError, setRankedError] = useState<string | null>(null);
  const [privateSaved, setPrivateSaved] = useState(true);
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(
    startDestination && startDestination !== "private" && direct ? "open" : "invite_only",
  );
  const effectiveVisibility: RoomVisibility = destination === "region" ? "region" : "public";
  const { error, loading, members } = useMembersCatalog(userId);
  const playerDirectory = useRegisteredPlayersCatalog(Boolean(userId), effectiveVisibility);
  // Seating registered players needs the online service, and a player seat
  // needs the creator's own account.
  const startPlayMode: CreatePlayMode | undefined =
    direct === "host" && isSupabaseConfigured
      ? "hosted_email"
      : direct === "match" && isSupabaseConfigured && userId
        ? "direct_email"
        : undefined;
  const [settings, setSettings] = useState<NewGameSettings>(() =>
    preset === "solo"
      ? soloSettings(DEFAULT_NEW_GAME_SETTINGS)
      : startPlayMode
        ? settingsForPlayMode(
            DEFAULT_NEW_GAME_SETTINGS,
            startPlayMode,
            userId,
            accountUsernameOf(profile),
          )
        : { ...DEFAULT_NEW_GAME_SETTINGS },
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

  if (!preset) {
    return (
      <PreGameShell
        eyebrow={t("nav.create")}
        title={t("create.title")}
        subtitle={t("create.intro")}
        onBack={onBack}
        visibility={visibility}
        regionName={regionName}
        variant="form"
        visual="glass"
      >
        {!canCreate && createDisabledReason && (
          <p className="info-banner">{createDisabledReason}</p>
        )}
        {/* Like the old in-page steps, choosing here is not a history entry of
            its own: Back from the chosen form returns to where Create began. */}
        <CreateChooser context={context} disabled={!canCreate} replace />
      </PreGameShell>
    );
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
            title={t("create.scope.public")}
            description={t("create.scope.publicHint")}
            onClick={() => chooseDestination("public")}
            disabled={!canCreate}
          />
          <DestinationCard
            icon={<MapPin />}
            title={regionName ?? t("create.scope.region")}
            description={t("create.scope.regionHint")}
            onClick={() => chooseDestination("region")}
            disabled={!canCreate || !regionAvailable}
            note={!regionAvailable ? t("create.scope.regionUnavailable") : undefined}
          />
          <DestinationCard
            icon={<LockKeyhole />}
            title={t("create.scope.private")}
            description={t("create.scope.privateHint")}
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
        </div>
      </PreGameShell>
    );
  }

  const title = direct
    ? t(DIRECT_TITLES[direct])
    : playChoice === "ranked"
      ? "Configure ranked match"
      : playChoice === "authur"
        ? "Play vs Authur"
        : playChoice === "archbot"
          ? `Play vs ${ARCHBOT_NAME}`
          : playChoice === "solo"
            ? "Solo Practice"
            : "Configure match";
  return (
    <PreGameShell
      eyebrow={
        direct
          ? t("nav.createGame")
          : `${destinationLabel(destination, regionName)} · ${archiveLabel(destination, privateSaved)}`
      }
      title={title}
      subtitle={t("create.formSubtitle")}
      onBack={() => {
        if (direct) onBack();
        else if (preset === "ranked") navigate({ kind: "ranked" });
        // ArchBot is not one of Custom's opponents: its address steps back to the space it asked for.
        else if (preset === "archbot") setDestination(null);
        else setPlayChoice(null);
      }}
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

      {direct && (
        <ScopeControl
          value={destination}
          regionAvailable={regionAvailable}
          regionName={regionName}
          onChange={chooseDestination}
        />
      )}

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
        ) : playChoice === "archbot" ? (
          <ArchBotSetup
            busy={submitting}
            onSubmit={(botSettings) => {
              if (canCreate && !submitting) onCreate(botSettings, policy());
            }}
          />
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
            initialPlayMode={startPlayMode}
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

/**
 * Who can watch a game opened straight from a Create choice. The same three
 * spaces as Custom's first step, asked where the rest of the settings are.
 */
function ScopeControl({
  value,
  regionAvailable,
  regionName,
  onChange,
}: {
  value: Destination;
  regionAvailable: boolean;
  regionName: string | null;
  onChange: (next: Destination) => void;
}) {
  const { t } = useLocale();
  const options: Array<{ value: Destination; label: string; hint: string; disabled?: boolean }> = [
    {
      value: "public",
      label: t("create.scope.public"),
      hint: t("create.scope.publicHint"),
    },
    {
      value: "region",
      label: regionName ?? t("create.scope.region"),
      hint: t("create.scope.regionHint"),
      disabled: !regionAvailable,
    },
    {
      value: "private",
      label: t("create.scope.private"),
      hint: t("create.scope.privateHint"),
    },
  ];
  const selected = options.find((option) => option.value === value);
  return (
    <section className="eq-create-policy eq-create-scope" aria-labelledby="create-scope-heading">
      <div>
        <h2 id="create-scope-heading">{t("create.scope.heading")}</h2>
      </div>
      <div className="eq-segmented-control" role="group" aria-labelledby="create-scope-heading">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={option.value === value ? "is-active" : ""}
            aria-pressed={option.value === value}
            aria-describedby={option.value === value ? "create-scope-hint" : undefined}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p id="create-scope-hint" className="eq-create-scope-hint">
        {selected?.hint}
        {!regionAvailable && <small>{t("create.scope.regionUnavailable")}</small>}
      </p>
    </section>
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

const ARCHBOT_OFFER_NOTE: Record<
  Extract<ArchBotOffer, { available: false }>["reason"],
  MessageKey
> = {
  loading: "create.archbot.checking",
  not_offered: "create.archbot.unavailable",
  unsupported: "create.archbot.unsupported",
  catalog_error: "create.archbot.failed",
};

/**
 * ArchBot's setup, offered only while the bot catalogue opens it and this
 * browser can run it (see `availability.ts`); otherwise it says why. The
 * catalogue is read here, so the rest of Create never asks for it.
 */
function ArchBotSetup({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (settings: NewGameSettings) => void;
}) {
  const { t } = useLocale();
  const offer = useArchBotOffer();
  if (!offer.available) {
    return (
      <p className="info-banner">{t(ARCHBOT_OFFER_NOTE[offer.reason], { bot: ARCHBOT_NAME })}</p>
    );
  }
  return <ArchBotRoomPanel busy={busy} onSubmit={onSubmit} />;
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
