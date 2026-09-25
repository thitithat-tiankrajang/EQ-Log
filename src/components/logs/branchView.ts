// What the turn log needs to know about branches, and nothing more.
//
// The log shows ONE line at a time — the one being viewed — so it never has to draw the tree.
// All it needs is, for each of its rows, whether another move was tried at that point, and what
// the alternatives were; and whether anything continues past its last row. That is this.
import { childrenOf, lineTipOf, pathTo, type MultiverseTree } from "../../gameplay/multiverse";
import type { Side, TurnLog } from "../../game";
import { scoreText, shortMove } from "./turnSummary";

export type BranchOption = {
  /** The first turn of this option. */
  readonly id: string;
  /** The end of the line it starts: what "view this option" shows. */
  readonly tipId: string;
  readonly turnNumber: number;
  readonly side: Side;
  readonly text: string;
  readonly score: string;
  /** Turns from this option to the end of its line, itself included. */
  readonly length: number;
  /** On the line currently being viewed. */
  readonly current: boolean;
  /** On the line being played. */
  readonly live: boolean;
};

export type ForkIndex = {
  /** For rows where more than one move was tried: every option at that point, this row included. */
  readonly atRow: ReadonlyMap<string, readonly BranchOption[]>;
  /** Lines that continue past the last row shown. */
  readonly afterEnd: readonly BranchOption[];
};

export const NO_FORKS: ForkIndex = { atRow: new Map(), afterEnd: [] };

export function buildForkIndex(tree: MultiverseTree, viewLogs: readonly TurnLog[]): ForkIndex {
  if (tree.nodes.size === tree.activeIds.length && tree.rootChildIds.length <= 1) {
    // Nothing is parked: the common case costs one comparison.
    return NO_FORKS;
  }
  const viewed = new Set(viewLogs.map((log) => log.id));
  const live = new Set(tree.activeIds);
  const option = (id: string): BranchOption | null => {
    const node = tree.nodes.get(id);
    if (!node) return null;
    const tipId = lineTipOf(tree, id);
    return {
      id,
      tipId,
      turnNumber: node.log.turnNumber,
      side: node.log.side,
      text: shortMove(node.log),
      score: scoreText(node.log),
      length: pathTo(tree, tipId).length - node.depth,
      current: viewed.has(id),
      live: live.has(id),
    };
  };
  const options = (ids: readonly string[]) =>
    ids.map(option).filter((entry): entry is BranchOption => entry !== null);

  const atRow = new Map<string, readonly BranchOption[]>();
  viewLogs.forEach((log, index) => {
    const siblings = childrenOf(tree, index === 0 ? null : viewLogs[index - 1]!.id);
    if (siblings.length > 1) atRow.set(log.id, options(siblings));
  });
  const last = viewLogs[viewLogs.length - 1];
  const afterEnd = options(childrenOf(tree, last ? last.id : null).filter((id) => !viewed.has(id)));
  return { atRow, afterEnd };
}

/** Where a viewed line leaves the one being played: the last shared turn, or `null` for the start. */
export function divergence(
  tree: MultiverseTree,
  viewLogs: readonly TurnLog[],
): { sharedTurns: number; forkTurn: number | null } {
  let shared = 0;
  while (shared < viewLogs.length && tree.activeIds[shared] === viewLogs[shared]!.id) shared += 1;
  return {
    sharedTurns: shared,
    forkTurn: shared > 0 ? viewLogs[shared - 1]!.turnNumber : null,
  };
}
