import { Mail, Play, Users } from "lucide-react";
import { useState } from "react";
import type { NewGameSettings, Side, TileDrawMode } from "../../../game";
import type { Member } from "../../../members";
import { DEFAULT_TIMER_MINUTES, TIMER_MINUTE_OPTIONS } from "../../../constants/gameRules";
import { isSupabaseConfigured } from "../../../supabaseClient";

type PlayMode = "hotseat" | "invite";

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
  const [playMode, setPlayModeState] = useState<PlayMode>(() =>
    settings.playerAEmail || settings.playerBEmail ? "invite" : "hotseat",
  );

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
      untimed: timerMinutes.A === null && timerMinutes.B === null,
    });
  }

  function setPlayMode(mode: PlayMode) {
    if (mode === "invite" && !isSupabaseConfigured) return;
    setPlayModeState(mode);
    if (mode === "hotseat") {
      onChange({ ...settings, playerAEmail: null, playerBEmail: null });
    } else {
      onChange({
        ...settings,
        playerAEmail: settings.playerAEmail ?? "",
        playerBEmail: settings.playerBEmail ?? "",
      });
    }
  }

  const emailAInvalid = isInvalidEmail(settings.playerAEmail);
  const emailBInvalid = isInvalidEmail(settings.playerBEmail);
  const emailDuplicate =
    Boolean(settings.playerAEmail?.trim()) &&
    settings.playerAEmail?.trim().toLowerCase() === settings.playerBEmail?.trim().toLowerCase();
  const submitBlocked =
    playMode === "invite" &&
    (emailAInvalid ||
      emailBInvalid ||
      emailDuplicate ||
      (!settings.playerAEmail?.trim() && !settings.playerBEmail?.trim()));

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
              disabled={!isSupabaseConfigured}
              className={playMode === "invite" ? "active" : ""}
              onClick={() => setPlayMode("invite")}
              title={
                isSupabaseConfigured
                  ? "Invite an opponent by email — they play on their own device"
                  : "Configure Supabase to play across accounts"
              }
            >
              <Mail size={14} />
              Play vs email
            </button>
          </div>
          {playMode === "invite" && (
            <p className="create-hint">
              Invite players using the same email they use for Google sign-in. Each account can
              control only its assigned side and only during that side's turn. The room owner can
              control either side.
            </p>
          )}
        </fieldset>

        <fieldset className="create-field create-timer-field">
          <legend>Time per side (minutes)</legend>
          <div className="create-timer-grid">
            {(["A", "B"] as Side[]).map((side) => (
              <label key={side}>
                <span>Side {side}</span>
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
            {([
              ["manual", "Manual fill"],
              ["play", "Play mode"],
            ] as Array<[TileDrawMode, string]>).map(([mode, label]) => (
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

        <SidePlayerField
          side="A"
          members={members}
          name={settings.playerA}
          selectedId={settings.playerAMemberId ?? null}
          email={settings.playerAEmail ?? ""}
          showEmail={playMode === "invite"}
          emailInvalid={emailAInvalid || emailDuplicate}
          emailError={
            emailDuplicate ? "Side A and Side B must use different email accounts." : undefined
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

        <SidePlayerField
          side="B"
          members={members}
          name={settings.playerB}
          selectedId={settings.playerBMemberId ?? null}
          email={settings.playerBEmail ?? ""}
          showEmail={playMode === "invite"}
          emailInvalid={emailBInvalid || emailDuplicate}
          emailError={
            emailDuplicate ? "Side A and Side B must use different email accounts." : undefined
          }
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
        />
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
              : "Enter at least one valid invitee email (or switch back to Hot-seat)."
            : undefined
        }
      >
        <Play size={16} />
        Start room
      </button>
    </section>
  );
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
            <span>Invite email for Side {side}</span>
            <input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              placeholder="opponent@example.com"
              aria-invalid={emailInvalid}
            />
            {emailInvalid && (
              <em className="create-error">
                {emailError ??
                  "That doesn't look like a valid email. Leave blank to keep this side owner-only."}
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
