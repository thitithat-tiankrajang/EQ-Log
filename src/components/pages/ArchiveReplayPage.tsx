import { useEffect, useMemo, useState } from "react";
import { ApplicationShell } from "../../app/shells/ApplicationShell";
import { Board } from "../board/Board";
import { useBoardStyles } from "./study/useBoardStyles";
import { createBoard, type AmathToken, type BoardSnapshot } from "../../game";
import { readSafeArchiveReplay } from "../../completedGame/client";
import type { SafeArchiveReplay } from "../../completedGame/archiveRead";
import type { PublicBoardCell } from "../../completedGame/projection";
import { navigate, returnDestinationFor, useRoute } from "../../router";

const NO_CELL_CLICK = () => {};

/** Display-only identities are square labels, never stored physical tile IDs. */
function boardForDisplay(cells: readonly PublicBoardCell[]): BoardSnapshot {
  const board = createBoard();
  for (const cell of cells) {
    if (!board[cell.row] || cell.col < 0 || cell.col >= board[cell.row]!.length) continue;
    board[cell.row]![cell.col] = {
      tile: {
        id: `replay:${cell.row}:${cell.col}`,
        token: cell.kind as AmathToken,
        ...(cell.kind !== cell.face ? { assignedToken: cell.face } : {}),
      },
      side: cell.side,
      placedTurn: cell.turn,
    };
  }
  return board;
}

function clock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

export default function ArchiveReplayPage({
  initialReplay,
}: {
  initialReplay?: SafeArchiveReplay;
}) {
  useBoardStyles();
  const route = useRoute();
  const gameId = route.kind === "play" ? route.roomId : "";
  const [stored, setStored] = useState<SafeArchiveReplay | null>(initialReplay ?? null);
  const [error, setError] = useState<string | null>(null);
  const [branch, setBranch] = useState(-1);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let active = true;
    setStored(initialReplay?.archive.gameId === gameId ? initialReplay : null);
    setError(null);
    setBranch(-1);
    setIndex(0);
    if (initialReplay?.archive.gameId === gameId)
      return () => {
        active = false;
      };
    void readSafeArchiveReplay(gameId)
      .then((value) => {
        if (active) setStored(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to open replay.");
      });
    return () => {
      active = false;
    };
  }, [gameId, initialReplay]);

  const replay = stored?.replay;
  const trunk = useMemo(() => {
    if (!replay) return [];
    if (replay.positions.length > 1 || replay.turns.length === 0) return replay.positions;
    return [
      replay.positions[0]!,
      ...replay.turns.map((turn, turnIndex) => ({
        board: turn.board,
        scores: turnIndex === replay.turns.length - 1 ? replay.finalScores : null,
        clocks: turn.clockAfter,
        turn: turn.turn,
        side: turn.side,
      })),
    ];
  }, [replay]);
  const frames = branch < 0 ? trunk : (replay?.branches?.[branch]?.positions ?? []);
  const selected = frames[Math.min(index, frames.length - 1)];
  const board = useMemo(() => boardForDisplay(selected?.board ?? []), [selected]);
  const destination = returnDestinationFor(route) ?? {
    kind: "home" as const,
    visibility: "public" as const,
    section: "history" as const,
  };

  return (
    <ApplicationShell
      eyebrow="Completed game"
      title={stored?.archive.name ?? "Replay"}
      description={stored ? `${replay?.players.A} · ${replay?.players.B}` : undefined}
      onBack={() => navigate(destination)}
      backLabel="Back"
    >
      {error ? <p role="alert">{error}</p> : null}
      {!stored && !error ? <p role="status">Opening replay…</p> : null}
      {stored && replay && selected ? (
        <section aria-label="Completed game replay">
          <div className="eq-section-heading">
            <div>
              <span className="eq-eyebrow">{stored.archive.scope} replay</span>
              <h2>
                {branch < 0
                  ? `Position ${index} of ${frames.length - 1}`
                  : `Variation ${branch + 1}, position ${index + 1}`}
              </h2>
            </div>
            <span>
              {selected.scores
                ? `${replay.players.A} ${selected.scores.A} · ${replay.players.B} ${selected.scores.B}`
                : `${replay.players.A} ${replay.finalScores.A} · ${replay.players.B} ${replay.finalScores.B} final`}
            </span>
          </div>
          <Board
            board={board}
            pendingPlacements={[]}
            selectedRackTileId={null}
            selectedPendingTileId={null}
            onCellClick={NO_CELL_CLICK}
          />
          <div className="eq-section-heading">
            <span>
              Clocks: {clock(selected.clocks.A)} · {clock(selected.clocks.B)}
            </span>
            <span>Turn {selected.turn}</span>
          </div>
          <div className="eq-form-row">
            <button
              type="button"
              className="eq-button"
              disabled={index <= 0}
              onClick={() => setIndex(index - 1)}
            >
              Previous
            </button>
            <input
              aria-label="Replay position"
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={index}
              onChange={(event) => setIndex(Number(event.target.value))}
            />
            <button
              type="button"
              className="eq-button"
              disabled={index >= frames.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              Next
            </button>
          </div>
          {replay.branches?.length ? (
            <div className="eq-form-row">
              <button
                type="button"
                className="eq-button"
                onClick={() => {
                  setBranch(-1);
                  setIndex(0);
                }}
              >
                Main game
              </button>
              {replay.branches.map((line, lineIndex) => (
                <button
                  key={lineIndex}
                  type="button"
                  className="eq-button"
                  onClick={() => {
                    setBranch(lineIndex);
                    setIndex(0);
                  }}
                >
                  Variation {lineIndex + 1} from{" "}
                  {line.fromTurn === null ? "unknown fork" : `turn ${line.fromTurn}`}
                </button>
              ))}
            </div>
          ) : null}
          {"racks" in selected && selected.racks ? (
            <p>
              Racks at this position: {replay.players.A}: {selected.racks.A.join(" ") || "empty"} ·{" "}
              {replay.players.B}: {selected.racks.B.join(" ") || "empty"}
            </p>
          ) : null}
          <p>
            Final racks: {replay.players.A}: {replay.finalRacks.A.join(" ") || "empty"} ·{" "}
            {replay.players.B}: {replay.finalRacks.B.join(" ") || "empty"}
          </p>
        </section>
      ) : null}
    </ApplicationShell>
  );
}
