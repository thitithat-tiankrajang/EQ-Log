import { decodeGame, encodeGame, type EncodedGame } from "../../../src/codec";
import { makeSnapshot, pushActionSnapshot, type GameState, type Side } from "../../../src/game";
import { applyRankedAction, type RankedAction } from "../../../src/features/ranked/rules";
import { projectLiveGame, type LiveGameView } from "../../../src/liveGame/projection";

import { applyHostedAction, type HostedAction } from "../../../src/liveGame/hostedAdmin";
import { resolveLiveCapabilities, type LocalTurnClaim } from "../../../src/liveGame/capabilities";
import { applyPhysicalAction, type PhysicalAction } from "../../../src/liveGame/physical";
import {
  applyLiveControl,
  canControlLive,
  ensureHistory,
  type LiveControl,
} from "../../../src/liveGame/controls";
import {
  EMPTY_MULTIVERSE,
  buildTree,
  equivalentParkedChild,
  continueFrom,
  type Multiverse,
} from "../../../src/gameplay/multiverse";
import { botActionFor, type TrustedBotMove } from "../../../src/liveGame/botAction";

export type LiveCommand =
  | RankedAction
  | HostedAction
  | PhysicalAction
  | LiveControl
  | { kind: "record"; side: Side; move: RankedAction };

export type LiveSource = {
  id: string;
  ownerId: string;
  seats: Partial<Record<Side, string>>;
  revision: number;
  mode: string;
  purpose: string;
  authorityProtocol: string;
  bot?: { catalogId: string; catalogVersion: string; difficulty?: string };
  state: EncodedGame;
  localClaim?: LocalTurnClaim;
  timeline?: Multiverse;
};
export type LiveStore = {
  authenticate(token: string): Promise<string | null>;
  read(id: string, actorId: string): Promise<LiveSource | null>;
  committed(id: string, commandId: string, actorId: string): Promise<boolean>;
  commit(
    source: LiveSource,
    actorId: string,
    commandId: string,
    side: Side | "host",
    action: LiveCommand,
    game: GameState,
    timeline?: Multiverse,
  ): Promise<boolean>;
};
type Reply = { status: number; body: { error?: string; match?: LiveGameView } };

/** The store authenticates and authorizes reads; no request-supplied seat/owner is used. */
export async function handleLiveGame(
  request: { authorization: string | null; body: unknown },
  store: LiveStore,
  trustedBot = false,
): Promise<Reply> {
  const token = request.authorization?.match(/^Bearer (.+)$/i)?.[1];
  const actorId = token ? await store.authenticate(token) : null;
  if (!actorId) return { status: 401, body: { error: "Sign in required." } };
  const body = request.body as Record<string, unknown> | null;
  if (
    !body ||
    typeof body.id !== "string" ||
    !["read", "action", "admin", "physical", "control", "practice-bot"].includes(
      String(body.operation),
    )
  )
    return { status: 400, body: { error: "Invalid live request." } };
  const source = await store.read(body.id, actorId);
  if (!source) return { status: 404, body: { error: "Live game unavailable." } };
  const prior = { ...decodeGame(source.state), playerUserIds: source.seats };
  const capabilities = resolveLiveCapabilities(
    source,
    prior,
    actorId,
    body.handoffToken,
    trustedBot,
  );
  const side = capabilities.side;
  const host = capabilities.administer;
  const view = () =>
    projectLiveGame(
      source.id,
      source.revision,
      prior,
      side,
      source.mode,
      host,
      source.authorityProtocol !== "server-v1",
      capabilities,
      source.timeline,
      source,
    );
  if (body.operation === "read") return { status: 200, body: { match: view() } };
  if (source.authorityProtocol !== "server-v1")
    return {
      status: 409,
      body: { error: "This game cannot accept moves. Please start a new game." },
    };
  const control = body.operation === "control";
  const practiceBot = body.operation === "practice-bot";
  if (
    practiceBot &&
    !(
      source.ownerId === actorId &&
      source.purpose === "normal" &&
      source.mode === "stage5b_standard" &&
      prior.botEngine === "stage5b" &&
      prior.botDifficulty === "stage5b64" &&
      prior.botSide
    )
  )
    return { status: 403, body: { error: "ArchBot practice controller required." } };
  if (body.operation === "admin" && !host)
    return { status: 403, body: { error: "Only the tournament host may administer this game." } };
  if (
    body.operation === "physical" &&
    !(
      capabilities.physicalHost ||
      (capabilities.localController && prior.tileDrawMode === "manual")
    )
  )
    return { status: 403, body: { error: "Physical controller required." } };
  if (body.operation === "action" && !side && !capabilities.localController)
    return { status: 403, body: { error: "Only a seated player may act." } };
  if (typeof body.commandId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.commandId))
    return { status: 400, body: { error: "A stable command ID is required." } };
  if (await store.committed(source.id, body.commandId, actorId))
    return { status: 200, body: { match: view() } };
  if (
    control &&
    !canControlLive(
      source,
      prior,
      capabilities,
      actorId,
      String((body.action as LiveControl)?.kind),
    )
  )
    return { status: 403, body: { error: "This control is unavailable for your role." } };
  if (body.operation === "physical" && !capabilities.physicalHost && !capabilities.localConfirmed)
    return { status: 403, body: { error: "Confirm the active local player first." } };
  if (body.operation === "action" && !side)
    return { status: 403, body: { error: "Confirm the active local player first." } };
  if (body.revision !== source.revision)
    return { status: 409, body: { error: "Game changed. Reload and retry.", match: view() } };
  try {
    const action = practiceBot
      ? botActionFor(prior, body.action as TrustedBotMove)
      : (body.action as LiveCommand);
    const administration = body.operation === "admin";
    const physical = body.operation === "physical";
    const recording = administration && action?.kind === "record";
    if (
      !action ||
      (!control &&
        !(
          physical
            ? ["refill", "correct-rack", "return-tile"]
            : administration
              ? ["pause", "resume", "finish", "correct-score", "record"]
              : ["place", "exchange", "pass", "resign"]
        ).includes(action.kind))
    )
      return { status: 400, body: { error: "Invalid live action." } };
    if (recording && !capabilities.physicalHost)
      return { status: 403, body: { error: "Physical host required." } };
    if (
      recording &&
      (!(action as { side: Side }).side ||
        !["A", "B"].includes((action as { side: Side }).side) ||
        !["place", "exchange", "pass", "resign"].includes(
          (action as { move: RankedAction }).move?.kind,
        ))
    )
      return { status: 400, body: { error: "Invalid recorded action." } };
    if (physical && !capabilities.physicalHost && (action as PhysicalAction).side !== side)
      return { status: 403, body: { error: "Only the active local rack may be recorded." } };
    const now = new Date().toISOString();
    // Rules operate only on the stored private state. Browser state/score/history
    // fields are ignored, and the hidden queue is never sent back for calculation.
    const controlled = control
      ? applyLiveControl(
          ensureHistory(prior),
          source.timeline ?? EMPTY_MULTIVERSE,
          source,
          capabilities,
          action as LiveControl,
          now,
        )
      : null;
    const next = controlled
      ? controlled.game
      : physical
        ? applyPhysicalAction(prior, action as PhysicalAction)
        : recording
          ? applyRankedAction(
              prior,
              (action as { side: Side }).side,
              (action as { move: RankedAction }).move,
              now,
              "normal",
            )
          : administration
            ? applyHostedAction(prior, action as HostedAction, now)
            : applyRankedAction(
                prior,
                practiceBot ? prior.botSide! : side!,
                action as RankedAction,
                now,
                "normal",
              );
    if (action.kind === "resign")
      next.matchControl = { ...next.matchControl, surrenderedSide: side };
    let game = {
      ...next,
      revision: source.revision + 1,
    };
    let timeline = controlled?.timeline;
    if (!control)
      game = pushActionSnapshot({
        ...game,
        history: prior.history.length ? prior.history : [makeSnapshot(prior)],
        historyIndex: prior.history.length ? prior.historyIndex : 0,
      });
    // Replaying a stored public move follows the existing twin privately. No
    // parked rack or proposal is sent to the caller for matching.
    if (
      !control &&
      game.logs.length > prior.logs.length &&
      source.timeline?.lines.length &&
      capabilities.editHistory
    ) {
      const twin = equivalentParkedChild(
        buildTree(prior.logs, source.timeline),
        prior.logs.at(-1)?.id ?? null,
        game.logs.at(-1)!,
      );
      if (twin) {
        const followed = continueFrom(
          prior,
          source.timeline,
          { nodeId: twin, phase: "after" },
          { now },
        );
        if (followed.ok && followed.changed) {
          game = { ...followed.game, revision: source.revision + 1 };
          timeline = followed.multiverse;
        }
      }
    }
    if (
      !(await store.commit(
        source,
        actorId,
        body.commandId,
        practiceBot
          ? prior.botSide!
          : control || administration || (physical && capabilities.physicalHost)
            ? "host"
            : side!,
        action,
        game,
        timeline,
      ))
    )
      return { status: 409, body: { error: "Game changed. Reload and retry." } };
    const nextFacts = {
      ...source,
      revision: game.revision!,
      seats: game.playerUserIds ?? source.seats,
      localClaim: undefined,
    };
    const nextCapabilities = resolveLiveCapabilities(
      nextFacts,
      game,
      actorId,
      undefined,
      trustedBot,
    );
    return {
      status: 200,
      body: {
        match: projectLiveGame(
          source.id,
          game.revision!,
          game,
          nextCapabilities.side,
          source.mode,
          nextCapabilities.administer,
          false,
          nextCapabilities,
          timeline ?? source.timeline,
          nextFacts,
        ),
      },
    };
  } catch {
    // Validation errors must not echo private rack/queue objects or token names.
    return { status: 400, body: { error: "Move refused. Reload and check your move." } };
  }
}

export { encodeGame };
