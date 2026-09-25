// Where each turn of the multiverse sits on the map.
//
// Time runs left to right — a turn's column is how many turns stand before it — and every line
// gets a lane. The line being played always owns the top lane, so the answer to "where am I" is
// always in the same place.
//
// A line continues in its parent's lane; a fork drops into the nearest lane below that is free
// from the column before the fork onward. Two short explorations at different points of the game
// therefore share a lane instead of each taking a new one, which is what keeps the map from
// growing a row per branch — the difference between a map you can read and one you scroll.
import type { MultiverseTree } from "../../gameplay/multiverse";
import type { TurnLog } from "../../game";

export type MapNode = {
  readonly id: string;
  readonly log: TurnLog;
  readonly parentId: string | null;
  readonly depth: number;
  readonly lane: number;
  readonly x: number;
  readonly y: number;
  /** On the line being played. */
  readonly live: boolean;
};

export type MapEdge = {
  readonly key: string;
  readonly toId: string;
  readonly d: string;
  readonly live: boolean;
};

export type MapLayout = {
  readonly nodes: readonly MapNode[];
  readonly byId: ReadonlyMap<string, MapNode>;
  readonly edges: readonly MapEdge[];
  readonly start: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly lanes: number;
  readonly columns: number;
  readonly column: (depth: number) => number;
};

export const MAP_GEOMETRY = { colWidth: 46, rowHeight: 42, padX: 34, padY: 40 } as const;

export function layoutMultiverse(tree: MultiverseTree, geometry = MAP_GEOMETRY): MapLayout {
  const { colWidth, rowHeight, padX, padY } = geometry;
  const column = (depth: number) => padX + (depth + 1) * colWidth;
  const row = (lane: number) => padY + lane * rowHeight;
  const liveIds = new Set(tree.activeIds);

  const laneOf = new Map<string, number>();
  // Rightmost column each lane has used; -2 for an empty lane.
  const laneEnd: number[] = [-1];
  let maxDepth = -1;

  const claim = (lane: number, depth: number) => {
    while (laneEnd.length <= lane) laneEnd.push(-2);
    laneEnd[lane] = Math.max(laneEnd[lane]!, depth);
    maxDepth = Math.max(maxDepth, depth);
  };

  const allocate = (depth: number, parentLane: number): number => {
    for (let lane = parentLane + 1; lane < laneEnd.length; lane += 1) {
      if (laneEnd[lane]! < depth - 1) return lane;
    }
    laneEnd.push(-2);
    return laneEnd.length - 1;
  };

  // The top lane is the line being played and nothing else. A parked line that continues past
  // the live position — the old line, right after going back — is a fork like any other.
  const continues = (lane: number, childId: string | undefined) =>
    childId !== undefined && (lane !== 0 || liveIds.has(childId));

  // Lay a line down its lane, then its forks, earliest first, each below its own parent.
  const placeLine = (firstId: string, lane: number) => {
    const chain: string[] = [];
    let cursor: string | undefined = firstId;
    while (cursor !== undefined) {
      const node = tree.nodes.get(cursor);
      if (!node) break;
      laneOf.set(cursor, lane);
      claim(lane, node.depth);
      chain.push(cursor);
      const next: string | undefined = node.childIds[0];
      cursor = continues(lane, next) ? next : undefined;
    }
    for (const id of chain) {
      const node = tree.nodes.get(id)!;
      const [first, ...rest] = node.childIds;
      const forks = first !== undefined && !continues(lane, first) ? node.childIds : rest;
      for (const forkId of forks) {
        const fork = tree.nodes.get(forkId);
        if (fork) placeLine(forkId, allocate(fork.depth, lane));
      }
    }
  };

  claim(0, -1);
  const [firstMove, ...otherFirstMoves] = tree.rootChildIds;
  const firstForks = continues(0, firstMove) ? otherFirstMoves : tree.rootChildIds;
  if (firstMove !== undefined && continues(0, firstMove)) placeLine(firstMove, 0);
  for (const id of firstForks) {
    const node = tree.nodes.get(id);
    if (node) placeLine(id, allocate(node.depth, 0));
  }

  const nodes: MapNode[] = [];
  const byId = new Map<string, MapNode>();
  for (const [id, lane] of laneOf) {
    const node = tree.nodes.get(id)!;
    const placed: MapNode = {
      id,
      log: node.log,
      parentId: node.parentId,
      depth: node.depth,
      lane,
      x: column(node.depth),
      y: row(lane),
      live: liveIds.has(id),
    };
    nodes.push(placed);
    byId.set(id, placed);
  }

  const start = { x: column(-1), y: row(0) };
  const edges: MapEdge[] = nodes.map((node) => {
    const parent = node.parentId === null ? start : byId.get(node.parentId);
    const from = parent ?? start;
    const parentLive = node.parentId === null || liveIds.has(node.parentId);
    return {
      key: `${node.parentId ?? "start"}>${node.id}`,
      toId: node.id,
      d: edgePath(from.x, from.y, node.x, node.y),
      live: node.live && parentLive,
    };
  });

  const lanes = laneEnd.length;
  const columns = maxDepth + 2;
  return {
    nodes,
    byId,
    edges,
    start,
    width: padX * 2 + columns * colWidth,
    height: padY + (lanes - 1) * rowHeight + padY,
    lanes,
    columns,
    column,
  };
}

/** Straight along a lane; a smooth drop into a fork's lane, finishing level with its first turn. */
function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (y1 === y2) return `M${x1} ${y1}H${x2}`;
  const bend = x1 + (x2 - x1) * 0.55;
  return `M${x1} ${y1}C${bend} ${y1} ${x1 + (x2 - x1) * 0.45} ${y2} ${x2} ${y2}`;
}
