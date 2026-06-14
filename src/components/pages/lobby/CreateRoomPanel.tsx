import { Play } from "lucide-react";
import type { NewGameSettings, Side } from "../../../game";
import type { Member } from "../../../members";
import { MemberPicker } from "./MemberPicker";

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

        <label className="create-field">
          <span>Time per side (minutes)</span>
          <input
            type="number"
            min={1}
            step={1}
            disabled={Boolean(settings.untimed)}
            value={settings.minutes}
            onChange={(event) =>
              onChange({ ...settings, minutes: Number(event.target.value) || 22 })
            }
          />
        </label>

        <label className="create-field create-checkbox">
          <input
            type="checkbox"
            checked={Boolean(settings.untimed)}
            onChange={(event) => onChange({ ...settings, untimed: event.target.checked })}
          />
          <span>No timer (untimed game)</span>
        </label>

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

        <div className="create-field create-side-field">
          <span className="create-side-label">
            <em className="dot dot-a" />
            Side A
            {settings.startingSide === "A" && <small>· starts</small>}
          </span>
          <MemberPicker
            members={members}
            selectedId={settings.playerAMemberId ?? null}
            freeText={settings.playerA}
            placeholder="Player A"
            onSelectMember={(id) => onChange({ ...settings, playerAMemberId: id })}
            onChangeFreeText={(value) => onChange({ ...settings, playerA: value })}
          />
        </div>

        <div className="create-field create-side-field">
          <span className="create-side-label">
            <em className="dot dot-b" />
            Side B
            {settings.startingSide === "B" && <small>· starts</small>}
          </span>
          <MemberPicker
            members={members}
            selectedId={settings.playerBMemberId ?? null}
            freeText={settings.playerB}
            placeholder="Player B"
            onSelectMember={(id) => onChange({ ...settings, playerBMemberId: id })}
            onChangeFreeText={(value) => onChange({ ...settings, playerB: value })}
          />
        </div>
      </div>

      <button className="create-submit" type="button" onClick={onSubmit}>
        <Play size={16} />
        Start room
      </button>
    </section>
  );
}
