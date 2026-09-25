// Does one position make a puzzle for this configuration? (DESIGN.md §4)
//
// Every failing criterion is reported, not only the first: the rejection counts
// are how an admin sees which constraint is the rare one.
import { compositionFailures, within as withinRange } from "./specification.mjs";
import { hasEquationProperty } from "./equation-facts.mjs";

export const within = withinRange;

/** Reasons the position itself is out, before its best play is looked at. */
export function positionRejections(config, { position, request, best }) {
  const reasons = [];
  if (position.board.length === 0) reasons.push("position.opening");
  else if (!within(position.board.length, config.position.boardTiles))
    reasons.push("position.boardTiles");
  // Study derives the opponent's rack and the bag from the board and rack alone.
  // A position where that would differ from the real game is not one Study can pose.
  if (position.oppRackCount !== request.oppRackCount || position.bagCount !== request.bagCount) {
    reasons.push("position.inconsistent");
  }
  if (best.type !== "place") reasons.push("bestPlay.notPlacement");
  return reasons;
}

const CONTENT = {
  arithmetic: (tags) => tags.arithmetic,
  fraction: (tags) => tags.fraction,
  "fraction-sum": (tags) => tags.fractionSum,
  large: (tags) => tags.large,
};

/** Reasons the best play does not satisfy the configuration. */
export function bestPlayRejections(config, { analysis, nearBest, rackIndex, rack = null }) {
  const reasons = [];
  const wanted = config.bestPlay;
  if (!within(analysis.score, wanted.score)) reasons.push("bestPlay.score");
  if (!within(analysis.composition.total, wanted.tiles)) reasons.push("bestPlay.tiles");
  if (!within(analysis.moveFacts.equationCount, wanted.equations))
    reasons.push("bestPlay.equations");
  // Inclusive: any selected label on the move is enough (OR).
  if (
    wanted.moveTypes.length > 0 &&
    !wanted.moveTypes.some((type) => analysis.moveTypes.includes(type))
  ) {
    reasons.push("bestPlay.moveType");
  }
  if (rack) {
    if (!within(rack.length, config.rack.size)) reasons.push("rack.size");
    reasons.push(...compositionFailures(rack, config.rack.groups, config.rack.specific, "rack"));
  }
  reasons.push(...compositionFailures(analysis.placedKinds ?? [], wanted.composition, wanted.specific, "bestPlay"));
  const extend = config.geometry?.extend;
  if (extend && (extend.shapes.length || extend.headContacts.length || extend.tailContacts.length)) {
    const actual = analysis.geometry?.extend;
    if (!actual || !actual.shape) reasons.push("geometry.expectedExtend");
    else {
      if (extend.shapes.length && !extend.shapes.includes(actual.shape)) reasons.push(`geometry.extend.expected.${extend.shapes.join("+")}`);
      for (const side of ["head", "tail"]) {
        const allowed = extend[`${side}Contacts`];
        const contacts = actual[`${side}Contacts`] ?? (actual[`${side}Contact`] ? [actual[`${side}Contact`]] : []);
        if (allowed.length && !contacts.some((contact) => allowed.some((pair) => pair[0] === contact[0] && pair[1] === contact[1])))
          reasons.push(`geometry.extend.${side}Contact`);
      }
    }
  }
  const equationSpec = config.equation;
  if (equationSpec) {
    const selected = equationSpec.scope === "MAIN" ? analysis.equations.slice(0, 1) : analysis.equations;
    const matches = (predicate) => equationSpec.scope === "ALL" ? selected.every(predicate) : selected.some(predicate);
    const predicates = [];
    for (const [key, field] of [["tiles", "tileCount"], ["reusedBoardTiles", "reusedBoardTiles"], ["placedParticipating", "placedParticipating"]]) {
      const range = equationSpec[key];
      if (range.min !== null || range.max !== null) {
        const predicate = (equation) => within(equation[field], range);
        predicates.push(predicate);
        if (!matches(predicate)) reasons.push(`equation.${key}`);
      }
    }
    for (const property of equationSpec.properties) {
      const predicate = (equation) => hasEquationProperty(equation.semantics, property, equationSpec.largeIntegerThreshold);
      predicates.push(predicate);
      if (!matches(predicate)) reasons.push(`equation.property.${property}`);
    }
    if (predicates.length && !matches((equation) => predicates.every((predicate) => predicate(equation))) && !reasons.some((reason) => reason.startsWith("equation.")))
      reasons.push("equation.scope");
  }
  if (wanted.content !== "any" && !CONTENT[wanted.content](analysis.content))
    reasons.push("bestPlay.content");
  if (wanted.excludeTrivialZero && analysis.content.trivialZero)
    reasons.push("bestPlay.trivialZero");
  if (nearBest.length > config.answer.maxNear) reasons.push("answer.maxNear");
  if (config.rack.minDifficulty !== null && rackIndex < config.rack.minDifficulty) {
    reasons.push("rack.minDifficulty");
  }
  return reasons;
}
