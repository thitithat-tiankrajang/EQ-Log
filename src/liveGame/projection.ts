/** Trusted-server allowlist. Never project a private inventory into a browser GameState. */
import { calculateGameTotals, type GameState, type Side, type TileInstance } from "../game";
import { rankedPublicView, type RankedMatchView } from "../features/ranked/publicView";
import type { LiveCapabilities } from "./capabilities";
import { launchReady } from "./controls";
import type { LiveAuthorityFacts } from "./capabilities";
import type { Multiverse } from "../gameplay/multiverse";
import { buildTree, pathTo } from "../gameplay/multiverse";
import type { RankedTurnView } from "../features/ranked/publicView";
import { buildArchBotRequest } from "../bot/archbot/request";
import type { ArchBotRequest } from "../bot/archbot/decide";

export type LiveGameView = RankedMatchView & {
  name: string;
  mode: string;
  clockPolicy: { minSeconds: number; untimed: Partial<Record<Side, boolean>> };
  botSide?: Side;
  botTurn: boolean;
  paused: boolean;
  canAdminister: boolean;
  continuationBlocked: boolean;
  phase: GameState["phase"];
  tileDrawMode: "manual" | "play";
  hostRacks?: Record<Side, TileInstance[]>;
  localHandoff: boolean;
  canHandoff: boolean;
  localConfirmed: boolean;
  canConfigure: boolean;
  canLaunch: boolean;
  canRename: boolean;
  canEditHistory: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canSaveExit: boolean;
  directPause: boolean;
  matchControl?: GameState["matchControl"];
  launchAt?: string;
  waitingSettings?: import("./controls").WaitingConfiguration;
  timeline?: {
    version: number;
    lines: { id: string; from: string | null; logs: RankedTurnView[] }[];
  };
  practiceBot?: { side: Side; request: ArchBotRequest };
  /** Phase B: this viewer is a seat in a game where tentative tiles are relayed (server-derived). */
  tentativeSync?: boolean;
};

import { visibleBoard, ownTiles } from "../gameplay/publicTiles";
import { tentativeSyncAllowed } from "./tentative";

/** viewerSide is resolved from frozen server seats, never request JSON. */
export function projectLiveGame(
  id: string,
  revision: number,
  game: GameState,
  viewerSide: Side | null,
  mode: string,
  canAdminister = false,
  continuationBlocked = false,
  capabilities?: LiveCapabilities,
  timeline?: Multiverse,
  facts?: LiveAuthorityFacts,
): LiveGameView {
  // Reuse the existing seat allowlist, but replace identity-bearing board cells
  // and explicitly build every log; no spreading private log/actionDetail data.
  const viewer = viewerSide ? `seat:${viewerSide}` : "spectator";
  const view = rankedPublicView(
    id,
    revision,
    {
      ...game,
      playerUserIds: {
        A: "seat:A",
        ...(game.playerUserIds?.B || game.botSide || mode === "local_versus"
          ? { B: "seat:B" }
          : {}),
      },
    },
    viewer,
  );
  const tree = buildTree(game.logs, timeline ?? { version: 0, lines: [] });
  const projectLog = (log: GameState["logs"][number], opponentCount: number): RankedTurnView => {
    const preceding = pathTo(tree, tree.nodes.get(log.id)?.parentId ?? null);
    let noScoreStreak = 0;
    for (const prior of [...preceding].reverse()) {
      if (prior.finalScore > 0) break;
      noScoreStreak++;
    }
    return {
      ...liveLog(log, viewerSide),
      ...(viewerSide === log.side
        ? {
            analysisContext: {
              bagCount: log.tilebagBefore.length,
              oppRackCount: opponentCount,
              scores: calculateGameTotals(game, preceding),
              noScoreStreak,
            },
          }
        : {}),
    };
  };
  return {
    ...view,
    status:
      game.roomStage === "waiting"
        ? mode === "local_versus" ||
          game.gameMode === "solo" ||
          game.botSide ||
          (game.playerUserIds?.A && game.playerUserIds?.B)
          ? "matched"
          : "waiting"
        : view.status,
    name: mode === "stage" ? "Stage attempt" : game.name,
    mode,
    botSide: game.botSide,
    botTurn: game.status === "playing" && !game.timers.paused && game.activeSide === game.botSide,
    ...(facts?.purpose === "normal" &&
    mode === "stage5b_standard" &&
    game.botEngine === "stage5b" &&
    game.botDifficulty === "stage5b64" &&
    facts.ownerId === facts.seats[viewerSide ?? "A"] &&
    viewerSide &&
    game.status === "playing" &&
    !game.timers.paused &&
    game.activeSide === game.botSide
      ? { practiceBot: { side: game.botSide!, request: buildArchBotRequest(game, id, revision) } }
      : {}),
    paused: game.status === "draft" || game.timers.paused,
    canAdminister,
    continuationBlocked,
    phase: game.phase,
    tileDrawMode: game.tileDrawMode ?? "play",
    localHandoff: capabilities?.localHandoff ?? false,
    canHandoff: capabilities?.localController ?? false,
    localConfirmed: capabilities?.localConfirmed ?? false,
    canConfigure: capabilities?.configure ?? false,
    canLaunch: Boolean(capabilities?.configure && facts && launchReady(facts, game)),
    canRename: Boolean(
      capabilities?.configure ||
      capabilities?.editHistory ||
      canAdminister ||
      (facts && facts.ownerId === facts.seats[viewerSide ?? "A"] && viewerSide),
    ),
    canEditHistory: capabilities?.editHistory ?? false,
    canUndo: Boolean(
      capabilities?.editHistory &&
      game.historyIndex > 0 &&
      game.history[game.historyIndex - 1]?.roomStage !== "waiting",
    ),
    canRedo: Boolean(capabilities?.editHistory && game.historyIndex < game.history.length - 1),
    canSaveExit: Boolean(capabilities?.administer && !game.emailPlayMode),
    directPause: Boolean(
      game.emailPlayMode === "direct" && !game.botSide && viewerSide && !continuationBlocked,
    ),
    tentativeSync: Boolean(
      viewerSide &&
      facts &&
      !continuationBlocked &&
      tentativeSyncAllowed(
        {
          id,
          revision,
          mode,
          purpose: facts.purpose,
          authorityProtocol: facts.authorityProtocol,
          seats: facts.seats,
        },
        game,
      ),
    ),
    matchControl: game.matchControl
      ? {
          stopRequest: game.matchControl.stopRequest,
          stopResponse: game.matchControl.stopResponse,
          stopBlockedUntilBySide: game.matchControl.stopBlockedUntilBySide,
          stoppedBy: game.matchControl.stoppedBy,
          surrenderedSide: game.matchControl.surrenderedSide,
        }
      : undefined,
    launchAt: game.lobbyLaunchAt,
    ...(capabilities?.configure
      ? {
          waitingSettings: {
            name: game.name,
            playerA: game.players.A,
            playerB: game.players.B,
            playerAUserId: game.playerUserIds?.A,
            playerBUserId: game.playerUserIds?.B,
            startingSide: game.startingSide ?? "A",
            timerMinutes: {
              A:
                game.timers.untimed || game.timers.sideUntimed?.A
                  ? null
                  : (game.timers.initialSecondsBySide?.A ?? game.timers.initialSeconds) / 60,
              B:
                game.timers.untimed || game.timers.sideUntimed?.B
                  ? null
                  : (game.timers.initialSecondsBySide?.B ?? game.timers.initialSeconds) / 60,
            },
          },
        }
      : {}),
    ...(capabilities?.editHistory && timeline
      ? {
          timeline: {
            version: timeline.version,
            lines: timeline.lines.map((line) => ({
              id: line.id,
              from: line.from,
              logs: line.logs.map((log, index) =>
                projectLog(
                  log,
                  line.after[index]?.[viewerSide === "A" ? "rackB" : "rackA"].length ?? 8,
                ),
              ),
            })),
          },
        }
      : {}),
    ...(capabilities?.physicalHost && game.roomStage !== "waiting"
      ? { hostRacks: { A: ownTiles(game.rackA), B: ownTiles(game.rackB) } }
      : {}),
    clockPolicy: {
      minSeconds: game.timers.minSeconds,
      untimed: {
        A: Boolean(game.timers.untimed || game.timers.sideUntimed?.A),
        B: Boolean(game.timers.untimed || game.timers.sideUntimed?.B),
      },
    },
    playerAId: game.playerUserIds?.A ?? "",
    playerBId: game.playerUserIds?.B ?? null,
    board: visibleBoard(game.board),
    yourRack:
      viewerSide && game.roomStage !== "waiting"
        ? ownTiles(viewerSide === "A" ? game.rackA : game.rackB)
        : [],
    logs: game.logs.map((log, index) =>
      projectLog(
        log,
        game.history.find((snapshot) => snapshot.logs.length === index + 1)?.[
          viewerSide === "A" ? "rackB" : "rackA"
        ].length ?? 8,
      ),
    ),
  };
}

function liveLog(log: GameState["logs"][number], viewerSide: Side | null): RankedTurnView {
  return {
    id: log.id,
    turnNumber: log.turnNumber,
    side: log.side,
    action: log.action,
    score: log.finalScore,
    exchangedCount:
      log.action === "exchange"
        ? ((log.actionDetail as { outgoingTiles?: TileInstance[] }).outgoingTiles?.length ?? 0)
        : 0,
    boardAfter: visibleBoard(log.boardAfter),
    boardBefore: visibleBoard(log.boardBefore),
    note: log.note,
    stars: log.stars,
    ...(viewerSide === log.side
      ? { rackBefore: ownTiles(log.rackBefore), rackAfter: ownTiles(log.rackAfter) }
      : {}),
  };
}
