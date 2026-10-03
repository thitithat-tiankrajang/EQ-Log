import { BOARD_SIZE } from "../../constants/gameRules";
import { displayToken, type AmathToken, type BoardSnapshot, type Side } from "../../game";
import type { RankedMatchView } from "../../features/ranked/publicView";
import type { SafeArchiveReplay } from "../../completedGame/archiveRead";
import type { HistoryItem } from "../../features/gameRecords/history";

/**
 * Completion seen from a live screen that did not receive the final projection.
 *
 * Completion is atomic on the server: the live row is deleted in the same
 * transaction that writes the completed record and each participant's own
 * History row. A seat that did not make the final move (or whose own refresh
 * lost the race with its command's response) therefore cannot read the final
 * projection any more. Instead of jumping from the board to the Replay, its
 * screen shows the Result from data this viewer is already authorized to see:
 *
 *   - the completed game's public final board and scores (the safe archive
 *     replay the client was just handed), and
 *   - the viewer's OWN History row (`list_my_game_history`, server-reduced):
 *     the authoritative outcome, so a surrender is never misread as a score
 *     result. No reason is invented: the panel names the winner only.
 *
 * A viewer with no History row (a spectator) sees "Game over" with the final
 * scores and no winner claim. Nothing here reaches a hidden rack or the bag.
 */
export type ShellResult = { winner: Side | null; reason?: "score" | "resign" | "timeout" } | null;

export function finalBoard(replay: SafeArchiveReplay): BoardSnapshot {
  const board: BoardSnapshot = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => null),
  );
  for (const cell of replay.replay.finalBoard) {
    const token = cell.kind as AmathToken;
    const plain = displayToken({ id: "", token });
    board[cell.row]![cell.col] = {
      tile: {
        id: `final:${cell.row}:${cell.col}`,
        token,
        ...(cell.face !== plain ? { assignedToken: cell.face } : {}),
      },
      side: cell.side,
      placedTurn: cell.turn,
    };
  }
  return board;
}

/** The viewer's own authoritative outcome, as a winning side (null: draw; undefined: unknown). */
export function winnerFrom(row: Pick<HistoryItem, "outcome" | "participantSide"> | null) {
  if (!row?.outcome) return undefined;
  if (row.outcome === "draw") return null;
  const other: Side = row.participantSide === "A" ? "B" : "A";
  return row.outcome === "win" ? row.participantSide : other;
}

/**
 * The finished view a live screen shows after the completion it did not
 * receive. Keeps the revision, so the server's own final projection (when it
 * arrives, e.g. as the response to this seat's final command) replaces it.
 */
export function finishedFromArchive(
  current: RankedMatchView,
  replay: SafeArchiveReplay,
  history: Pick<HistoryItem, "outcome" | "participantSide"> | null,
): RankedMatchView {
  const winner = winnerFrom(history);
  return {
    ...current,
    status: "finished",
    board: finalBoard(replay),
    scores: { ...replay.replay.finalScores },
    result: (winner === undefined ? null : { winner }) as RankedMatchView["result"],
  };
}
