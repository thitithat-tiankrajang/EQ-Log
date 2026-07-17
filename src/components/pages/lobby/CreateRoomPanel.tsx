import {
  ArrowLeftRight,
  Globe,
  Play,
  User,
  UserCog,
  Users,
} from "lucide-react";
import { useState } from "react";
import { normalizeEmail, type NewGameSettings, type Side, type TileDrawMode } from "../../../game";
import type { Member } from "../../../members";
import { DEFAULT_TIMER_MINUTES, TIMER_MINUTE_OPTIONS } from "../../../constants/gameRules";
import { isSupabaseConfigured } from "../../../supabaseClient";
import { useAuth } from "../../../auth";
import { ActionDock } from "../../ui/ActionDock";
import { ChoiceCardGroup } from "../../ui/ChoiceCardGroup";
import { FieldRow } from "../../ui/FieldRow";
import { CREATE_TEXT, PLAY_MODE_TEXT, TILE_DRAW_TEXT, TIMER_TEXT } from "../../../uiText";

type PlayMode = "hotseat" | "solo" | "hosted_email" | "hosted_solo" | "direct_email";
type WhoPlays = "pass_play" | "solo" | "online";
type OnlineRole = "direct_email" | "hosted_email" | "hosted_solo";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function playModeFromSettings(settings: NewGameSettings): PlayMode {
  if (settings.gameMode === "solo") return settings.playerAEmail ? "hosted_solo" : "solo";
  if (settings.playerAEmail || settings.playerBEmail) {
    return settings.emailPlayMode === "direct" ? "direct_email" : "hosted_email";
  }
  return "hotseat";
}

export function CreateRoomPanel({
  settings,
  members,
  busy = false,
  submitLabel,
  onChange,
  onSubmit,
}: {
  settings: NewGameSettings;
  members: Member[];
  busy?: boolean;
  submitLabel?: string;
  onChange: (next: NewGameSettings) => void;
  onSubmit: () => void;
}) {
  const { profile } = useAuth();
  const accountEmail = normalizeEmail(profile?.email);
  const [playMode, setPlayModeState] = useState<PlayMode>(() => playModeFromSettings(settings));
  const [lastOnlineRole, setLastOnlineRole] = useState<OnlineRole>(
    playMode === "hosted_email" || playMode === "hosted_solo" ? playMode : "direct_email",
  );
  const [perSideTimers, setPerSideTimers] = useState<boolean>(
    () => timerValueOf(settings, "A") !== timerValueOf(settings, "B") && settings.gameMode !== "solo",
  );

  const whoPlays: WhoPlays =
    playMode === "hotseat" ? "pass_play" : playMode === "solo" ? "solo" : "online";
  const onlineRole: OnlineRole | null =
    whoPlays === "online" ? (playMode as OnlineRole) : null;
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
      untimed: isSolo ? timerMinutes.A === null : timerMinutes.A === null && timerMinutes.B === null,
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
        playerAEmail: null,
        playerBEmail: null,
        emailPlayMode: undefined,
        startingSide: mode === "solo" ? "A" : settings.startingSide,
        tileDrawMode: mode === "solo" ? "play" : settings.tileDrawMode,
      });
      return;
    }
    const emailA = normalizeEmail(settings.playerAEmail);
    const emailB = normalizeEmail(settings.playerBEmail);
    if (mode === "hosted_solo") {
      const creatorWasA = Boolean(accountEmail && emailA === accountEmail);
      onChange({
        ...settings,
        playerA: creatorWasA ? "" : settings.playerA,
        playerB: "",
        playerAMemberId: creatorWasA ? null : settings.playerAMemberId,
        playerBMemberId: null,
        playerAEmail: creatorWasA ? "" : emailA ?? "",
        playerBEmail: null,
        gameMode: "solo",
        emailPlayMode: "hosted",
        startingSide: "A",
      });
      return;
    }
    if (mode === "hosted_email") {
      const creatorWasA = Boolean(accountEmail && emailA === accountEmail);
      const creatorWasB = Boolean(accountEmail && emailB === accountEmail);
      onChange({
        ...settings,
        playerA: creatorWasA ? "" : settings.playerA,
        playerB: creatorWasB ? "" : settings.playerB,
        playerAMemberId: creatorWasA ? null : settings.playerAMemberId,
        playerBMemberId: creatorWasB ? null : settings.playerBMemberId,
        playerAEmail: emailA === accountEmail ? "" : emailA ?? "",
        playerBEmail: emailB === accountEmail ? "" : emailB ?? "",
        gameMode: "versus",
        emailPlayMode: "hosted",
      });
      return;
    }
    const side: Side =
      emailB === accountEmail
        ? "B"
        : emailA === accountEmail
          ? "A"
          : emailA && !emailB
            ? "B"
            : "A";
    const creatorAlreadyAssigned = emailA === accountEmail || emailB === accountEmail;
    const opponentEmail = (side === "A" ? emailB : emailA) ?? "";
    onChange({
      ...settings,
      playerA:
        side === "A" && !creatorAlreadyAssigned
          ? profile?.display_name ?? ""
          : settings.playerA,
      playerB:
        side === "B" && !creatorAlreadyAssigned
          ? profile?.display_name ?? ""
          : settings.playerB,
      playerAMemberId:
        side === "A" && !creatorAlreadyAssigned ? null : settings.playerAMemberId,
      playerBMemberId:
        side === "B" && !creatorAlreadyAssigned ? null : settings.playerBMemberId,
      playerAEmail: side === "A" ? accountEmail ?? "" : opponentEmail,
      playerBEmail: side === "B" ? accountEmail ?? "" : opponentEmail,
      gameMode: "versus",
      emailPlayMode: "direct",
      tileDrawMode: "play",
    });
  }

  const usesEmailPlay =
    playMode === "hosted_email" ||
    playMode === "hosted_solo" ||
    playMode === "direct_email";
  const isDirectEmail = playMode === "direct_email";
  const normalizedEmailA = normalizeEmail(settings.playerAEmail);
  const normalizedEmailB = normalizeEmail(settings.playerBEmail);
  const creatorSide: Side = accountEmail && normalizedEmailB === accountEmail ? "B" : "A";
  const emailAInvalid = usesEmailPlay && (!normalizedEmailA || isInvalidEmail(normalizedEmailA));
  const emailBRequired = !isSolo && usesEmailPlay;
  const emailBInvalid = emailBRequired && (!normalizedEmailB || isInvalidEmail(normalizedEmailB));
  const emailDuplicate =
    Boolean(normalizedEmailA) && normalizedEmailA === normalizedEmailB;
  const creatorAssigned =
    Boolean(accountEmail) &&
    (normalizedEmailA === accountEmail || normalizedEmailB === accountEmail);
  const emailAIsHost =
    (playMode === "hosted_email" || playMode === "hosted_solo") &&
    normalizedEmailA === accountEmail;
  const emailBIsHost = playMode === "hosted_email" && normalizedEmailB === accountEmail;
  const creatorAssignmentInvalid =
    usesEmailPlay &&
    (isDirectEmail ? !creatorAssigned : creatorAssigned);
  const submitBlocked =
    usesEmailPlay &&
    (!accountEmail ||
      emailAInvalid ||
      emailBInvalid ||
      emailDuplicate ||
      creatorAssignmentInvalid);

  const creatorNotAssigned =
    isDirectEmail &&
    Boolean(accountEmail) &&
    normalizedEmailA !== accountEmail &&
    normalizedEmailB !== accountEmail;

  // Always-visible reason why Create is disabled (design.md D3 — no tooltips).
  const blockedReason = !submitBlocked
    ? null
    : !accountEmail
      ? "Sign in first — online rooms need your account email."
      : emailDuplicate
        ? "Side A and Side B must use different email accounts."
        : creatorNotAssigned
          ? "One side must use your signed-in email — tap the side you play."
          : (playMode === "hosted_email" || playMode === "hosted_solo") && creatorAssigned
            ? "As host you can't also be a player — use a different player email."
            : playMode === "hosted_solo"
              ? "Enter the invited player's email."
              : playMode === "hosted_email"
                ? "Enter both invited players' emails."
                : "Enter your opponent's email.";

  function setCreatorSide(side: Side) {
    if (!accountEmail || side === creatorSide) return;
    const opponentEmail =
      [normalizedEmailA, normalizedEmailB].find((email) => email && email !== accountEmail) ?? "";
    onChange({
      ...settings,
      playerA: settings.playerB,
      playerB: settings.playerA,
      playerAMemberId: settings.playerBMemberId,
      playerBMemberId: settings.playerAMemberId,
      playerAEmail: side === "A" ? accountEmail : opponentEmail,
      playerBEmail: side === "B" ? accountEmail : opponentEmail,
    });
  }

  const startingSide: Side = settings.startingSide ?? "A";
  const otherStartingSide: Side = startingSide === "A" ? "B" : "A";
  const tileDrawMode: TileDrawMode = settings.tileDrawMode ?? "manual";
  const manualLabel = usesEmailPlay ? TILE_DRAW_TEXT.hostEnters : TILE_DRAW_TEXT.realTiles;
  const manualDesc = usesEmailPlay ? TILE_DRAW_TEXT.hostEntersDesc : TILE_DRAW_TEXT.realTilesDesc;
  const tileDrawSummary = tileDrawMode === "play" ? TILE_DRAW_TEXT.appDraws : manualLabel;
  const showRackVisibility = usesEmailPlay && !isSolo;
  const defaultRoomName = buildDefaultRoomName(settings, isSolo);

  const submitText = busy
    ? CREATE_TEXT.submitBusy
    : submitLabel ?? (usesEmailPlay ? CREATE_TEXT.submitOnline : CREATE_TEXT.submit);

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
        {isDirectEmail && (
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
            <p className="create-signed-in">Signed in as {accountEmail ?? "an unavailable account"}</p>
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
          email={settings.playerAEmail ?? ""}
          showEmail={usesEmailPlay}
          emailInvalid={emailAInvalid || emailDuplicate || emailAIsHost}
          emailError={
            emailDuplicate
              ? "Side A and Side B must use different email accounts."
              : emailAIsHost
                ? isHostedSolo
                  ? "The host account cannot also be the solo player."
                  : "The host account cannot also be Side A."
              : !normalizedEmailA
                ? isHostedSolo
                  ? "Enter the email the solo player signs in with."
                  : "Enter the email this player signs in with."
                : undefined
          }
          emailLocked={isDirectEmail && creatorSide === "A"}
          emailLabel={
            isDirectEmail
              ? creatorSide === "A"
                ? "Your signed-in email"
                : "Opponent email"
              : isHostedSolo
                ? "Solo player email"
                : "Player email"
          }
          isYou={isDirectEmail && creatorSide === "A"}
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
          onEmailChange={(value) => onChange({ ...settings, playerAEmail: value })}
        />
        {!isSolo && (
          <SidePlayerCard
            side="B"
            heading="Side B"
            members={members}
            name={settings.playerB}
            selectedId={settings.playerBMemberId ?? null}
            email={settings.playerBEmail ?? ""}
            showEmail={usesEmailPlay}
            emailInvalid={emailBInvalid || emailDuplicate || emailBIsHost}
            emailError={
              emailDuplicate
                ? "Side A and Side B must use different email accounts."
                : emailBIsHost
                  ? "The host account cannot also be Side B."
                : !normalizedEmailB
                  ? "Enter the email this player signs in with."
                  : undefined
            }
            emailLocked={isDirectEmail && creatorSide === "B"}
            emailLabel={
              isDirectEmail
                ? creatorSide === "B"
                  ? "Your signed-in email"
                  : "Opponent email"
                : "Player email"
            }
            isYou={isDirectEmail && creatorSide === "B"}
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
            onEmailChange={(value) => onChange({ ...settings, playerBEmail: value })}
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
          {isHostedSolo
            ? "Solo player timer"
            : isSolo
              ? "Your timer"
              : TIMER_TEXT.label}
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
          <label className="timer-per-side-toggle">
            <input
              type="checkbox"
              checked={perSideTimers}
              onChange={(event) => {
                setPerSideTimers(event.target.checked);
                if (!event.target.checked) setTimerBoth(timerValue("A"));
              }}
            />
            {TIMER_TEXT.perSide}
          </label>
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
            <span>{CREATE_TEXT.roomNameLabel} · {settings.name.trim() || defaultRoomName}</span>
            <span>{TILE_DRAW_TEXT.label} · {tileDrawSummary}</span>
            {showRackVisibility && (
              <span>
                {CREATE_TEXT.opponentRack} ·{" "}
                {settings.emailPlayersCanSeeOpponentRack ? CREATE_TEXT.rackVisible : CREATE_TEXT.rackHidden}
              </span>
            )}
          </span>
        </summary>
        <div className="create-advanced-body">
          <FieldRow label={CREATE_TEXT.roomNameLabel} hint="Shown in the rooms list — named after the players by default.">
            <input
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
  email,
  showEmail,
  emailInvalid,
  emailError,
  emailLocked,
  emailLabel,
  isYou,
  playsFirst,
  onNameChange,
  onMemberChange,
  onEmailChange,
}: {
  side: Side;
  heading: string;
  members: Member[];
  name: string;
  selectedId: string | null;
  email: string;
  showEmail: boolean;
  emailInvalid: boolean;
  emailError?: string;
  emailLocked: boolean;
  emailLabel: string;
  isYou: boolean;
  playsFirst: boolean;
  onNameChange: (value: string) => void;
  onMemberChange: (id: string | null) => void;
  onEmailChange: (value: string) => void;
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
        <FieldRow label="Name">
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={`Player ${side}`}
          />
        </FieldRow>
        <FieldRow label={CREATE_TEXT.linkMember} hint={CREATE_TEXT.linkMemberHint}>
          <select
            value={selectedId ?? ""}
            onChange={(event) => onMemberChange(event.target.value || null)}
          >
            <option value="">{CREATE_TEXT.notLinked}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.institution ? `${member.name} · ${member.institution}` : member.name}
              </option>
            ))}
          </select>
        </FieldRow>
        {showEmail && (
          <FieldRow label={emailLabel} error={emailInvalid ? emailError ?? "Enter the email this player uses for Google sign-in." : null}>
            <input
              type="email"
              autoComplete="off"
              readOnly={emailLocked}
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder={emailLocked ? "" : "player@example.com"}
              aria-invalid={emailInvalid}
            />
          </FieldRow>
        )}
      </div>
    </div>
  );
}

function isInvalidEmail(value: string | null | undefined): boolean {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return false;
  return !EMAIL_PATTERN.test(trimmed);
}
