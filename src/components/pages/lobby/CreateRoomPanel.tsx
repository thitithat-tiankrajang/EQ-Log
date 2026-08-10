import { ArrowLeftRight, Globe, Play, User, UserCog, Users } from "lucide-react";
import { useState } from "react";
import { type NewGameSettings, type Side, type TileDrawMode } from "../../../game";
import type { Member } from "../../../members";
import type { RegisteredPlayer } from "../../../profiles";
import { DEFAULT_TIMER_MINUTES, TIMER_MINUTE_OPTIONS } from "../../../constants/gameRules";
import { isSupabaseConfigured } from "../../../supabaseClient";
import { useAuth } from "../../../auth";
import { ActionDock } from "../../ui/ActionDock";
import { ChoiceCardGroup } from "../../ui/ChoiceCardGroup";
import { CheckboxControl } from "../../ui/CheckboxControl";
import { FieldRow } from "../../ui/FieldRow";
import { SelectControl } from "../../ui/SelectControl";
import { CREATE_TEXT, PLAY_MODE_TEXT, TILE_DRAW_TEXT, TIMER_TEXT } from "../../../uiText";
import {
  getCreateRoomReadiness,
  type CreatePlayMode,
} from "../../../features/rooms/create/createRoomReadiness";

type PlayMode = CreatePlayMode;
type WhoPlays = "pass_play" | "solo" | "online";
type OnlineRole = "direct_email" | "hosted_email" | "hosted_solo";

function playModeFromSettings(settings: NewGameSettings): PlayMode {
  const hasOnlinePlayer = Boolean(
    settings.playerAUserId ||
    settings.playerBUserId ||
    settings.playerAEmail ||
    settings.playerBEmail,
  );
  if (settings.gameMode === "solo") return hasOnlinePlayer ? "hosted_solo" : "solo";
  if (hasOnlinePlayer) {
    return settings.emailPlayMode === "direct" ? "direct_email" : "hosted_email";
  }
  return "hotseat";
}

export function CreateRoomPanel({
  settings,
  members,
  registeredPlayers,
  busy = false,
  submitLabel,
  onChange,
  onSubmit,
}: {
  settings: NewGameSettings;
  members: Member[];
  registeredPlayers: RegisteredPlayer[];
  busy?: boolean;
  submitLabel?: string;
  onChange: (next: NewGameSettings) => void;
  onSubmit: () => void;
}) {
  const { profile, userId } = useAuth();
  const accountUsername = profile?.display_name?.trim() || "Your account";
  const accountPlayers = mergeAccountPlayer(registeredPlayers, userId, accountUsername);
  const [playMode, setPlayModeState] = useState<PlayMode>(() => playModeFromSettings(settings));
  const [lastOnlineRole, setLastOnlineRole] = useState<OnlineRole>(
    playMode === "hosted_email" || playMode === "hosted_solo" ? playMode : "direct_email",
  );
  const [perSideTimers, setPerSideTimers] = useState<boolean>(
    () =>
      timerValueOf(settings, "A") !== timerValueOf(settings, "B") && settings.gameMode !== "solo",
  );

  const whoPlays: WhoPlays =
    playMode === "hotseat" ? "pass_play" : playMode === "solo" ? "solo" : "online";
  const onlineRole: OnlineRole | null = whoPlays === "online" ? (playMode as OnlineRole) : null;
  const isSolo = playMode === "solo" || playMode === "hosted_solo";
  const isHostedSolo = playMode === "hosted_solo";
  const drawModeLocked = playMode === "solo" || playMode === "direct_email";

  function timerValue(side: Side): number | null {
    return timerValueOf(settings, side);
  }

  function setTimerBoth(value: number | null) {
    const timerMinutes = { A: value, B: value } as Record<Side, number | null>;
    onChange({
      ...settings,
      minutes: value ?? settings.minutes ?? DEFAULT_TIMER_MINUTES,
      timerMinutes,
      untimed: value === null,
    });
  }

  function setTimerValue(side: Side, minutes: number | null) {
    const timerMinutes = {
      A: timerValue("A"),
      B: timerValue("B"),
      [side]: minutes,
    } as Record<Side, number | null>;
    onChange({
      ...settings,
      minutes: timerMinutes.A ?? timerMinutes.B ?? settings.minutes ?? DEFAULT_TIMER_MINUTES,
      timerMinutes,
      untimed: isSolo
        ? timerMinutes.A === null
        : timerMinutes.A === null && timerMinutes.B === null,
    });
  }

  function setPlayMode(mode: PlayMode) {
    if (mode !== "hotseat" && mode !== "solo" && !isSupabaseConfigured) return;
    setPlayModeState(mode);
    if (mode === "hosted_email" || mode === "hosted_solo" || mode === "direct_email") {
      setLastOnlineRole(mode);
    }
    if (mode === "hotseat" || mode === "solo") {
      onChange({
        ...settings,
        gameMode: mode === "solo" ? "solo" : "versus",
        playerB: mode === "solo" ? "" : settings.playerB,
        playerBMemberId: mode === "solo" ? null : settings.playerBMemberId,
        playerAUserId: null,
        playerBUserId: null,
        playerAEmail: null,
        playerBEmail: null,
        emailPlayMode: undefined,
        startingSide: mode === "solo" ? "A" : settings.startingSide,
        tileDrawMode: mode === "solo" ? "play" : settings.tileDrawMode,
      });
      return;
    }
    const playerAUserId = settings.playerAUserId?.trim() || null;
    const playerBUserId = settings.playerBUserId?.trim() || null;
    if (mode === "hosted_solo") {
      const creatorWasA = Boolean(userId && playerAUserId === userId);
      onChange({
        ...settings,
        playerA: creatorWasA ? "" : settings.playerA,
        playerB: "",
        playerAMemberId: creatorWasA ? null : settings.playerAMemberId,
        playerBMemberId: null,
        playerAUserId: creatorWasA ? null : playerAUserId,
        playerBUserId: null,
        playerAEmail: null,
        playerBEmail: null,
        gameMode: "solo",
        emailPlayMode: "hosted",
        startingSide: "A",
      });
      return;
    }
    if (mode === "hosted_email") {
      const creatorWasA = Boolean(userId && playerAUserId === userId);
      const creatorWasB = Boolean(userId && playerBUserId === userId);
      onChange({
        ...settings,
        playerA: creatorWasA ? "" : settings.playerA,
        playerB: creatorWasB ? "" : settings.playerB,
        playerAMemberId: creatorWasA ? null : settings.playerAMemberId,
        playerBMemberId: creatorWasB ? null : settings.playerBMemberId,
        playerAUserId: creatorWasA ? null : playerAUserId,
        playerBUserId: creatorWasB ? null : playerBUserId,
        playerAEmail: null,
        playerBEmail: null,
        gameMode: "versus",
        emailPlayMode: "hosted",
      });
      return;
    }
    const side: Side =
      playerBUserId === userId
        ? "B"
        : playerAUserId === userId
          ? "A"
          : playerAUserId && !playerBUserId
            ? "B"
            : "A";
    const creatorAlreadyAssigned = playerAUserId === userId || playerBUserId === userId;
    const opponentUserId = (side === "A" ? playerBUserId : playerAUserId) ?? null;
    onChange({
      ...settings,
      playerA: side === "A" && !creatorAlreadyAssigned ? accountUsername : settings.playerA,
      playerB: side === "B" && !creatorAlreadyAssigned ? accountUsername : settings.playerB,
      playerAMemberId: side === "A" && !creatorAlreadyAssigned ? null : settings.playerAMemberId,
      playerBMemberId: side === "B" && !creatorAlreadyAssigned ? null : settings.playerBMemberId,
      playerAUserId: side === "A" ? userId : opponentUserId,
      playerBUserId: side === "B" ? userId : opponentUserId,
      playerAEmail: null,
      playerBEmail: null,
      gameMode: "versus",
      emailPlayMode: "direct",
      tileDrawMode: "play",
    });
  }

  const usesOnlinePlay =
    playMode === "hosted_email" || playMode === "hosted_solo" || playMode === "direct_email";
  const isDirectOnline = playMode === "direct_email";
  const playerAUserId = settings.playerAUserId?.trim() || null;
  const playerBUserId = settings.playerBUserId?.trim() || null;
  const playerAInvalid = usesOnlinePlay && !playerAUserId;
  const playerBInvalid = usesOnlinePlay && !isSolo && !playerBUserId;
  const playerDuplicate = Boolean(playerAUserId) && playerAUserId === playerBUserId;
  const creatorSide: Side = userId && playerBUserId === userId ? "B" : "A";
  const playerAIsHost =
    (playMode === "hosted_email" || playMode === "hosted_solo") && playerAUserId === userId;
  const playerBIsHost = playMode === "hosted_email" && playerBUserId === userId;
  const readiness = getCreateRoomReadiness({ mode: playMode, settings, userId });
  const submitBlocked = !readiness.ready;
  const blockedReason = readiness.reason;

  function setCreatorSide(side: Side) {
    if (!userId || side === creatorSide) return;
    const opponentUserId = [playerAUserId, playerBUserId].find((id) => id && id !== userId) ?? null;
    onChange({
      ...settings,
      playerA: settings.playerB,
      playerB: settings.playerA,
      playerAMemberId: settings.playerBMemberId,
      playerBMemberId: settings.playerAMemberId,
      playerAUserId: side === "A" ? userId : opponentUserId,
      playerBUserId: side === "B" ? userId : opponentUserId,
      playerAEmail: null,
      playerBEmail: null,
    });
  }

  const startingSide: Side = settings.startingSide ?? "A";
  const otherStartingSide: Side = startingSide === "A" ? "B" : "A";
  const tileDrawMode: TileDrawMode = settings.tileDrawMode ?? "manual";
  const manualLabel = usesOnlinePlay ? TILE_DRAW_TEXT.hostEnters : TILE_DRAW_TEXT.realTiles;
  const manualDesc = usesOnlinePlay ? TILE_DRAW_TEXT.hostEntersDesc : TILE_DRAW_TEXT.realTilesDesc;
  const tileDrawSummary = tileDrawMode === "play" ? TILE_DRAW_TEXT.appDraws : manualLabel;
  const showRackVisibility = usesOnlinePlay && !isSolo;
  const defaultRoomName = buildDefaultRoomName(settings, isSolo);

  const submitText = busy
    ? CREATE_TEXT.submitBusy
    : (submitLabel ?? (usesOnlinePlay ? CREATE_TEXT.submitOnline : CREATE_TEXT.submit));

  function playerOptionsFor(side: Side): RegisteredPlayer[] {
    const selectedId = side === "A" ? playerAUserId : playerBUserId;
    const otherId = side === "A" ? playerBUserId : playerAUserId;
    const hostMustStaySeparate = playMode === "hosted_email" || playMode === "hosted_solo";
    return accountPlayers.filter(
      (player) =>
        player.id === selectedId ||
        (player.id !== otherId && (!hostMustStaySeparate || player.id !== userId)),
    );
  }

  function assignRegisteredPlayer(side: Side, id: string | null) {
    const selected = accountPlayers.find((player) => player.id === id);
    if (side === "A") {
      onChange({
        ...settings,
        playerAUserId: id,
        playerAEmail: null,
        playerAMemberId: null,
        playerA: selected?.username ?? "",
      });
      return;
    }
    onChange({
      ...settings,
      playerBUserId: id,
      playerBEmail: null,
      playerBMemberId: null,
      playerB: selected?.username ?? "",
    });
  }

  return (
    <section className="create-form" aria-label="Room setup">
      {/* 1 · Who is playing? */}
      <div className="create-section">
        <h3 className="create-section-title">
          <span>1</span>
          {PLAY_MODE_TEXT.question}
        </h3>
        <ChoiceCardGroup<WhoPlays>
          label={PLAY_MODE_TEXT.question}
          value={whoPlays}
          choices={[
            {
              value: "pass_play",
              icon: <Users size={17} />,
              label: PLAY_MODE_TEXT.passPlay,
              description: PLAY_MODE_TEXT.passPlayDesc,
            },
            {
              value: "solo",
              icon: <User size={17} />,
              label: PLAY_MODE_TEXT.solo,
              description: PLAY_MODE_TEXT.soloDesc,
            },
            {
              value: "online",
              icon: <Globe size={17} />,
              label: PLAY_MODE_TEXT.online,
              description: PLAY_MODE_TEXT.onlineDesc,
              disabled: !isSupabaseConfigured,
              disabledReason: PLAY_MODE_TEXT.onlineNeedsSetup,
            },
          ]}
          onChange={(who) => {
            if (who === "pass_play") setPlayMode("hotseat");
            else if (who === "solo") setPlayMode("solo");
            else setPlayMode(lastOnlineRole);
          }}
        />
        {whoPlays === "online" && (
          <div className="create-subquestion">
            <h4 className="create-subquestion-title">{PLAY_MODE_TEXT.roleQuestion}</h4>
            <ChoiceCardGroup<OnlineRole>
              label={PLAY_MODE_TEXT.roleQuestion}
              value={onlineRole}
              choices={[
                {
                  value: "direct_email",
                  icon: <Play size={17} />,
                  label: PLAY_MODE_TEXT.rolePlayer,
                  description: PLAY_MODE_TEXT.rolePlayerDesc,
                },
                {
                  value: "hosted_email",
                  icon: <UserCog size={17} />,
                  label: PLAY_MODE_TEXT.roleHostTwo,
                  description: PLAY_MODE_TEXT.roleHostTwoDesc,
                },
                {
                  value: "hosted_solo",
                  icon: <UserCog size={17} />,
                  label: PLAY_MODE_TEXT.roleHostOne,
                  description: PLAY_MODE_TEXT.roleHostOneDesc,
                },
              ]}
              onChange={(role) => setPlayMode(role)}
            />
          </div>
        )}
        {isDirectOnline && (
          <div className="create-subquestion">
            <h4 className="create-subquestion-title">You play</h4>
            <div className="create-segment">
              {(["A", "B"] as Side[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={creatorSide === side ? "active" : ""}
                  onClick={() => setCreatorSide(side)}
                >
                  Side {side}
                </button>
              ))}
            </div>
            <p className="create-signed-in">Signed in as {accountUsername}</p>
          </div>
        )}
      </div>

      {/* 2 · Players */}
      <div className="create-section">
        <h3 className="create-section-title">
          <span>2</span>
          {CREATE_TEXT.playersHeading}
        </h3>
        <SidePlayerCard
          side="A"
          heading={isHostedSolo ? "Solo player" : "Side A"}
          members={members}
          name={settings.playerA}
          selectedId={settings.playerAMemberId ?? null}
          accountId={playerAUserId}
          accountOptions={playerOptionsFor("A")}
          showRegisteredAccount={usesOnlinePlay}
          accountInvalid={playerAInvalid || playerDuplicate || playerAIsHost}
          accountError={
            playerDuplicate
              ? "Side A and Side B must use different registered accounts."
              : playerAIsHost
                ? isHostedSolo
                  ? "The host account cannot also be the solo player."
                  : "The host account cannot also be Side A."
                : !playerAUserId
                  ? isHostedSolo
                    ? "Choose the registered user who will play solo."
                    : "Choose the registered user for this side."
                  : undefined
          }
          accountLocked={isDirectOnline && creatorSide === "A"}
          accountLabel={
            isDirectOnline
              ? creatorSide === "A"
                ? "Your account"
                : "Opponent username"
              : isHostedSolo
                ? "Solo player username"
                : "Player username"
          }
          isYou={isDirectOnline && creatorSide === "A"}
          playsFirst={!isSolo && startingSide === "A"}
          onNameChange={(value) => onChange({ ...settings, playerA: value })}
          onMemberChange={(id) => {
            const member = members.find((entry) => entry.id === id);
            onChange({
              ...settings,
              playerAMemberId: id,
              playerA: member ? member.name : settings.playerA,
            });
          }}
          onAccountChange={(id) => assignRegisteredPlayer("A", id)}
        />
        {!isSolo && (
          <SidePlayerCard
            side="B"
            heading="Side B"
            members={members}
            name={settings.playerB}
            selectedId={settings.playerBMemberId ?? null}
            accountId={playerBUserId}
            accountOptions={playerOptionsFor("B")}
            showRegisteredAccount={usesOnlinePlay}
            accountInvalid={playerBInvalid || playerDuplicate || playerBIsHost}
            accountError={
              playerDuplicate
                ? "Side A and Side B must use different registered accounts."
                : playerBIsHost
                  ? "The host account cannot also be Side B."
                  : !playerBUserId
                    ? "Choose the registered user for this side."
                    : undefined
            }
            accountLocked={isDirectOnline && creatorSide === "B"}
            accountLabel={
              isDirectOnline
                ? creatorSide === "B"
                  ? "Your account"
                  : "Opponent username"
                : "Player username"
            }
            isYou={isDirectOnline && creatorSide === "B"}
            playsFirst={startingSide === "B"}
            onNameChange={(value) => onChange({ ...settings, playerB: value })}
            onMemberChange={(id) => {
              const member = members.find((entry) => entry.id === id);
              onChange({
                ...settings,
                playerBMemberId: id,
                playerB: member ? member.name : settings.playerB,
              });
            }}
            onAccountChange={(id) => assignRegisteredPlayer("B", id)}
          />
        )}
        {!isSolo && (
          <button
            type="button"
            className="create-swap-first"
            onClick={() => onChange({ ...settings, startingSide: otherStartingSide })}
          >
            <ArrowLeftRight size={15} />
            {CREATE_TEXT.swapFirst(otherStartingSide)}
          </button>
        )}
      </div>

      {/* 3 · Time per side */}
      <div className="create-section">
        <h3 className="create-section-title">
          <span>3</span>
          {isHostedSolo ? "Solo player timer" : isSolo ? "Your timer" : TIMER_TEXT.label}
        </h3>
        {!perSideTimers || isSolo ? (
          <TimerChips
            value={timerValue("A")}
            onSelect={(minutes) => (isSolo ? setTimerValue("A", minutes) : setTimerBoth(minutes))}
          />
        ) : (
          (["A", "B"] as Side[]).map((side) => (
            <div key={side} className="timer-side-row">
              <span className="timer-side-label">Side {side}</span>
              <TimerChips
                value={timerValue(side)}
                onSelect={(minutes) => setTimerValue(side, minutes)}
              />
            </div>
          ))
        )}
        {!isSolo && (
          <CheckboxControl
            className="timer-per-side-toggle"
            checked={perSideTimers}
            ariaLabel={TIMER_TEXT.perSide}
            onChange={(checked) => {
              setPerSideTimers(checked);
              if (!checked) setTimerBoth(timerValue("A"));
            }}
          >
            {TIMER_TEXT.perSide}
          </CheckboxControl>
        )}
      </div>

      {/* Advanced — header always shows current values, so the closed state
          is a summary, not a black box (design.md D5). */}
      <details className="create-advanced">
        <summary>
          <span className="create-advanced-title">
            {CREATE_TEXT.advancedHeading}
            <em>{CREATE_TEXT.advancedNote}</em>
          </span>
          <span className="create-advanced-values">
            <span>
              {CREATE_TEXT.roomNameLabel} · {settings.name.trim() || defaultRoomName}
            </span>
            <span>
              {TILE_DRAW_TEXT.label} · {tileDrawSummary}
            </span>
            {showRackVisibility && (
              <span>
                {CREATE_TEXT.opponentRack} ·{" "}
                {settings.emailPlayersCanSeeOpponentRack
                  ? CREATE_TEXT.rackVisible
                  : CREATE_TEXT.rackHidden}
              </span>
            )}
          </span>
        </summary>
        <div className="create-advanced-body">
          <FieldRow
            controlId="create-room-name"
            label={CREATE_TEXT.roomNameLabel}
            hint="Shown in the rooms list — named after the players by default."
          >
            <input
              id="create-room-name"
              aria-describedby="create-room-name-message"
              value={settings.name}
              placeholder={defaultRoomName}
              onChange={(event) => onChange({ ...settings, name: event.target.value })}
            />
          </FieldRow>
          <div className="create-advanced-group">
            <span className="field-row-label">{TILE_DRAW_TEXT.label}</span>
            {drawModeLocked ? (
              <p className="create-locked-note">
                {TILE_DRAW_TEXT.appDraws} — {TILE_DRAW_TEXT.setByMode.toLowerCase()}
              </p>
            ) : (
              <ChoiceCardGroup<TileDrawMode>
                label={TILE_DRAW_TEXT.label}
                value={tileDrawMode}
                choices={[
                  {
                    value: "play",
                    label: TILE_DRAW_TEXT.appDraws,
                    description: TILE_DRAW_TEXT.appDrawsDesc,
                  },
                  {
                    value: "manual",
                    label: manualLabel,
                    description: manualDesc,
                  },
                ]}
                onChange={(mode) => onChange({ ...settings, tileDrawMode: mode })}
              />
            )}
          </div>
          {showRackVisibility && (
            <div className="create-advanced-group">
              <span className="field-row-label">{CREATE_TEXT.opponentRack}</span>
              <ChoiceCardGroup<"hidden" | "visible">
                label={CREATE_TEXT.opponentRack}
                value={settings.emailPlayersCanSeeOpponentRack ? "visible" : "hidden"}
                choices={[
                  {
                    value: "hidden",
                    label: CREATE_TEXT.rackHidden,
                    description: CREATE_TEXT.rackHiddenDesc,
                  },
                  {
                    value: "visible",
                    label: CREATE_TEXT.rackVisible,
                    description: CREATE_TEXT.rackVisibleDesc,
                  },
                ]}
                onChange={(value) =>
                  onChange({ ...settings, emailPlayersCanSeeOpponentRack: value === "visible" })
                }
              />
            </div>
          )}
        </div>
      </details>

      <ActionDock reason={blockedReason}>
        <button
          className="ui-button-primary"
          type="button"
          disabled={submitBlocked || busy}
          onClick={onSubmit}
        >
          <Play size={16} />
          {submitText}
        </button>
      </ActionDock>
    </section>
  );
}

function timerValueOf(settings: NewGameSettings, side: Side): number | null {
  if (settings.timerMinutes) return settings.timerMinutes[side];
  if (settings.untimed) return null;
  return settings.minutes ?? DEFAULT_TIMER_MINUTES;
}

function buildDefaultRoomName(settings: NewGameSettings, isSolo: boolean): string {
  const a = settings.playerA.trim() || "Player A";
  if (isSolo) return `${a} · solo`;
  const b = settings.playerB.trim() || "Player B";
  return `${a} vs ${b}`;
}

function TimerChips({
  value,
  onSelect,
}: {
  value: number | null;
  onSelect: (minutes: number | null) => void;
}) {
  return (
    <div className="timer-chips" role="radiogroup" aria-label={TIMER_TEXT.label}>
      {TIMER_MINUTE_OPTIONS.map((option) => {
        const active = value === option;
        return (
          <button
            key={option ?? "none"}
            type="button"
            role="radio"
            aria-checked={active}
            className={`timer-chip ${active ? "active" : ""}`}
            onClick={() => onSelect(option)}
          >
            {option === null ? (
              TIMER_TEXT.noTimer
            ) : (
              <>
                {option}
                {option === DEFAULT_TIMER_MINUTES && <em>{TIMER_TEXT.tournamentTag}</em>}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SidePlayerCard({
  side,
  heading,
  members,
  name,
  selectedId,
  accountId,
  accountOptions,
  showRegisteredAccount,
  accountInvalid,
  accountError,
  accountLocked,
  accountLabel,
  isYou,
  playsFirst,
  onNameChange,
  onMemberChange,
  onAccountChange,
}: {
  side: Side;
  heading: string;
  members: Member[];
  name: string;
  selectedId: string | null;
  accountId: string | null;
  accountOptions: RegisteredPlayer[];
  showRegisteredAccount: boolean;
  accountInvalid: boolean;
  accountError?: string;
  accountLocked: boolean;
  accountLabel: string;
  isYou: boolean;
  playsFirst: boolean;
  onNameChange: (value: string) => void;
  onMemberChange: (id: string | null) => void;
  onAccountChange: (id: string | null) => void;
}) {
  return (
    <div className={`side-card side-card-${side.toLowerCase()}`}>
      <div className="side-card-head">
        <em className={`dot dot-${side.toLowerCase()}`} />
        <strong>{heading}</strong>
        {isYou && <span className="side-card-you">you</span>}
        {playsFirst && <span className="side-card-first">{CREATE_TEXT.playsFirst}</span>}
      </div>
      <div className="side-card-fields">
        {showRegisteredAccount ? (
          <FieldRow
            controlId={`create-player-${side.toLowerCase()}-account`}
            label={accountLabel}
            hint="Only usernames are shared; private sign-in details stay hidden."
            error={accountInvalid ? (accountError ?? "Choose a registered user.") : null}
          >
            <SelectControl<string>
              id={`create-player-${side.toLowerCase()}-account`}
              ariaLabelledBy={`create-player-${side.toLowerCase()}-account-label`}
              ariaDescribedBy={`create-player-${side.toLowerCase()}-account-message`}
              value={accountId ?? ""}
              disabled={accountLocked}
              invalid={accountInvalid}
              required
              options={[
                { value: "", label: "Choose a username" },
                ...accountOptions.map((player) => ({ value: player.id, label: player.username })),
              ]}
              onChange={(value) => onAccountChange(value || null)}
            />
          </FieldRow>
        ) : (
          <>
            <FieldRow controlId={`create-player-${side.toLowerCase()}-name`} label="Name">
              <input
                id={`create-player-${side.toLowerCase()}-name`}
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                placeholder={`Player ${side}`}
              />
            </FieldRow>
            <FieldRow
              controlId={`create-player-${side.toLowerCase()}-member`}
              label={CREATE_TEXT.linkMember}
              hint={CREATE_TEXT.linkMemberHint}
            >
              <SelectControl<string>
                id={`create-player-${side.toLowerCase()}-member`}
                ariaLabelledBy={`create-player-${side.toLowerCase()}-member-label`}
                ariaDescribedBy={`create-player-${side.toLowerCase()}-member-message`}
                value={selectedId ?? ""}
                options={[
                  { value: "", label: CREATE_TEXT.notLinked },
                  ...members.map((member) => ({
                    value: member.id,
                    label: member.institution
                      ? `${member.name} · ${member.institution}`
                      : member.name,
                  })),
                ]}
                onChange={(value) => onMemberChange(value || null)}
              />
            </FieldRow>
          </>
        )}
      </div>
    </div>
  );
}

function mergeAccountPlayer(
  players: RegisteredPlayer[],
  userId: string | null,
  username: string,
): RegisteredPlayer[] {
  if (!userId || players.some((player) => player.id === userId)) return players;
  return [{ id: userId, username }, ...players];
}
