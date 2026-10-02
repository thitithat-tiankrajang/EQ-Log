/** Stage-only adapter for a trusted server. The live move stream is still client-computed. */
import { decodeGame, type EncodedGame } from "../codec";
import {
  boardWithPending,
  getAssignmentOptions,
  getRack,
  validateMove,
  type GameState,
  type PendingPlacement,
  type PlaceEquationDetail,
  type Side,
} from "../game";
import { canonicalFromSnapshot, encodeCanonical } from "../domain/projection";
import { deriveCompletion } from "../features/gameRecords/domain";
import { createAutomaticEndGameLog } from "../gameplay/endGame";
import type { Multiverse } from "../gameplay/multiverse";
import { buildStageCompletedGameRecord, type StageSealedStart } from "./adapters";
import {
  canonicalCompletedJSON,
  readCompletedGameRecord,
  type CompletedGameRecordV1,
} from "./record";

export type StageTerminalSource = {
  roomId: string;
  ownerId: string;
  levelId: string;
  seed: number;
  revision: number;
  liveState: EncodedGame;
  sealedStart: StageSealedStart;
  completionAuthority?: "client-reported" | "server-reduced";
  botKey: string;
  botConfigVersion: number;
  botDifficulty: string;
  branches?: Multiverse;
};

export type PreparedStageTerminal = {
  record: CompletedGameRecordV1;
  state: EncodedGame;
  completion: ReturnType<typeof deriveCompletion>;
  outcome: "win" | "loss" | "tie";
  scores: Record<Side, number>;
};

function equal(a: unknown, b: unknown): boolean {
  return canonicalCompletedJSON(a) === canonicalCompletedJSON(b);
}

function facts(game: GameState): unknown {
  const canonical = encodeCanonical(canonicalFromSnapshot(game, 0));
  return {
    inventory: canonical.inventory,
    scores: canonical.scores,
    turnNumber: canonical.turnNumber,
    activeSide: canonical.activeSide,
    status: canonical.status,
  };
}

/**
 * Bind a terminal browser state to the latest committed live prefix, sealed
 * opening and immutable Compact record. This rejects terminal-only rewrites
 * of prior actions. It does not independently rescore earlier client moves.
 */
export async function prepareStageTerminal(
  source: StageTerminalSource,
  state: EncodedGame,
): Promise<PreparedStageTerminal> {
  if (state.v !== 3 || source.liveState.v !== 3)
    throw new Error("Stage capture requires identity-preserving live format v3.");
  const prior = decodeGame(source.liveState);
  const final = decodeGame(state);
  if (
    !prior.gameId ||
    final.gameId !== prior.gameId ||
    prior.playerUserIds?.A !== source.ownerId ||
    final.playerUserIds?.A !== source.ownerId ||
    final.status !== "finished" ||
    prior.status === "finished" ||
    source.revision < 1 ||
    final.revision !== source.revision + 1
  )
    throw new Error("Stage terminal state or revision is invalid.");
  if (
    final.logs.length < prior.logs.length ||
    !equal(final.logs.slice(0, prior.logs.length), prior.logs) ||
    final.history.length < prior.history.length ||
    !equal(final.history.slice(0, prior.history.length), prior.history)
  )
    throw new Error("Stage terminal rewrote committed play.");
  const added = final.logs.slice(prior.logs.length);
  if (added.length > 2 || (added[0] && added[0].side !== prior.activeSide))
    throw new Error("Stage terminal does not follow the committed turn.");
  if (added[0]) {
    const rack = added[0].side === "A" ? prior.rackA : prior.rackB;
    if (
      !equal(added[0].boardBefore, prior.board) ||
      !equal(added[0].rackBefore, rack) ||
      !equal(added[0].tilebagBefore, prior.tilebag)
    )
      throw new Error("Stage terminal action does not start at the committed position.");
  } else if (!equal(facts(final), { ...(facts(prior) as object), status: "finished" })) {
    throw new Error("Stage terminal changed position without an action.");
  }
  const completion = deriveCompletion(final);
  if (completion.kind === "natural") {
    const normal = added[0];
    const end = added[1];
    if (
      added.length !== 2 ||
      !normal ||
      !end ||
      end.action !== "end_game" ||
      !["place_equation", "pass", "exchange"].includes(normal.action)
    )
      throw new Error("Natural Stage completion needs its triggering action.");
    if (
      normal.turnNumber !== prior.turnNumber ||
      normal.side !== prior.activeSide ||
      prior.tilebag.length !== 0
    )
      throw new Error("Stage terminal turn or sealed empty bag is invalid.");
    if (normal.action === "place_equation") {
      const detail = normal.actionDetail as PlaceEquationDetail;
      const used = new Set<string>();
      const rack = getRack(prior, prior.activeSide);
      const placements: PendingPlacement[] = (detail.placedTiles ?? []).map((item) => {
        const tile = rack.find((candidate) => candidate.id === item.tileId);
        if (!tile || used.has(item.tileId) || tile.token !== item.token)
          throw new Error("Stage terminal used an unavailable tile.");
        const choices = getAssignmentOptions(tile.token);
        if (
          choices.length ? !choices.includes(item.assignedToken ?? "") : Boolean(item.assignedToken)
        )
          throw new Error("Stage terminal used an invalid tile assignment.");
        used.add(item.tileId);
        return { tile, row: item.row, col: item.col, assignedToken: item.assignedToken };
      });
      const checked = validateMove(prior.board, placements);
      if (
        !checked.isValid ||
        normal.manualScore !== undefined ||
        normal.calculatedScore !== checked.score ||
        normal.finalScore !== checked.score ||
        !equal(
          normal.boardAfter,
          boardWithPending(prior.board, placements, prior.turnNumber, prior.activeSide),
        ) ||
        !equal(
          normal.rackAfter,
          rack.filter((tile) => !used.has(tile.id)),
        ) ||
        !equal(normal.tilebagAfter, prior.tilebag)
      )
        throw new Error("Stage terminal placement or score is not rules-derived.");
    } else if (normal.action === "pass") {
      if (
        normal.calculatedScore !== 0 ||
        normal.finalScore !== 0 ||
        normal.manualScore !== undefined ||
        !equal(normal.boardAfter, prior.board) ||
        !equal(normal.rackAfter, getRack(prior, prior.activeSide)) ||
        !equal(normal.tilebagAfter, prior.tilebag)
      )
        throw new Error("Stage terminal pass changed the position or score.");
    } else {
      throw new Error("Stage's sealed empty bag cannot support an exchange.");
    }
    const expected = createAutomaticEndGameLog({
      boardAfter: normal.boardAfter,
      game: prior,
      logs: [...prior.logs, normal],
      normalLog: normal,
      rackAfter: normal.rackAfter,
      tilebagAfter: normal.tilebagAfter,
    });
    if (
      !expected ||
      !equal(end.actionDetail, expected.actionDetail) ||
      end.finalScore !== expected.finalScore ||
      end.side !== expected.side ||
      !equal(end.boardAfter, normal.boardAfter) ||
      !equal(final.board, normal.boardAfter) ||
      !equal(final.tilebag, normal.tilebagAfter) ||
      !equal(getRack(final, prior.activeSide), normal.rackAfter)
    )
      throw new Error("Stage terminal reason does not follow the saved game rules.");
  } else if (completion.reason === "surrender") {
    if (
      completion.surrenderedSide !== "A" ||
      added.length !== 1 ||
      added[0]?.action !== "end_game" ||
      !equal(final.scores, prior.scores)
    )
      throw new Error("Invalid Stage surrender.");
  } else if (added.length !== 0) {
    throw new Error("A manual Stage ending cannot append gameplay actions.");
  }
  const record = await buildStageCompletedGameRecord(final, {
    levelId: source.levelId,
    seed: source.seed,
    sealedStart: source.sealedStart,
    branches: source.branches,
    completionAuthority: source.completionAuthority,
    bot: {
      catalogId: source.botKey,
      catalogVersion: String(source.botConfigVersion),
      difficulty: source.botDifficulty,
    },
  });
  const replay = await readCompletedGameRecord(record);
  if (
    !equal(facts(replay.game), facts(final)) ||
    replay.game.logs.length !== final.logs.length ||
    replay.game.history.length !== final.history.length
  )
    throw new Error("Stage Compact replay does not reproduce its terminal position.");
  const outcome =
    completion.kind !== "natural" || completion.surrenderedSide === "A"
      ? "loss"
      : final.scores.A > final.scores.B
        ? "win"
        : final.scores.A < final.scores.B
          ? "loss"
          : "tie";
  return {
    record,
    state,
    completion,
    outcome,
    scores: { A: final.scores.A, B: final.scores.B },
  };
}
