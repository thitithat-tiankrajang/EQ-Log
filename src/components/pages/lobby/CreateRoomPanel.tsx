import { Eye, EyeOff, Mail, Play, User, UserCog, Users } from "lucide-react";
import { useState } from "react";
import { normalizeEmail, type NewGameSettings, type Side, type TileDrawMode } from "../../../game";
import type { Member } from "../../../members";
import { DEFAULT_TIMER_MINUTES, TIMER_MINUTE_OPTIONS } from "../../../constants/gameRules";
import { isSupabaseConfigured } from "../../../supabaseClient";
import { useAuth } from "../../../auth";

type PlayMode = "hotseat" | "solo" | "hosted_email" | "hosted_solo" | "direct_email";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function CreateRoomPanel({
  settings,
  members,
  onChange,
  onSubmit,
}: {
  settings: NewGameSettings;
  members: Member[];
  onChange: (next: NewGameSettings) => void;
  onSubmit: () => void;
}) {
  const { profile } = useAuth();
  const accountEmail = normalizeEmail(profile?.email);
  const [playMode, setPlayModeState] = useState<PlayMode>(() =>
    settings.gameMode === "solo"
      ? settings.playerAEmail
        ? "hosted_solo"
        : "solo"
      : settings.playerAEmail || settings.playerBEmail
      ? settings.emailPlayMode === "direct"
        ? "direct_email"
        : "hosted_email"
      : "hotseat",
  );
  const isSolo = playMode === "solo" || playMode === "hosted_solo";
  const isHostedSolo = playMode === "hosted_solo";
  const drawModeLocked = playMode === "solo" || playMode === "direct_email";
  const tileDrawOptions: Array<[TileDrawMode, string]> = drawModeLocked
    ? [["play", "System draw"]]
    : [
        ["manual", usesHostDraw(playMode) ? "Host picks tiles" : "Manual fill"],
        ["play", "System draw"],
      ];

  function timerValue(side: Side): number | null {
    if (settings.timerMinutes) return settings.timerMinutes[side];
    if (settings.untimed) return null;
    return settings.minutes ?? DEFAULT_TIMER_MINUTES;
  }

  function setTimerValue(side: Side, value: string) {
    const minutes = value === "none" ? null : Number(value);
    const timerMinutes = {
      A: timerValue("A"),
      B: timerValue("B"),
      [side]: Number.isFinite(minutes) || minutes === null ? minutes : DEFAULT_TIMER_MINUTES,
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

  return (
    <section className="create-panel" aria-label="Create a new room">
      <div className="create-panel-head">
        <span className="create-eyebrow">New room</span>
        <h2>Set up a recording for this match</h2>
        <p>Each room is one match. Tag the players to roll the result into the stats page.</p>
      </div>
      <div className="create-grid">
        <label className="create-field">
          <span>Room name</span>
          <input
            value={settings.name}
            onChange={(event) => onChange({ ...settings, name: event.target.value })}
            placeholder="Friday night practice"
          />
        </label>

        <fieldset className="create-field create-segment-field">
          <legend>Play mode</legend>
          <div className="create-segment create-playmode-segment">
            <button
              type="button"
              className={playMode === "hotseat" ? "active" : ""}
              onClick={() => setPlayMode("hotseat")}
              title="Both players share this device"
            >
              <Users size={14} />
              Hot-seat (this device)
            </button>
            <button
              type="button"
              className={playMode === "solo" ? "active" : ""}
              onClick={() => setPlayMode("solo")}
              title="Create and play a one-side room with automatic draw"
            >
              <User size={14} />
              Solo · System draw
            </button>
            <button
              type="button"
              disabled={!isSupabaseConfigured}
              className={playMode === "hosted_email" ? "active" : ""}
              onClick={() => setPlayMode("hosted_email")}
              title={
                isSupabaseConfigured
                  ? "Create a room managed by a host who is not one of the two players"
                  : "Configure Supabase to play across accounts"
              }
            >
              <UserCog size={14} />
              Email with host
            </button>
            <button
              type="button"
              disabled={!isSupabaseConfigured}
              className={playMode === "hosted_solo" ? "active" : ""}
              onClick={() => setPlayMode("hosted_solo")}
              title={
                isSupabaseConfigured
                  ? "Host a one-side game for one invited email player"
                  : "Configure Supabase to play across accounts"
              }
            >
              <UserCog size={14} />
              Hosted solo
            </button>
            <button
              type="button"
              disabled={!isSupabaseConfigured}
              className={playMode === "direct_email" ? "active" : ""}
              onClick={() => setPlayMode("direct_email")}
              title={
                isSupabaseConfigured
                  ? "The room creator is one of the two email players"
                  : "Configure Supabase to play across accounts"
              }
            >
              <Mail size={14} />
              Direct email
            </button>
          </div>
          {usesEmailPlay && (
            <p className="create-hint">
              {isHostedSolo
                ? "You are the host. The invited player controls the only side; manual draw is handled by you."
                : isDirectEmail
                ? "You are one player. Each account controls only its assigned side."
                : "You manage the room while two other email accounts play their assigned sides."}
            </p>
          )}
          {playMode === "solo" && (
            <p className="create-hint">
              You draw automatically and play every turn. Only your score and timer are used.
            </p>
          )}
        </fieldset>

        {isDirectEmail && (
          <fieldset className="create-field create-segment-field create-owner-side-field">
            <legend>Your side</legend>
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
            <p className="create-account-email">Signed in as {accountEmail ?? "an unavailable account"}</p>
          </fieldset>
        )}

        {usesEmailPlay && !isSolo && (
          <fieldset className="create-field create-segment-field create-rack-visibility-field">
            <legend>Show opponent rack</legend>
            <div className="create-segment">
              <button
                type="button"
                aria-pressed={!settings.emailPlayersCanSeeOpponentRack}
                className={!settings.emailPlayersCanSeeOpponentRack ? "active" : ""}
                onClick={() => onChange({ ...settings, emailPlayersCanSeeOpponentRack: false })}
              >
                <EyeOff size={14} />
                Off
              </button>
              <button
                type="button"
                aria-pressed={Boolean(settings.emailPlayersCanSeeOpponentRack)}
                className={settings.emailPlayersCanSeeOpponentRack ? "active" : ""}
                onClick={() => onChange({ ...settings, emailPlayersCanSeeOpponentRack: true })}
              >
                <Eye size={14} />
                On
              </button>
            </div>
            <p className="create-account-email">
              {settings.emailPlayersCanSeeOpponentRack
                ? "Players see the active player's rack."
                : "Players see only their own rack."}
            </p>
          </fieldset>
        )}

        <fieldset className="create-field create-timer-field">
          <legend>
            {isHostedSolo
              ? "Solo player timer (minutes)"
              : isSolo
                ? "Your timer (minutes)"
                : "Time per side (minutes)"}
          </legend>
          <div className={`create-timer-grid ${isSolo ? "solo" : ""}`}>
            {(isSolo ? (["A"] as Side[]) : (["A", "B"] as Side[])).map((side) => (
              <label key={side}>
                <span>{isHostedSolo ? "Player timer" : isSolo ? "Solo timer" : `Side ${side}`}</span>
                <select
                  value={timerValue(side) === null ? "none" : String(timerValue(side))}
                  onChange={(event) => setTimerValue(side, event.target.value)}
                >
                  {TIMER_MINUTE_OPTIONS.map((option) => (
                    <option key={option ?? "none"} value={option ?? "none"}>
                      {option === null ? "No timer" : option}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="create-field create-segment-field">
          <legend>Tile draw</legend>
          <div className="create-segment">
            {tileDrawOptions.map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={(settings.tileDrawMode ?? "manual") === mode ? "active" : ""}
                onClick={() => onChange({ ...settings, tileDrawMode: mode })}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {!isSolo && (
          <fieldset className="create-field create-segment-field">
            <legend>Starting side</legend>
            <div className="create-segment">
              {(["A", "B"] as Side[]).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={settings.startingSide === side ? "active" : ""}
                  onClick={() => onChange({ ...settings, startingSide: side })}
                >
                  Side {side}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <SidePlayerField
          side="A"
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
                  ? "Enter the email used by the solo player."
                  : "Enter the email used to sign in for Side A."
                : undefined
          }
          emailLocked={isDirectEmail && creatorSide === "A"}
          emailLabel={
            isDirectEmail
              ? undefined
              : isHostedSolo
                ? "Solo player email"
                : "Player email for Side A"
          }
          starts={settings.startingSide === "A"}
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

        {!isSolo && <SidePlayerField
          side="B"
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
                ? "Enter the email used to sign in for Side B."
                : undefined
          }
          emailLocked={isDirectEmail && creatorSide === "B"}
          emailLabel={isDirectEmail ? undefined : "Player email for Side B"}
          starts={settings.startingSide === "B"}
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
        />}
      </div>

      <button
        className="create-submit"
        type="button"
        onClick={onSubmit}
        disabled={submitBlocked}
        title={
          submitBlocked
            ? emailDuplicate
              ? "Use a different email for each side."
              : creatorNotAssigned
                ? "The signed-in account must be assigned to Side A or Side B."
                : (playMode === "hosted_email" || playMode === "hosted_solo") && creatorAssigned
                  ? "The host account cannot also be a player."
                : playMode === "hosted_solo"
                  ? "Enter one valid player email that is different from the host account."
                : playMode === "hosted_email"
                  ? "Enter two valid player emails that are different from the host account."
                  : "Enter two valid player emails, including your signed-in account."
            : undefined
        }
      >
        <Play size={16} />
        Start room
      </button>
    </section>
  );
}

function usesHostDraw(mode: PlayMode): boolean {
  return mode === "hosted_email" || mode === "hosted_solo";
}

function SidePlayerField({
  side,
  members,
  name,
  selectedId,
  email,
  showEmail,
  emailInvalid,
  emailError,
  emailLocked,
  emailLabel,
  starts,
  onNameChange,
  onMemberChange,
  onEmailChange,
}: {
  side: Side;
  members: Member[];
  name: string;
  selectedId: string | null;
  email: string;
  showEmail: boolean;
  emailInvalid: boolean;
  emailError?: string;
  emailLocked: boolean;
  emailLabel?: string;
  starts: boolean;
  onNameChange: (value: string) => void;
  onMemberChange: (id: string | null) => void;
  onEmailChange: (value: string) => void;
}) {
  return (
    <div className="create-field create-side-field">
      <span className="create-side-label">
        <em className={`dot dot-${side.toLowerCase()}`} />
        Side {side}
        {starts && <small>starts</small>}
      </span>
      <div className="create-side-inputs">
        <label>
          <span>Player name for Side {side}</span>
          <input
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder={`Type Side ${side} player name`}
          />
        </label>
        <label>
          <span>Choose member</span>
          <select
            value={selectedId ?? ""}
            onChange={(event) => onMemberChange(event.target.value || null)}
          >
            <option value="">No linked member</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.institution ? `${member.name} · ${member.institution}` : member.name}
              </option>
            ))}
          </select>
        </label>
        {showEmail && (
          <label className={emailInvalid ? "has-error" : ""}>
            <span>
              {emailLabel ?? (emailLocked ? "Your signed-in email" : `Opponent email for Side ${side}`)}
            </span>
            <input
              type="email"
              autoComplete="off"
              readOnly={emailLocked}
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder={emailLocked ? "" : "opponent@example.com"}
              aria-invalid={emailInvalid}
            />
            {emailInvalid && (
              <em className="create-error">
                {emailError ??
                  "Enter the valid email this player uses for Google sign-in."}
              </em>
            )}
          </label>
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
