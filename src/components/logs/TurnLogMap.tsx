import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Eye, GitBranch, Network, RotateCcw, Trash2, X } from "lucide-react";
import { calculateTotals, createBoard, type GameState, type PlaceEquationDetail } from "../../game";
import {
  childrenOf,
  lineCount,
  pathTo,
  type ContinueTarget,
  type MultiverseTree,
} from "../../gameplay/multiverse";
import type { TimelineStatus } from "../../timelineStore";
import { useDialogBehavior } from "../ui/useDialogBehavior";
import { MiniBoard } from "./MiniBoard";
import { layoutMultiverse, MAP_GEOMETRY, type MapLayout } from "./multiverseLayout";
import { scoreText, shortMove } from "./turnSummary";

/** The start of the game, as a node you can select like any other. */
export const MAP_START = "__start";

type TurnLogMapProps = {
  open: boolean;
  game: GameState;
  tree: MultiverseTree;
  status: TimelineStatus;
  error: string | null;
  /** The turn the board is showing, or `null` for the live position. */
  viewedId: string | null;
  /** Whether this viewer may play on from another position at all. */
  canBranch: boolean;
  /** Why they cannot right now, when they cannot. */
  branchBlockedReason: string | null;
  busy: boolean;
  onClose: () => void;
  /** Show a turn on the board to study it. `null` is the start of the game. */
  onView: (nodeId: string | null) => void;
  onContinue: (target: ContinueTarget) => void;
  onPrune: (lineId: string) => void;
  onRetry: () => void;
};

// The whole multiverse at once: every line this game has been played along, as a graph.
//
// The turn log answers "what happened on this line"; this answers "what happened at all". Time
// runs left to right, the line being played is the top lane, and every fork drops into a lane
// below. Select a turn to see its board beside the graph; send it to the board to study it
// there; or play on from it, which parks what is live and makes that turn the present.
export function TurnLogMap(props: TurnLogMapProps) {
  if (!props.open) return null;
  return <TurnLogMapDialog {...props} />;
}

function TurnLogMapDialog({
  game,
  tree,
  status,
  error,
  viewedId,
  canBranch,
  branchBlockedReason,
  busy,
  onClose,
  onView,
  onContinue,
  onPrune,
  onRetry,
}: TurnLogMapProps) {
  const titleId = useId();
  const dialogRef = useDialogBehavior<HTMLElement>({ open: true, onClose });
  const layout = useMemo(() => layoutMultiverse(tree), [tree]);
  const liveTipId = tree.activeIds[tree.activeIds.length - 1] ?? null;
  const [selected, setSelected] = useState<string>(() =>
    viewedId && tree.nodes.has(viewedId) ? viewedId : (liveTipId ?? MAP_START),
  );
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // A selection the tree no longer holds (the lines were pruned or reloaded) falls back to live.
  const current =
    selected === MAP_START || tree.nodes.has(selected) ? selected : (liveTipId ?? MAP_START);

  // Keep the selected turn in view, and centre it the first time the map opens.
  const centredRef = useRef(false);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const point = current === MAP_START ? layout.start : layout.byId.get(current);
    if (!point) return;
    const margin = 48;
    if (!centredRef.current) {
      centredRef.current = true;
      scroller.scrollLeft = point.x - scroller.clientWidth / 2;
      scroller.scrollTop = point.y - scroller.clientHeight / 2;
      return;
    }
    if (
      point.x < scroller.scrollLeft + margin ||
      point.x > scroller.scrollLeft + scroller.clientWidth - margin
    ) {
      scroller.scrollLeft = point.x - scroller.clientWidth / 2;
    }
    if (
      point.y < scroller.scrollTop + margin ||
      point.y > scroller.scrollTop + scroller.clientHeight - margin
    ) {
      scroller.scrollTop = point.y - scroller.clientHeight / 2;
    }
  }, [current, layout]);

  // Focus follows the selection, so the arrow keys and the ring on screen never disagree.
  useEffect(() => {
    scrollRef.current
      ?.querySelector<SVGGElement>(`[data-node="${current}"]`)
      ?.focus({ preventScroll: true });
  }, [current]);

  const forkCount =
    [...tree.nodes.values()].filter((node) => node.childIds.length > 1).length +
    (tree.rootChildIds.length > 1 ? 1 : 0);

  const openNode = useCallback((id: string) => onView(id === MAP_START ? null : id), [onView]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = neighbour(layout, tree, current, event.key);
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      onView(current === MAP_START ? null : current);
      return;
    }
    if (next === undefined) return;
    // The board listens for arrows too (the placement cursor). While the map is open they are
    // the map's.
    event.preventDefault();
    event.stopPropagation();
    setSelected(next);
  };

  return (
    <div className="map-backdrop" role="presentation" onClick={onClose}>
      <section
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="turn-log-map"
        role="dialog"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="tlm-head">
          <Network size={18} aria-hidden />
          <div className="tlm-title">
            <h2 id={titleId}>เส้นทางเกม</h2>
            <span>
              {lineCount(tree)} เส้นทาง · {tree.nodes.size} ตา
              {forkCount > 0 ? ` · แตกกิ่ง ${forkCount} จุด` : ""}
            </span>
          </div>
          {status === "loading" && <span className="tlm-status">กำลังโหลดเส้นทางอื่น…</span>}
          <button
            className="icon-button tlm-close"
            type="button"
            aria-label="ปิด"
            onClick={onClose}
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        {status === "error" && (
          <div className="tlm-error" role="alert">
            <span>{error ?? "โหลดเส้นทางอื่นไม่สำเร็จ"}</span>
            <button type="button" onClick={onRetry}>
              ลองใหม่
            </button>
          </div>
        )}
        {tree.problems.length > 0 && (
          <p className="tlm-warning">
            อ่านบางเส้นทางไม่ได้ ({tree.problems.length}) — ส่วนที่เหลือยังใช้ได้ตามปกติ
          </p>
        )}

        <div className="tlm-body">
          <div
            className="tlm-graph"
            ref={scrollRef}
            role="group"
            aria-label="แผนที่เส้นทาง ใช้ลูกศรเลื่อน Enter เพื่อดูบนกระดาน"
            onKeyDown={move}
          >
            <Graph
              layout={layout}
              selected={current}
              viewedId={viewedId}
              liveTipId={liveTipId}
              players={game.players}
              onSelect={setSelected}
              onOpen={openNode}
            />
            {tree.nodes.size === 0 && (
              <p className="tlm-empty">ตาที่เล่นจะปรากฏเป็นเส้นทางตรงนี้</p>
            )}
          </div>

          <Inspector
            // Keyed by turn, so a half-finished "delete this line?" never carries over to the next.
            key={current}
            game={game}
            tree={tree}
            nodeId={current}
            liveTipId={liveTipId}
            canBranch={canBranch}
            branchBlockedReason={branchBlockedReason}
            busy={busy}
            onView={onView}
            onContinue={onContinue}
            onPrune={onPrune}
          />
        </div>

        <footer className="tlm-legend" aria-hidden>
          <span>
            <i className="lg-dot side-a" /> {game.players.A || "A"}
          </span>
          <span>
            <i className="lg-dot side-b" /> {game.players.B || "B"}
          </span>
          <span>
            <i className="lg-shape is-exchange" /> แลก
          </span>
          <span>
            <i className="lg-shape is-pass" /> ผ่าน
          </span>
          <span>
            <i className="lg-line is-live" /> เส้นที่เล่นอยู่
          </span>
          <span>
            <i className="lg-line" /> เส้นที่เก็บไว้
          </span>
          <span>
            <i className="lg-ring is-live" /> ตอนนี้
          </span>
          <span>
            <i className="lg-ring is-viewed" /> บนกระดาน
          </span>
        </footer>
      </section>
    </div>
  );
}

// Memoized: the play shell re-renders once a second for the clock, and the graph only changes
// when the lines or the selection do.
const Graph = memo(function Graph({
  layout,
  selected,
  viewedId,
  liveTipId,
  players,
  onSelect,
  onOpen,
}: {
  layout: MapLayout;
  selected: string;
  viewedId: string | null;
  liveTipId: string | null;
  players: GameState["players"];
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const { colWidth } = MAP_GEOMETRY;
  // A tick every five turns: enough to say "turn 20" without counting nodes.
  const ticks: number[] = [];
  for (let depth = 0; depth < layout.columns - 1; depth += 1) {
    if (depth === 0 || (depth + 1) % 5 === 0) ticks.push(depth);
  }
  const node = (
    id: string,
    x: number,
    y: number,
    label: string,
    body: ReactNode,
    extraClass: string,
  ) => (
    <g
      key={id}
      data-node={id}
      className={`tlm-node ${extraClass}${selected === id ? " is-selected" : ""}`}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={selected === id ? 0 : -1}
      aria-label={label}
      aria-pressed={selected === id}
      onClick={() => onSelect(id)}
      onDoubleClick={() => onOpen(id)}
    >
      <circle className="tlm-halo" r={17} />
      {body}
    </g>
  );

  return (
    <svg
      className="tlm-svg"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
    >
      <g className="tlm-ruler" aria-hidden>
        {ticks.map((depth) => (
          <text key={depth} x={layout.column(depth)} y={14} textAnchor="middle">
            {depth + 1}
          </text>
        ))}
        <line x1={layout.column(0) - colWidth / 2} x2={layout.width} y1={20} y2={20} />
      </g>

      <g className="tlm-edges" aria-hidden>
        {layout.edges.map((edge) => (
          <path key={edge.key} d={edge.d} className={`tlm-edge${edge.live ? " is-live" : ""}`} />
        ))}
      </g>

      {node(
        MAP_START,
        layout.start.x,
        layout.start.y,
        "เริ่มเกม",
        <>
          <rect className="tlm-start" x={-12} y={-12} width={24} height={24} rx={6} />
          <text className="tlm-start-label" y={4} textAnchor="middle">
            ▶
          </text>
        </>,
        "is-start",
      )}

      {layout.nodes.map((placed) => {
        const log = placed.log;
        const isLive = placed.id === liveTipId;
        const viewed = placed.id === viewedId;
        const shape =
          log.action === "exchange"
            ? "is-exchange"
            : log.action === "pass"
              ? "is-pass"
              : log.action === "end_game"
                ? "is-end"
                : "is-place";
        const bingo =
          log.action === "place_equation" &&
          (log.actionDetail as PlaceEquationDetail).placedTiles.length >= 8;
        return node(
          placed.id,
          placed.x,
          placed.y,
          `ตา ${log.turnNumber} ${log.playedByName ?? (players[log.side] || log.side)} ${shortMove(log)} ${scoreText(log)}${
            isLive ? " (ตอนนี้)" : ""
          }${viewed ? " (บนกระดาน)" : ""}`,
          <>
            {viewed && <circle className="tlm-viewed" r={15} />}
            {isLive && <circle className="tlm-live-ring" r={15} />}
            {shape === "is-exchange" ? (
              <rect className="tlm-mark" x={-10} y={-10} width={20} height={20} rx={4} />
            ) : shape === "is-end" ? (
              <rect
                className="tlm-mark"
                x={-9}
                y={-9}
                width={18}
                height={18}
                transform="rotate(45)"
              />
            ) : (
              <circle className="tlm-mark" r={11} />
            )}
            <text className="tlm-turn" y={3.5} textAnchor="middle">
              {log.turnNumber}
            </text>
            {log.action === "place_equation" && log.finalScore !== 0 && (
              <text className="tlm-score" y={-16} textAnchor="middle">
                {scoreText(log)}
              </text>
            )}
            {isLive && (
              // Beside the node, not under it: the lane below can hold a turn right there.
              <text className="tlm-now" x={18} y={3.5} textAnchor="start">
                ตอนนี้
              </text>
            )}
          </>,
          `side-${log.side.toLowerCase()} ${shape}${placed.live ? " on-live" : " is-parked"}${bingo ? " is-bingo" : ""}`,
        );
      })}
    </svg>
  );
});

function Inspector({
  game,
  tree,
  nodeId,
  liveTipId,
  canBranch,
  branchBlockedReason,
  busy,
  onView,
  onContinue,
  onPrune,
}: {
  game: GameState;
  tree: MultiverseTree;
  nodeId: string;
  liveTipId: string | null;
  canBranch: boolean;
  branchBlockedReason: string | null;
  busy: boolean;
  onView: (nodeId: string | null) => void;
  onContinue: (target: ContinueTarget) => void;
  onPrune: (lineId: string) => void;
}) {
  const [confirmingPrune, setConfirmingPrune] = useState(false);
  const node = nodeId === MAP_START ? null : (tree.nodes.get(nodeId) ?? null);
  const path = useMemo(() => (node ? pathTo(tree, node.id) : []), [tree, node]);
  const totals = calculateTotals(path);
  const board = node ? node.log.boardAfter : createBoard();
  const placed = useMemo(() => {
    if (node?.log.action !== "place_equation") return undefined;
    return new Set(
      (node.log.actionDetail as PlaceEquationDetail).placedTiles.map(
        (tile) => `${tile.row}:${tile.col}`,
      ),
    );
  }, [node]);
  const alternatives = node
    ? childrenOf(tree, node.parentId).length - 1
    : tree.rootChildIds.length - 1;
  const pruneSize = node?.lineId ? subtreeSize(tree, firstOfLine(tree, node.lineId) ?? node.id) : 0;
  const isLiveTip = node ? node.id === liveTipId : liveTipId === null;
  const blocked = Boolean(branchBlockedReason) || busy;

  return (
    <aside className="tlm-inspector" aria-live="polite">
      {node ? (
        <>
          <div className={`tlm-card-head side-${node.log.side.toLowerCase()}`}>
            <strong>ตา {node.log.turnNumber}</strong>
            <span className="tlm-player">{game.players[node.log.side] || node.log.side}</span>
            <span className={`tlm-line-tag${node.lineId === null ? " is-live" : ""}`}>
              {node.lineId === null ? "เส้นที่เล่นอยู่" : "เส้นที่เก็บไว้"}
            </span>
          </div>
          <p className="tlm-move">
            <span>{shortMove(node.log)}</span>
            <b>{scoreText(node.log)}</b>
          </p>
          <p className="tlm-totals">
            คะแนนบนเส้นนี้ · {game.players.A || "A"} <b>{totals.A}</b> · {game.players.B || "B"}{" "}
            <b>{totals.B}</b>
          </p>
          {alternatives > 0 && (
            <p className="tlm-fork-note">
              <GitBranch size={12} aria-hidden /> ตานี้มีทางเลือกอื่น {alternatives} ทาง
            </p>
          )}
        </>
      ) : (
        <>
          <div className="tlm-card-head">
            <strong>เริ่มเกม</strong>
          </div>
          <p className="tlm-totals">
            {tree.rootChildIds.length > 1
              ? `ตาแรกถูกลองไว้ ${tree.rootChildIds.length} แบบ`
              : "กระดานก่อนตาแรก"}
          </p>
        </>
      )}

      <MiniBoard
        board={board}
        highlight={placed}
        label={node ? `กระดานหลังตา ${node.log.turnNumber}` : "กระดานเปล่าก่อนเริ่มเกม"}
      />

      <div className="tlm-actions">
        <button type="button" className="tlm-action" onClick={() => onView(node ? node.id : null)}>
          <Eye size={15} aria-hidden />
          ดูบนกระดาน
        </button>
        {canBranch && (
          <>
            <button
              type="button"
              className="tlm-action is-primary"
              disabled={blocked || isLiveTip}
              title={
                isLiveTip ? "นี่คือตำแหน่งปัจจุบันอยู่แล้ว" : (branchBlockedReason ?? undefined)
              }
              onClick={() => onContinue({ nodeId: node ? node.id : null, phase: "after" })}
            >
              <GitBranch size={15} aria-hidden />
              {busy ? "กำลังแตกกิ่ง…" : node ? "เล่นต่อจากตรงนี้" : "เล่นใหม่ตั้งแต่ตาแรก"}
            </button>
            {node && node.log.action !== "end_game" && (
              <button
                type="button"
                className="tlm-action"
                disabled={blocked}
                title={
                  branchBlockedReason ??
                  `เล่นตา ${node.log.turnNumber} ใหม่ ตาเดิมเก็บไว้เป็นอีกเส้นทาง`
                }
                onClick={() => onContinue({ nodeId: node.id, phase: "before" })}
              >
                <RotateCcw size={15} aria-hidden />
                เดินตานี้ใหม่
              </button>
            )}
            {node?.lineId &&
              (confirmingPrune ? (
                <div className="tlm-confirm" role="group" aria-label="ยืนยันการลบเส้นทาง">
                  <span>ลบ {pruneSize} ตาในเส้นทางนี้และที่แตกต่อจากมัน?</span>
                  <button
                    type="button"
                    className="tlm-action is-danger"
                    disabled={busy}
                    onClick={() => onPrune(node.lineId!)}
                  >
                    ลบ
                  </button>
                  <button
                    type="button"
                    className="tlm-action"
                    onClick={() => setConfirmingPrune(false)}
                  >
                    ยกเลิก
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="tlm-action is-quiet"
                  disabled={busy}
                  onClick={() => setConfirmingPrune(true)}
                >
                  <Trash2 size={14} aria-hidden />
                  ลบเส้นทางนี้
                </button>
              ))}
          </>
        )}
      </div>
      {canBranch && branchBlockedReason && <p className="tlm-blocked">{branchBlockedReason}</p>}
    </aside>
  );
}

/** Arrow-key movement through the graph: along a line, and across lanes at the same turn. */
function neighbour(
  layout: MapLayout,
  tree: MultiverseTree,
  current: string,
  key: string,
): string | undefined {
  if (key === "Home") return MAP_START;
  if (key === "End") return tree.activeIds[tree.activeIds.length - 1] ?? MAP_START;
  if (current === MAP_START) {
    if (key === "ArrowRight") return tree.rootChildIds[0];
    return undefined;
  }
  const node = tree.nodes.get(current);
  const placed = layout.byId.get(current);
  if (!node || !placed) return undefined;
  if (key === "ArrowLeft") return node.parentId ?? MAP_START;
  if (key === "ArrowRight") return node.childIds[0];
  if (key !== "ArrowUp" && key !== "ArrowDown") return undefined;
  // The nearest turn in the next lane up or down, preferring the same column.
  const direction = key === "ArrowUp" ? -1 : 1;
  let best: { id: string; score: number } | undefined;
  for (const other of layout.nodes) {
    const laneStep = (other.lane - placed.lane) * direction;
    if (laneStep <= 0) continue;
    const score = laneStep * 1000 + Math.abs(other.depth - placed.depth);
    if (!best || score < best.score) best = { id: other.id, score };
  }
  return best?.id;
}

function firstOfLine(tree: MultiverseTree, lineId: string): string | undefined {
  for (const node of tree.nodes.values()) {
    if (node.lineId === lineId && node.index === 0) return node.id;
  }
  return undefined;
}

/** Turns in the subtree under a node, itself included: what pruning its line removes. */
function subtreeSize(tree: MultiverseTree, rootId: string): number {
  let count = 0;
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = tree.nodes.get(id);
    if (!node) continue;
    count += 1;
    stack.push(...node.childIds);
  }
  return count;
}
