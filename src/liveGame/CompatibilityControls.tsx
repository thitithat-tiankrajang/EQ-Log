import { useState, type ReactNode } from "react";
import type { LiveGameView } from "./projection";
import type { LiveControl, WaitingConfiguration } from "./controls";
import { useRegisteredPlayersCatalog } from "../components/pages/lobby/useRegisteredPlayersCatalog";
import { Sheet } from "../components/ui/Sheet";
import type { RankedTurnView } from "../features/ranked/publicView";
import { ToolSection } from "./ContextTools";

export function WaitingControls({
  match,
  busy,
  onAction,
  onLeave,
  children,
}: {
  match: LiveGameView;
  busy: boolean;
  onAction(action: LiveControl): void;
  onLeave(): void;
  /** Further room actions, shown in the same row before Leave. */
  children?: ReactNode;
}) {
  const [settings, setSettings] = useState<WaitingConfiguration | undefined>(match.waitingSettings);
  const [editing, setEditing] = useState(false);
  const directory = useRegisteredPlayersCatalog(Boolean(match.canConfigure && editing), "public");
  const ready = Boolean(match.yourSide && match.readyBySide[match.yourSide]);
  return (
    <section aria-label="Waiting room controls" className="live-waiting-controls">
      <div className="live-tool-actions">
        {match.yourSide && (
          <button
            type="button"
            className={`eq-button ${ready ? "eq-button-secondary" : "eq-button-primary"}`}
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
              className="eq-button eq-button-primary"
              disabled={busy || !match.canLaunch || Boolean(match.launchAt)}
              onClick={() => onAction({ kind: "launch" })}
            >
              Launch game
            </button>
            <button
              type="button"
              className="eq-button eq-button-secondary"
              aria-expanded={editing}
              disabled={busy || Boolean(match.launchAt)}
              onClick={() => setEditing(!editing)}
            >
              Configure room
            </button>
          </>
        )}
        {children}
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={busy}
          onClick={onLeave}
        >
          Leave waiting room
        </button>
      </div>
      {match.launchAt && (
        <p className="live-tool-note" role="status">
          Launching in {Math.max(0, Math.ceil((Date.parse(match.launchAt) - Date.now()) / 1000))}…
        </p>
      )}
      {editing && settings && (
        <form
          className="live-config-form"
          onSubmit={(event) => {
            event.preventDefault();
            onAction({ kind: "configure", settings });
          }}
        >
          <label className="eq-field">
            Room name
            <input
              value={settings.name}
              maxLength={160}
              required
              onChange={(e) => setSettings({ ...settings, name: e.target.value })}
            />
          </label>
          <div className="live-config-sides">
            {(["A", "B"] as const).map((side) => (
              <fieldset key={side} className="live-config-side">
                <legend>Player {side}</legend>
                <label className="eq-field">
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
                  <label className="eq-field">
                    Registered player
                    <select
                      value={settings[side === "A" ? "playerAUserId" : "playerBUserId"] ?? ""}
                      onChange={(e) =>
                        setSettings({
                          ...settings,
                          [side === "A" ? "playerAUserId" : "playerBUserId"]:
                            e.target.value || null,
                        })
                      }
                    >
                      <option value="">Open seat</option>
                      {![...directory.players].some(
                        (p) => p.id === settings[side === "A" ? "playerAUserId" : "playerBUserId"],
                      ) &&
                        settings[side === "A" ? "playerAUserId" : "playerBUserId"] && (
                          <option
                            value={settings[side === "A" ? "playerAUserId" : "playerBUserId"]!}
                          >
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
                <label className="eq-field">
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
          </div>
          <label className="eq-field">
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
          <div className="live-tool-actions">
            <button type="submit" className="eq-button eq-button-primary" disabled={busy}>
              Save configuration and redeal
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

/** Direct-game pause requests and answers, as the legacy stop-request sheets. */
export function PauseSheets({
  match,
  busy,
  onAction,
}: {
  match: LiveGameView;
  busy: boolean;
  onAction(action: LiveControl): void;
}) {
  // Closing the answer only hides it here; Acknowledge clears it for good.
  const [hiddenResponseId, setHiddenResponseId] = useState<string | null>(null);
  const request = match.matchControl?.stopRequest,
    response = match.matchControl?.stopResponse;
  const incoming = Boolean(match.directPause && request && request.requestedBy !== match.yourSide);
  const answered = Boolean(
    match.directPause &&
    response &&
    response.requestedBy === match.yourSide &&
    response.id !== hiddenResponseId,
  );
  return (
    <>
      <Sheet dismissible={false} open={incoming} title="Pause request" onClose={() => undefined}>
        {request && (
          <>
            <p className="ui-confirm-consequence" role="status">
              {match.players[request.requestedBy]} requested a pause.
            </p>
            <div className="ui-sheet-actions stop-request-actions">
              <button
                type="button"
                className="ui-button-primary"
                disabled={busy}
                onClick={() =>
                  onAction({ kind: "respond-pause", requestId: request.id, accept: true })
                }
              >
                Accept pause
              </button>
              <button
                type="button"
                className="ui-button-ghost"
                disabled={busy}
                onClick={() =>
                  onAction({ kind: "respond-pause", requestId: request.id, accept: false })
                }
              >
                Decline pause
              </button>
              <button
                type="button"
                className="ui-button-danger"
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
            </div>
          </>
        )}
      </Sheet>
      <Sheet
        open={answered}
        title={response?.accepted ? "Pause accepted" : "Pause declined"}
        onClose={() => setHiddenResponseId(response?.id ?? null)}
      >
        {response && (
          <>
            <p className="ui-confirm-consequence" role="status">
              Pause {response.accepted ? "accepted" : "declined"}
              {response.blockedForMs ? " · requests blocked for 5 minutes" : ""}.
            </p>
            <div className="ui-sheet-actions">
              <button
                type="button"
                className="ui-button-primary"
                disabled={busy}
                onClick={() => onAction({ kind: "acknowledge-pause", responseId: response.id })}
              >
                Acknowledge response
              </button>
            </div>
          </>
        )}
      </Sheet>
    </>
  );
}

export function HistoryControls({
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
  const [note, setNote] = useState(selectedLog?.note ?? "");
  const [stars, setStars] = useState(selectedLog?.stars ?? 0);
  if (match.continuationBlocked || match.status === "finished" || !match.canEditHistory)
    return null;
  return (
    <ToolSection title="History">
      <div className="live-tool-actions">
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={busy || !match.canUndo}
          onClick={() => onAction({ kind: "undo" })}
        >
          Undo committed change
        </button>
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={busy || !match.canRedo}
          onClick={() => onAction({ kind: "redo" })}
        >
          Redo committed change
        </button>
      </div>
      {selectedLog && (
        <>
          {allowBranches && (
            <div className="live-tool-actions">
              <button
                type="button"
                className="eq-button eq-button-secondary"
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
                className="eq-button eq-button-secondary"
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
            </div>
          )}
          <form
            className="live-tool-form"
            onSubmit={(e) => {
              e.preventDefault();
              onAction({ kind: "annotate", logId: selectedLog.id, note, stars });
            }}
          >
            <label className="eq-field">
              Turn note
              <textarea maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="eq-field">
              Stars
              <select value={stars} onChange={(e) => setStars(Number(e.target.value))}>
                {[0, 1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="live-tool-actions">
              <button type="submit" className="eq-button eq-button-secondary" disabled={busy}>
                Save annotation
              </button>
            </div>
          </form>
        </>
      )}
      {allowBranches &&
        match.timeline?.lines.map((line) => (
          <fieldset key={line.id} className="live-tool-line">
            <legend>Alternate line</legend>
            <div className="live-tool-actions">
              {line.logs.map((log) => (
                <button
                  key={log.id}
                  type="button"
                  className="eq-button eq-button-secondary"
                  onClick={() => onSelectLog(log.id)}
                >
                  View T{log.turnNumber} · {log.side}
                </button>
              ))}
            </div>
            <div className="live-tool-actions">
              <button
                type="button"
                className="eq-button eq-button-secondary"
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
                className="eq-button eq-button-danger"
                disabled={busy}
                onClick={() => onAction({ kind: "prune", lineId: line.id })}
              >
                Prune alternate line
              </button>
            </div>
          </fieldset>
        ))}
    </ToolSection>
  );
}
