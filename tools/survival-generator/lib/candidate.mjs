// The Candidate JSON (`survival-candidate-v2`) — four sections, each tagged with
// who may ever see it:
//
//   gameplay    SERVER-ONLY. The immutable snapshot needed to reconstruct the
//               exact game: board, both racks, the ordered bag, scores, side to
//               move, turn, scoreless streak, plus the level key Authur's seeds
//               derive from; and the SOURCE LOG, the source game from its deal
//               to the takeover (lib/sourcelog.mjs). Contains hidden
//               information (racks, draws, exchanged tiles, the bag).
//   provenance  ADMIN-ONLY. Source game, versions, hashes, seeds. The source
//               seed alone would let anyone regenerate the game and read the bag.
//   public      PUBLIC-SAFE. A strict whitelist of facts a player can already
//               see, plus an empty difficulty slot for future calibration.
//   admin       ADMIN-ONLY. Features, opportunity analysis, routing, every
//               simulation result, timing flags, selection reasons.
//
// A player-facing payload must be built with `playerView`, never by copying a
// section. No winning move sequence is stored anywhere in a candidate: the
// source log holds only the moves played BEFORE the takeover.
import { canonicalJson, sha256 } from "./canonical.mjs";
import { KIND_ORDER, env, snapshotOf } from "./rules.mjs";
import { CANDIDATE_SCHEMA } from "./provenance.mjs";
import { ROUTES, STATUSES } from "./routing.mjs";
import { playerSourceLog, replaySourceLog, sourceLogProblems } from "./sourcelog.mjs";

export { canonicalJson };

const KIND_RANK = new Map(KIND_ORDER.map((kind, index) => [kind, index]));
const byKind = (a, b) => KIND_RANK.get(a) - KIND_RANK.get(b);
const SIZE = 15;

export const PUBLIC_KEYS = Object.freeze(["deficit", "bagRemaining", "turnNumber", "scores", "difficulty"]);

/**
 * Exact identity of the gameplay: the full snapshot (racks as multisets — their
 * order means nothing in play — the bag in order, because it IS the future) and
 * the level key the opponent's seeds come from.
 */
export function contentHash(snapshot, levelKey) {
  const canonical = {
    ...snapshot,
    board: [...snapshot.board].sort((a, b) => a.cell - b.cell),
    racks: { A: [...snapshot.racks.A].sort(byKind), B: [...snapshot.racks.B].sort(byKind) },
    levelKey,
  };
  return sha256(canonicalJson(canonical));
}

/**
 * Position identity for duplicate detection: turn stamps and the level key left
 * out, sides named by role, and the board taken in whichever of its two
 * rules-preserving orientations (as is, or transposed) serialises first.
 * Mirrors and rotations are NOT equivalent: they reverse reading order.
 */
export function positionHash(snapshot) {
  const player = snapshot.sideToMove;
  const role = (side) => (side === player ? "P" : "O");
  const cells = (transpose) =>
    snapshot.board
      .map((t) => {
        const cell = transpose ? (t.cell % SIZE) * SIZE + Math.floor(t.cell / SIZE) : t.cell;
        return `${cell}:${t.kind}:${t.face}:${role(t.side)}`;
      })
      .sort((a, b) => Number(a.split(":")[0]) - Number(b.split(":")[0]))
      .join("|");
  const orientation = [cells(false), cells(true)].sort()[0];
  const other = player === "A" ? "B" : "A";
  return sha256(canonicalJson({
    board: orientation,
    playerRack: [...snapshot.racks[player]].sort(byKind),
    opponentRack: [...snapshot.racks[other]].sort(byKind),
    bag: snapshot.bag,
    scores: { player: snapshot.scores[player], opponent: snapshot.scores[other] },
    noScoreTail: snapshot.noScoreTail.map(role),
  }));
}

/** Only what the player at the table can see: the takeover position and the public source log. */
export function playerView(candidate) {
  const { snapshot, roles, sourceLog } = candidate.gameplay;
  return {
    schema: `${candidate.schema}/player-view`,
    candidateId: candidate.candidateId,
    board: snapshot.board.map(({ cell, kind, face, side }) => ({ cell, kind, face, owner: side === roles.player ? "player" : "authur" })),
    playerRack: [...snapshot.racks[roles.player]],
    authurRackCount: snapshot.racks[roles.authur].length,
    bagCount: snapshot.bag.length,
    scores: { player: snapshot.scores[roles.player], authur: snapshot.scores[roles.authur] },
    turnNumber: snapshot.turnNumber,
    sourceLog: playerSourceLog(sourceLog, roles),
    public: candidate.public,
  };
}

/**
 * Replay the source log twice — from the authentic seed, and from the log alone
 * — and require both to reach exactly this snapshot.
 */
export function verifyReplay(sourceLog, snapshot, levelKey) {
  const target = contentHash(snapshot, levelKey);
  for (const mode of ["seed", "log"]) {
    const reached = snapshotOf(replaySourceLog(sourceLog, { mode }));
    if (contentHash(reached, levelKey) !== target) {
      throw new Error(`source log replay (${mode}) reaches a different position than the snapshot`);
    }
  }
  return true;
}

export function buildCandidate({ snapshot, levelKey, sourceLog, status, publicFacts, provenance, admin }) {
  if (!sourceLog) throw new Error(`${CANDIDATE_SCHEMA} needs the source log`);
  verifyReplay(sourceLog, snapshot, levelKey);
  const player = snapshot.sideToMove;
  const authur = player === "A" ? "B" : "A";
  const hash = contentHash(snapshot, levelKey);
  const candidate = {
    schema: CANDIDATE_SCHEMA,
    candidateId: `cand-${hash.slice(0, 16)}`,
    contentHash: hash,
    positionHash: positionHash(snapshot),
    status,
    gameplay: { visibility: "server-only", snapshot, roles: { player, authur }, levelKey, sourceLog },
    provenance: {
      visibility: "admin-only",
      ...provenance,
      source: {
        ...provenance.source,
        sourceLogTurns: sourceLog.turns.length,
        sourceLogSha256: sha256(canonicalJson(sourceLog)),
      },
      contentHash: hash,
    },
    public: { visibility: "public-safe", ...publicFacts },
    admin: { visibility: "admin-only", ...admin },
  };
  validateCandidate(candidate);
  return candidate;
}

const MANIFEST_COUNTS = (() => {
  const counts = new Map();
  for (const tile of env.createManifest().tiles) counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1);
  return counts;
})();

/** Board + both racks + bag must be exactly the 100-tile set, kind by kind. */
export function conservationProblems(snapshot) {
  const counts = new Map();
  const add = (kind) => counts.set(kind, (counts.get(kind) ?? 0) + 1);
  for (const tile of snapshot.board) add(tile.kind);
  for (const kind of [...snapshot.racks.A, ...snapshot.racks.B, ...snapshot.bag]) add(kind);
  const problems = [];
  for (const kind of new Set([...counts.keys(), ...MANIFEST_COUNTS.keys()])) {
    if ((counts.get(kind) ?? 0) !== (MANIFEST_COUNTS.get(kind) ?? 0)) {
      problems.push(`tile ${kind}: ${counts.get(kind) ?? 0} in the snapshot, ${MANIFEST_COUNTS.get(kind) ?? 0} in the set`);
    }
  }
  return problems;
}

/** Structural checks. Throws with every problem found. */
export function validateCandidate(candidate) {
  const problems = [];
  if (candidate.schema !== CANDIDATE_SCHEMA) problems.push(`schema ${candidate.schema}`);
  if (!STATUSES.includes(candidate.status)) problems.push(`status ${candidate.status}`);
  for (const [section, visibility] of [["gameplay", "server-only"], ["provenance", "admin-only"], ["public", "public-safe"], ["admin", "admin-only"]]) {
    if (candidate[section]?.visibility !== visibility) problems.push(`${section}.visibility must be ${visibility}`);
  }
  const route = candidate.admin?.routing?.route;
  if (route !== undefined && !ROUTES.includes(route)) problems.push(`route ${route}`);
  const publicKeys = Object.keys(candidate.public ?? {}).filter((key) => key !== "visibility");
  const extra = publicKeys.filter((key) => !PUBLIC_KEYS.includes(key));
  if (extra.length) problems.push(`public section has non-whitelisted keys: ${extra.join(", ")}`);
  // Nothing in the public section may be a tile list: no rack, no bag, no move.
  const publicText = canonicalJson(candidate.public ?? {});
  if (/"(bag|rack|racks|actions|moves|placements|replay|seed|levelKey)"/.test(publicText)) {
    problems.push("public section contains a hidden-information field");
  }
  if (candidate.gameplay && contentHash(candidate.gameplay.snapshot, candidate.gameplay.levelKey) !== candidate.contentHash) {
    problems.push("contentHash does not match the gameplay snapshot");
  }
  if (candidate.provenance?.contentHash !== candidate.contentHash) problems.push("provenance.contentHash differs");
  if (candidate.gameplay) problems.push(...conservationProblems(candidate.gameplay.snapshot));
  const log = candidate.gameplay?.sourceLog;
  if (!log) problems.push("gameplay.sourceLog is missing");
  else {
    problems.push(...sourceLogProblems(log, candidate.gameplay.snapshot));
    const source = candidate.provenance?.source;
    if (source?.sourceLogSha256 !== sha256(canonicalJson(log))) problems.push("provenance.source.sourceLogSha256 does not match the source log");
    if (source?.sourceSeed !== log.sourceSeed) problems.push("provenance.source.sourceSeed differs from the source log");
  }
  if (problems.length) throw new Error(`invalid candidate:\n  - ${problems.join("\n  - ")}`);
  return true;
}
