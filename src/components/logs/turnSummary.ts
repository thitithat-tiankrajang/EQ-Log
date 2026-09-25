// One way of describing a turn, shared by the turn log, its fork drawer and the map, so the same
// move never reads two different ways in two places.
import {
  displayToken,
  type EndGameDetail,
  type ExchangeDetail,
  type PlaceEquationDetail,
  type TurnLog,
} from "../../game";
import { ACTION_LABELS } from "../../uiText";

/** The turn log's row text: "Place Equation · 12=4×3". */
export function summaryText(log: TurnLog): string {
  const label = ACTION_LABELS[log.action];
  if (log.action === "place_equation") {
    const detail = log.actionDetail as PlaceEquationDetail;
    const equation = detail.equationsDetected[0]?.expressionText;
    const placed = detail.placedTiles.length;
    if (equation) return `${label} · ${equation}`;
    return `${label} · ${placed} tiles`;
  }
  if (log.action === "exchange") {
    const detail = log.actionDetail as ExchangeDetail;
    const list = detail.outgoingTiles.map((tile) => displayToken(tile)).join(" ");
    if (!list && detail.concealedCount) return `${label} · ${detail.concealedCount} tiles`;
    return `${label} · ${list || "0 tiles"}`;
  }
  if (log.action === "end_game") {
    const detail = log.actionDetail as EndGameDetail;
    return `${label} · ${detail.bonusPoints} pts`;
  }
  return label;
}

/** A few characters for tight places: "12=4×3", "แลก 3", "ผ่าน". */
export function shortMove(log: TurnLog): string {
  if (log.action === "place_equation") {
    const detail = log.actionDetail as PlaceEquationDetail;
    const equation = detail.equationsDetected[0]?.expressionText;
    if (equation) return equation;
    return detail.placedTiles
      .map((tile) => tile.assignedToken ?? tile.displayToken ?? tile.token)
      .join(" ");
  }
  if (log.action === "exchange") {
    const detail = log.actionDetail as ExchangeDetail;
    return `แลก ${detail.outgoingTiles.length || detail.concealedCount || 0}`;
  }
  if (log.action === "end_game") return "จบเกม";
  return "ผ่าน";
}

/** Signed points for a turn: "+18", "0". */
export function scoreText(log: TurnLog): string {
  return log.finalScore > 0 ? `+${log.finalScore}` : String(log.finalScore);
}
