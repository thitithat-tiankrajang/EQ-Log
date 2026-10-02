import { useState } from "react";
import type { LiveGameView } from "./projection";
import type { LiveControl, WaitingConfiguration } from "./controls";
import { useRegisteredPlayersCatalog } from "../components/pages/lobby/useRegisteredPlayersCatalog";
import type { RankedTurnView } from "../features/ranked/publicView";

export function WaitingControls({
  match,
  busy,
  onAction,
  onLeave,
}: {
  match: LiveGameView;
  busy: boolean;
  onAction(action: LiveControl): void;
  onLeave(): void;
}) {
  const [settings, setSettings] = useState<WaitingConfiguration | undefined>(match.waitingSettings);
  const [editing, setEditing] = useState(false);
  const directory = useRegisteredPlayersCatalog(Boolean(match.canConfigure && editing), "public");
  return (
    <section aria-label="Waiting room controls">
      {match.yourSide && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAction({ kind: "ready", ready: !match.readyBySide[match.yourSide!] })}
        >
          {match.readyBySide[match.yourSide] ? "Unready" : "Ready"}
        </button>
      )}
      {match.canConfigure && (
        <>
          <button
            type="button"
            disabled={busy || Boolean(match.launchAt)}
            onClick={() => setEditing(!editing)}
          >
            Configure room
          </button>
          <button
            type="button"
            disabled={busy || !match.canLaunch || Boolean(match.launchAt)}
            onClick={() => onAction({ kind: "launch" })}
          >
            Launch game
          </button>
        </>
      )}
      {match.launchAt && (
        <p role="status">
          Launching in {Math.max(0, Math.ceil((Date.parse(match.launchAt) - Date.now()) / 1000))}…
        </p>
      )}
      {editing && settings && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onAction({ kind: "configure", settings });
          }}
        >
          <label>
            Room name
            <input
              value={settings.name}
              maxLength={160}
              required
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </label>
          {(["A", "B"] as const).map((side) => (
            <fieldset key={side}>
              <legend>Player {side}</legend>
              <label>
                Name
                <input
                  value={side === "A" ? settings.playerA : settings.playerB}
                  maxLength={160}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      [side === "A" ? "playerA" : "playerB"]: e.target.value,
                    })
                  }
                />
              </label>
              {!match.localHandoff && !match.botSide && (
                <label>
                  Registered player
                  <select
                    value={settings[side === "A" ? "playerAUserId" : "playerBUserId"] ?? ""}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        [side === "A" ? "playerAUserId" : "playerBUserId"]: e.target.value || null,
                      })
                    }
                  >
                    <option value="">Open seat</option>
                    {![...directory.players].some(
                      (p) => p.id === settings[side === "A" ? "playerAUserId" : "playerBUserId"],
                    ) &&
                      settings[side === "A" ? "playerAUserId" : "playerBUserId"] && (
                        <option value={settings[side === "A" ? "playerAUserId" : "playerBUserId"]!}>
                          {match.players[side]}
                        </option>
                      )}
                    {directory.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.username}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                Minutes (empty means untimed)
                <input
                  type="number"
                  min={1}
                  max={1440}
                  step={1}
                  value={settings.timerMinutes?.[side] ?? ""}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      timerMinutes: {
                        A: settings.timerMinutes?.A ?? null,
                        B: settings.timerMinutes?.B ?? null,
                        [side]: e.target.value === "" ? null : Number(e.target.value),
                      },
                    })
                  }
                />
              </label>
            </fieldset>
          ))}
          <label>
            Starting player
            <select
              value={settings.startingSide}
              onChange={(e) =>
                setSettings({ ...settings, startingSide: e.target.value as "A" | "B" })
              }
            >
              <option value="A">A</option>
              <option value="B">B</option>
            </select>
          </label>
          {directory.error && <p role="alert">{directory.error}</p>}
          <button type="submit" disabled={busy}>
            Save configuration and redeal
          </button>
        </form>
      )}
      <button type="button" disabled={busy} onClick={onLeave}>
        Leave waiting room
      </button>
    </section>
  );
}

export function EditingControls({
  match,
  busy,
  selectedLog,
  onAction,
  onSelectLog,
  allowBranches = true,
}: {
  match: LiveGameView;
  busy: boolean;
  selectedLog: RankedTurnView | null;
  onAction(action: LiveControl): void;
  onSelectLog(id: string): void;
  allowBranches?: boolean;
}) {
  const [name, setName] = useState(match.name);
  const [note, setNote] = useState(selectedLog?.note ?? "");
  const [stars, setStars] = useState(selectedLog?.stars ?? 0);
  if (match.continuationBlocked || match.status === "finished") return null;
  const request = match.matchControl?.stopRequest,
    response = match.matchControl?.stopResponse;
  return (
    <section aria-label="Live game tools" className="pregame-card">
      {match.canRename && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAction({ kind: "rename", name });
          }}
        >
          <label>
            Game name
            <input
              value={name}
              maxLength={160}
              required
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy}>
            Rename game
          </button>
        </form>
      )}
      {match.directPause && (
        <>
          {match.paused ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onAction({ kind: "resume-direct" })}
            >
              Resume game
            </button>
          ) : (
            <button
              type="button"
              disabled={
                busy ||
                Boolean(request) ||
                Date.parse(match.matchControl?.stopBlockedUntilBySide?.[match.yourSide!] ?? "") >
                  Date.now()
              }
              onClick={() => onAction({ kind: "request-pause" })}
            >
              Request pause
            </button>
          )}
          {request && <p role="status">{match.players[request.requestedBy]} requested a pause.</p>}
          {request && request.requestedBy !== match.yourSide && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onAction({ kind: "respond-pause", requestId: request.id, accept: true })
                }
              >
                Accept pause
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onAction({ kind: "respond-pause", requestId: request.id, accept: false })
                }
              >
                Decline pause
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  onAction({
                    kind: "respond-pause",
                    requestId: request.id,
                    accept: false,
                    blockFiveMinutes: true,
                  })
                }
              >
                Decline and block for 5 minutes
              </button>
            </>
          )}
          {response && response.requestedBy === match.yourSide && (
            <>
              <p role="status">
                Pause {response.accepted ? "accepted" : "declined"}
                {response.blockedForMs ? " · requests blocked for 5 minutes" : ""}.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction({ kind: "acknowledge-pause", responseId: response.id })}
              >
                Acknowledge response
              </button>
            </>
          )}
        </>
      )}
      {match.canEditHistory && (
        <>
          <button
            type="button"
            disabled={busy || !match.canUndo}
            onClick={() => onAction({ kind: "undo" })}
          >
            Undo committed change
          </button>
          <button
            type="button"
            disabled={busy || !match.canRedo}
            onClick={() => onAction({ kind: "redo" })}
          >
            Redo committed change
          </button>
          {selectedLog && (
            <>
              {allowBranches && (
                <>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onAction({
                        kind: "continue",
                        target: { nodeId: selectedLog.id, phase: "before" },
                      })
                    }
                  >
                    Continue before this turn
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onAction({
                        kind: "continue",
                        target: { nodeId: selectedLog.id, phase: "after" },
                      })
                    }
                  >
                    Continue after this turn
                  </button>
                </>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  onAction({ kind: "annotate", logId: selectedLog.id, note, stars });
                }}
              >
                <label>
                  Turn note
                  <textarea
                    maxLength={4000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <label>
                  Stars
                  <select value={stars} onChange={(e) => setStars(Number(e.target.value))}>
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" disabled={busy}>
                  Save annotation
                </button>
              </form>
            </>
          )}
          {allowBranches &&
            match.timeline?.lines.map((line) => (
              <fieldset key={line.id}>
                <legend>Alternate line</legend>
                {line.logs.map((log) => (
                  <button key={log.id} type="button" onClick={() => onSelectLog(log.id)}>
                    View T{log.turnNumber} · {log.side}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    onAction({
                      kind: "continue",
                      target: { nodeId: line.logs.at(-1)!.id, phase: "after" },
                    })
                  }
                >
                  Restore alternate line
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onAction({ kind: "prune", lineId: line.id })}
                >
                  Prune alternate line
                </button>
              </fieldset>
            ))}
        </>
      )}
    </section>
  );
}
