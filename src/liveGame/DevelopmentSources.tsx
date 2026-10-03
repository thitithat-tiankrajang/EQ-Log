import { useMemo, useEffect, useState } from "react";
import { createBoard, type AmathToken, type PendingPlacement } from "../game";
import { parseStudyPuzzleRoomId } from "../features/studyPuzzles/play";
import { studyPuzzleSource, type PlayerPuzzle } from "../features/studyPuzzles/api";
import { parseSurvivalRoomId } from "../features/survivalPlay/route";
import { survivalPlaytestSource } from "../features/survivalPlay/api";
import { survivalGameFromView } from "../features/survivalPlay/projection";
import { rankedPublicView, type RankedTurnView } from "../features/ranked/publicView";
import { RankedMatchPage } from "../components/pages/ranked/RankedMatchPage";
import { parseShellFixtureRoomId } from "./shell/fixtureRoute";
import ShellFixture from "./shell/dev/ShellFixture";
import { LivePractice } from "./LivePractice";
import { navigate } from "../router";

/** Development-only recipient sources. This module never imports the legacy
 * live App, remoteRooms, canonical decoding, or browser game persistence. */
export default function DevelopmentSources({ roomId }: { roomId: string }) {
  const fixture = parseShellFixtureRoomId(roomId);
  if (fixture) return <ShellFixture state={fixture.state} viewer={fixture.viewer} />;
  const study = parseStudyPuzzleRoomId(roomId);
  return study ? (
    <StudyPreview setId={study.setId} puzzleId={study.puzzleId} />
  ) : (
    <SurvivalPreview roomId={roomId} />
  );
}

function StudyPreview({ setId, puzzleId }: { setId: string; puzzleId: string }) {
  const [puzzle, setPuzzle] = useState<PlayerPuzzle | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    let alive = true;
    void studyPuzzleSource
      .play(setId, puzzleId)
      .then((p) => {
        if (alive) setPuzzle(p);
      })
      .catch((e) => {
        if (alive) setMessage(String(e));
      });
    return () => {
      alive = false;
    };
  }, [setId, puzzleId]);
  let log: RankedTurnView | null = null;
  if (puzzle) {
    const board = createBoard();
    puzzle.position.board.forEach((cell, index) => {
      board[cell.r][cell.c] = {
        tile: { id: `public-${index}`, token: cell.kind as AmathToken, assignedToken: cell.face },
        side: "B",
        placedTurn: 0,
      };
    });
    log = {
      id: puzzleId,
      turnNumber: puzzle.position.turnNumber,
      side: "A",
      action: "pass",
      score: 0,
      exchangedCount: 0,
      boardBefore: board,
      boardAfter: board,
      rackBefore: puzzle.position.rack.map((token, index) => ({
        id: `own-${index}`,
        token: token as AmathToken,
      })),
    };
  }
  async function submit(placements: PendingPlacement[]) {
    if (busy || submitted) return;
    setBusy(true);
    try {
      const result = await studyPuzzleSource.submit(
        setId,
        puzzleId,
        placements.map((p) => ({
          r: p.row,
          c: p.col,
          kind: p.tile.token,
          face: p.assignedToken ?? p.tile.token,
        })),
      );
      setMessage(`Valid placement · ${result.score} points`);
      setSubmitted(true);
    } catch (cause) {
      setMessage(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <h1>Study puzzle preview</h1>
      <p role="status">{message || (puzzle ? "Place one equation." : "Opening puzzle…")}</p>
      {log && (
        <LivePractice
          key={`${setId}:${puzzleId}`}
          log={log}
          onClose={() => navigate({ kind: "study" })}
          onSubmit={submitted ? undefined : (placements) => void submit(placements)}
          busy={busy}
        />
      )}
    </main>
  );
}

function SurvivalPreview({ roomId }: { roomId: string }) {
  const client = useMemo(() => {
    const route = parseSurvivalRoomId(roomId);
    let attemptId = route?.kind === "attempt" ? route.attemptId : null;
    let opening: ReturnType<typeof survivalPlaytestSource.start> | null = null;
    const view = (source: Awaited<ReturnType<typeof survivalPlaytestSource.read>>) => {
      // The pre-existing helper reconstructs public turns and own racks from
      // the recipient DTO. Its synthetic unseen partition is never returned.
      const game = survivalGameFromView(source).game;
      game.playerUserIds = { [source.seats.player]: "development-player" };
      return {
        match: {
          ...rankedPublicView(roomId, source.log.length, game, "development-player"),
          botTurn: source.status === "authur-to-move",
          mode: "survival_playtest",
          name: "Survival playtest",
          paused: false,
          clockPolicy: { minSeconds: 0, untimed: { A: true, B: true } },
        },
      };
    };
    return {
      async read() {
        if (!route) throw new Error("Invalid playtest route.");
        if (!attemptId) {
          opening ??= survivalPlaytestSource.start(route.kind === "level" ? route.levelId : "");
          const source = await opening;
          attemptId = source.attemptId;
          return view(source);
        }
        return view(await survivalPlaytestSource.read(attemptId));
      },
      async action(
        _id: string,
        _revision: number,
        action: import("../features/ranked/rules").RankedAction,
      ) {
        if (!attemptId) throw new Error("Playtest has not opened.");
        if (action.kind === "resign")
          throw new Error("Leave this development attempt using Save & Exit.");
        const move =
          action.kind === "place"
            ? {
                type: "place" as const,
                placements: action.placements.map((p) => ({
                  tileId: p.tileId,
                  cell: p.row * 15 + p.col,
                  face: p.assignedToken,
                })),
              }
            : action.kind === "exchange"
              ? { type: "exchange" as const, tileIds: action.tileIds }
              : { type: "pass" as const };
        return view(await survivalPlaytestSource.move(attemptId, move));
      },
      async botTurn() {
        if (!attemptId) throw new Error("Playtest has not opened.");
        return view(await survivalPlaytestSource.authur(attemptId));
      },
      ready: async () => {
        throw new Error("Playtest starts at the source.");
      },
      cancel: async () => {
        throw new Error("Development attempts remain at their source.");
      },
    };
  }, [roomId]);
  return (
    <RankedMatchPage matchId={roomId} client={client} ranked={false} title="Survival playtest" />
  );
}
