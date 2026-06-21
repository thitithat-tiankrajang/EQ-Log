import { Play } from "lucide-react";
import type { NewGameSettings, Side, TileDrawMode } from "../../../game";
import type { Member } from "../../../members";
import { DEFAULT_TIMER_MINUTES, TIMER_MINUTE_OPTIONS } from "../../../constants/gameRules";

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
        />

        <SidePlayerField
          side="B"
          members={members}
          name={settings.playerB}
          selectedId={settings.playerBMemberId ?? null}
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
        />
      </div>

      <button className="create-submit" type="button" onClick={onSubmit}>
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
  starts,
  onNameChange,
  onMemberChange,
}: {
  side: Side;
  members: Member[];
  name: string;
  selectedId: string | null;
  starts: boolean;
  onNameChange: (value: string) => void;
  onMemberChange: (id: string | null) => void;
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
      </div>
    </div>
  );
}
