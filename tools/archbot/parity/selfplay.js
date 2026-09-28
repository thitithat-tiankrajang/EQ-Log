// Self-play positions for the ArchBot parity corpus.
//
// ArchBot plays both seats inside the pinned Stage 5B environment, and every
// decision it faces becomes a corpus case: the request exactly as ArchBot would
// send it (only what the mover may know, tiles labelled from the mover's seat),
// plus a few synthetic racks that natural games rarely deal (two blanks, two
// blanks with both choice tiles). Dependencies are passed in so this file has no
// imports and can be bundled against the pinned source wherever it is extracted.

const ASSIGNABLE = new Set(["+/-", "x//", "?"]);

export function seedOf(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

/** The request for the side on move, from a full environment state. */
export function requestFor(state, isExchangeAllowed, seed) {
  const seat = state.activeSide;
  const other = seat === "A" ? "B" : "A";
  const board = [];
  state.board.forEach((cell, index) => {
    if (!cell) return;
    board.push({
      r: Math.floor(index / 15),
      c: index % 15,
      kind: cell.kind,
      token: ASSIGNABLE.has(cell.kind) ? cell.face : cell.kind,
      by: cell.side === seat ? "A" : "B",
      placedTurn: cell.turn,
    });
  });
  const kindOf = (id) => state.manifest.kindOf.get(id);
  return {
    board,
    rack: state.racks[seat].map(kindOf),
    bagCount: state.bag.length + state.pendingReturn.A.length + state.pendingReturn.B.length,
    oppRackCount: state.racks[other].length,
    myScore: state.scores[seat],
    oppScore: state.scores[other],
    noScoreStreak: state.noScoreTail.length,
    exchangeAllowed: isExchangeAllowed(state.bag.length, state.racks[other].length),
    seed,
    topN: 24,
    turnNumber: state.turnNumber,
  };
}

const placementKey = (cell, kind, face) => `${cell}:${kind}:${face}`;

/** The environment's legal action that is the move ArchBot answered with. */
function legalActionFor(env, answer) {
  const legal = env.getLegalActions();
  if (answer.type === "pass") return legal.find((item) => item.action.type === "pass");
  if (answer.type === "exchange") {
    const want = [...answer.exchange].sort().join(",");
    return legal.find(
      (item) => item.action.type === "exchange" && [...item.action.kinds].sort().join(",") === want,
    );
  }
  const want = answer.placements
    .map((p) => placementKey(p.r * 15 + p.c, p.kind, p.token))
    .sort()
    .join("|");
  return legal.find(
    (item) =>
      item.action.type === "place" &&
      item.action.placements
        .map((p) => placementKey(p.cell, p.kind, p.face))
        .sort()
        .join("|") === want,
  );
}

export function tagsFor(request) {
  const tags = [];
  const tiles = request.board.length;
  if (tiles === 0) tags.push("opening");
  else if (request.bagCount === 0) tags.push("endgame");
  else if (request.bagCount <= 12) tags.push("late");
  else if (tiles <= 20) tags.push("early");
  else tags.push("midgame");
  const blanks = request.rack.filter((kind) => kind === "?").length;
  if (blanks === 1) tags.push("blank");
  if (blanks >= 2) tags.push("two-blanks");
  if (request.rack.some((kind) => kind === "+/-" || kind === "x//")) tags.push("choice");
  if (!request.exchangeAllowed) tags.push("no-exchange");
  if (request.noScoreStreak > 0) tags.push("no-score-streak");
  return tags;
}

/**
 * Play `games` seeded games, ArchBot against itself, and return every decision.
 * `decide(request)` must be ArchBot; its answers drive the games.
 */
export function selfPlayCases({ GameEnvironment, isExchangeAllowed, decide, seeds, log }) {
  const cases = [];
  for (const gameSeed of seeds) {
    const env = new GameEnvironment({ seed: gameSeed });
    env.reset(gameSeed);
    let ply = 0;
    while (!env.isTerminal()) {
      const state = env.getState();
      const request = requestFor(
        state,
        isExchangeAllowed,
        seedOf(`archbot-corpus:${gameSeed}:${ply}`),
      );
      const answer = decide(request);
      const action = legalActionFor(env, answer);
      if (!action) throw new Error(`game ${gameSeed} ply ${ply}: ArchBot's move is not legal here`);
      cases.push({
        id: `selfplay-${gameSeed}-${String(ply).padStart(3, "0")}`,
        source: `self-play game ${gameSeed}, ply ${ply}, seat ${state.activeSide}`,
        tags: [...tagsFor(request), `chose-${answer.type}`],
        request,
      });
      env.step(action.action);
      ply += 1;
    }
    log?.(`game ${gameSeed}: ${ply} decisions, result ${JSON.stringify(env.getResult())}`);
  }
  return cases;
}

/** Tokens not on the board and not in the rack: what a synthetic rack may draw. */
function unseenKinds(request, manifestKinds) {
  const left = new Map();
  for (const kind of manifestKinds) left.set(kind, (left.get(kind) ?? 0) + 1);
  for (const cell of request.board) left.set(cell.kind, left.get(cell.kind) - 1);
  for (const kind of request.rack) left.set(kind, left.get(kind) - 1);
  return left;
}

/**
 * Give a real position's mover a different rack, keeping every count consistent:
 * the tiles taken out simply become unseen, as they would be in a real game.
 */
export function withRack(request, rack, manifestKinds, seedText) {
  const left = unseenKinds({ ...request, rack: [] }, manifestKinds);
  for (const kind of rack) {
    if (!(left.get(kind) > 0)) throw new Error(`no unseen ${kind} for a synthetic rack`);
    left.set(kind, left.get(kind) - 1);
  }
  const unseen = [...left.values()].reduce((sum, count) => sum + count, 0);
  if (rack.length !== request.rack.length)
    throw new Error("synthetic rack must keep the rack size");
  if (unseen !== request.bagCount + request.oppRackCount)
    throw new Error("synthetic rack breaks conservation");
  return { ...request, rack, seed: seedOf(seedText) };
}
