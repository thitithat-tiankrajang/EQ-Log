import {
  activeSideHasActedThisTurn,
  finalizeRefillTransition,
  getRack,
  isRackReady,
  setRack,
  type GameState,
  type Side,
  type TileInstance,
} from "../game";

export type PhysicalAction =
  | { kind: "refill"; side: Side; tokens: string[] }
  | { kind: "correct-rack"; side: Side; tokens: string[] }
  | { kind: "return-tile"; side: Side; tileId: string };

/** Physical tokens are selected internally from an unordered inventory. The
 * caller has explicit physical-controller authority, never a bag-order view. */
export function applyPhysicalAction(game: GameState, action: PhysicalAction): GameState {
  if (game.tileDrawMode !== "manual" || game.roomStage !== "playing" || game.status === "finished")
    throw new Error("Physical administration unavailable");
  if (action.side !== "A" && action.side !== "B") throw new Error("Invalid side");
  if (game.gameMode === "solo" && action.side !== "A") throw new Error("Invalid Solo side");
  const original = getRack(game, action.side);
  let rack = [...original],
    bag = [...game.tilebag];
  if (action.kind === "return-tile") {
    if (game.status !== "draft" && (game.phase !== "refill" || game.activeSide !== action.side))
      throw new Error("Pause before correcting a recorded rack");
    const tile = rack.find((t) => t.id === action.tileId);
    if (!tile) throw new Error("Invalid physical tile");
    rack = rack.filter((t) => t.id !== tile.id);
    bag.push({ id: tile.id, token: tile.token });
  } else {
    if (
      !Array.isArray(action.tokens) ||
      action.tokens.length > 8 ||
      !action.tokens.every((t) => typeof t === "string")
    )
      throw new Error("Invalid physical intake");
    if (action.kind === "correct-rack") {
      if (game.status !== "draft") throw new Error("Pause before correcting a recorded rack");
      bag.push(...rack.map(({ id, token }) => ({ id, token })));
      rack = [];
    }
    if (rack.length + action.tokens.length > 8) throw new Error("Rack capacity exceeded");
    const drawn: TileInstance[] = action.tokens.map((token) => {
      const index = bag.findIndex((tile) => tile.token === token);
      if (index < 0) throw new Error("Physical intake unavailable");
      const tile = bag.splice(index, 1)[0]!;
      return { id: tile.id, token: tile.token };
    });
    rack.push(...drawn);
  }
  let next = setRack({ ...game, tilebag: bag }, action.side, rack);
  if (game.activeSide === action.side && game.phase === "refill" && isRackReady(next)) {
    // The move's authoritative after-position includes its physical refill.
    if (activeSideHasActedThisTurn(game)) {
      const last = next.logs.length - 1;
      const pending = game.pendingExchangeReturnBySide?.[action.side] ?? [];
      bag = [...bag, ...pending];
      const pendingBySide = { ...game.pendingExchangeReturnBySide, [action.side]: [] };
      next = {
        ...next,
        tilebag: bag,
        pendingExchangeReturnBySide: pendingBySide,
        pendingExchangeReturn: [...(pendingBySide.A ?? []), ...(pendingBySide.B ?? [])],
        logs: next.logs.map((log, i) =>
          i === last
            ? {
                ...log,
                rackAfter: rack,
                tilebagAfter: bag,
                ...(log.action === "exchange"
                  ? {
                      actionDetail: {
                        ...log.actionDetail,
                        incomingTiles: rack.filter(
                          (t) => !log.rackBefore.some((old) => old.id === t.id),
                        ),
                      },
                    }
                  : {}),
              }
            : log,
        ),
      };
    }
    next = finalizeRefillTransition(next);
  }
  return next;
}
