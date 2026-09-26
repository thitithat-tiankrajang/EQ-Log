import { useEffect, useRef, useState } from "react";
import { GitBranch } from "lucide-react";
import {
  getRack,
  type GameState,
  type PlaceEquationDetail,
  type TileInstance,
  type TurnLog,
} from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";
import { Tile } from "../board/Tile";
import type { BranchOption, ForkIndex } from "./branchView";
import { summaryText } from "./turnSummary";

type TurnRecordListProps = {
  game: GameState;
  /** The line to list. Defaults to the one being played. */
  logs?: readonly TurnLog[];
  selectedLogId: string | null;
  currentTurnRack?: TileInstance[];
  toggleSelection?: boolean;
  /** Where other moves were tried. Absent: the list shows no branches at all. */
  forks?: ForkIndex;
  /** Whether the live "Ready" row belongs at the end: only on the line being played. */
  showLive?: boolean;
  onSelectLog: (logId: string | null) => void;
  onViewOption?: (option: BranchOption) => void;
};

export function TurnRecordList({
  game,
  logs = game.logs,
  selectedLogId,
  currentTurnRack,
  toggleSelection = true,
  forks,
  showLive = true,
  onSelectLog,
  onViewOption,
}: TurnRecordListProps) {
  const activeRack = currentTurnRack ?? getRack(game, game.activeSide);
  const showCurrentRack =
    showLive &&
    game.status === "playing" &&
    (activeRack.length >= RACK_SIZE || game.tilebag.length === 0);
  // One drawer at a time: which row's alternatives are open.
  const [openFork, setOpenFork] = useState<string | null>(null);

  // Smooth-scroll to the newest row (which now sits at the bottom) whenever the
  // list grows. We scroll the *nearest scrollable ancestor*, not the list itself,
  // because the rail panel is the overflow:auto container.
  const listRef = useRef<HTMLDivElement | null>(null);
  const lastCountRef = useRef(0);
  useEffect(() => {
    const newCount = logs.length + (showCurrentRack ? 1 : 0);
    if (newCount > lastCountRef.current && selectedLogId === null) {
      const el = listRef.current;
      if (el) {
        const scroller = findScrollableAncestor(el);
        (scroller ?? el).scrollTo({ top: (scroller ?? el).scrollHeight, behavior: "smooth" });
      }
    }
    lastCountRef.current = newCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs.length, showCurrentRack]);

  // Stepping with the navigator moves the selection without a click, so bring the row to it.
  useEffect(() => {
    if (!selectedLogId) return;
    const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-log-id]") ?? [])].find(
      (element) => element.dataset.logId === selectedLogId,
    );
    row?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedLogId]);

  const viewOption = (option: BranchOption) => {
    setOpenFork(null);
    onViewOption?.(option);
  };

  return (
    <div className="turn-record-list" ref={listRef}>
      {logs.map((log) => {
        const options = forks?.atRow.get(log.id);
        return (
          <CompletedTurnRecord
            game={game}
            key={log.id}
            log={log}
            options={options}
            forkOpen={openFork === log.id}
            selected={selectedLogId === log.id}
            onSelect={() => onSelectLog(toggleSelection && selectedLogId === log.id ? null : log.id)}
            onToggleFork={() => setOpenFork((current) => (current === log.id ? null : log.id))}
            onViewOption={viewOption}
          />
        );
      })}

      {showCurrentRack && (
        <section className={`turn-record-group live side-${game.activeSide.toLowerCase()}`}>
          <div className="turn-record-summary">
            <span className="trs-turn">T{game.turnNumber}</span>
            <span className={`trs-side side-${game.activeSide.toLowerCase()}`}>{game.players[game.activeSide]}</span>
            <span className="trs-action">Ready · {activeRack.length}/{RACK_SIZE}</span>
            <span className="trs-live">Live</span>
          </div>
        </section>
      )}

      {forks && forks.afterEnd.length > 0 && (
        <section className="turn-record-continuations">
          <button
            type="button"
            className="trc-toggle"
            aria-expanded={openFork === "__end"}
            onClick={() => setOpenFork((current) => (current === "__end" ? null : "__end"))}
          >
            <GitBranch size={13} aria-hidden />
            {forks.afterEnd.length === 1
              ? "มีเส้นทางที่เดินต่อจากตรงนี้"
              : `มี ${forks.afterEnd.length} เส้นทางที่เดินต่อจากตรงนี้`}
          </button>
          {openFork === "__end" && (
            <ForkOptions game={game} options={forks.afterEnd} onView={viewOption} />
          )}
        </section>
      )}
    </div>
  );
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = window.getComputedStyle(node);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function CompletedTurnRecord({
  game,
  log,
  options,
  forkOpen,
  selected,
  onSelect,
  onToggleFork,
  onViewOption,
}: {
  game: GameState;
  log: TurnLog;
  options?: readonly BranchOption[];
  forkOpen: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleFork: () => void;
  onViewOption: (option: BranchOption) => void;
}) {
  const isPlace = log.action === "place_equation";
  const placedTiles = isPlace ? (log.actionDetail as PlaceEquationDetail).placedTiles : [];
  const placedAll = isPlace && placedTiles.length >= RACK_SIZE;
  const sideClass = `side-${log.side.toLowerCase()}`;
  const others = options ? options.length - 1 : 0;
  // Tiles a host swapped into this turn's rack (gameplay/drawEdit.ts). Shown, never hidden: a
  // turn played from a chosen rack is not the same kind of record as one the bag dealt.
  const drawEdits = (game.drawEdits ?? []).filter(
    (edit) => edit.turnNumber === log.turnNumber && edit.side === log.side,
  );
  const drawEditSummary = drawEdits.map((edit) => `${edit.from}→${edit.to}`).join(" · ");
  return (
    <section
      className={`turn-record-group ${sideClass} ${selected ? "selected" : ""} ${placedAll ? "bingo" : ""} ${others > 0 ? "has-fork" : ""}`}
      data-log-id={log.id}
    >
      <div className="turn-record-row">
        <button className="turn-record-summary" type="button" aria-current={selected ? "true" : undefined} onClick={onSelect}>
          <span className="trs-turn">T{log.turnNumber}</span>
          <span className={`trs-side ${sideClass}`}>
            {log.playedByName ?? game.players[log.side]}
            {drawEdits.length > 0 && (
              <span
                className="trs-draw-edit"
                aria-label={`host กำหนดเบี้ยในมือตานี้: ${drawEditSummary}`}
                title={`host กำหนดเบี้ยในมือตานี้: ${drawEditSummary}`}
              >
                host
              </span>
            )}
          </span>
          <span className="trs-action">{summaryText(log)}</span>
          <span className="trs-score">{log.finalScore} pts</span>
        </button>
        {others > 0 && (
          <button
            type="button"
            className="trs-fork"
            aria-expanded={forkOpen}
            aria-label={`ตานี้มีทางเลือกอื่น ${others} ทาง`}
            title={`ตานี้มีทางเลือกอื่น ${others} ทาง`}
            onClick={onToggleFork}
          >
            <GitBranch size={12} aria-hidden />
            {others}
          </button>
        )}
      </div>
      {forkOpen && options && <ForkOptions game={game} options={options} onView={onViewOption} />}
      {selected && (
        <div className="turn-record-detail">
          <div className="trd-tiles">
            <span>Before</span>
            <TileStrip tiles={log.rackBefore} />
          </div>
          <div className="trd-tiles">
            <span>After</span>
            <TileStrip muted tiles={log.rackAfter} />
          </div>
          {drawEdits.length > 0 && <p className="trd-draw-edit">host กำหนดเบี้ย: {drawEditSummary}</p>}
        </div>
      )}
    </section>
  );
}

/** The moves tried at one point. The one on the viewed line is marked, the rest open their line. */
function ForkOptions({
  game,
  options,
  onView,
}: {
  game: GameState;
  options: readonly BranchOption[];
  onView: (option: BranchOption) => void;
}) {
  return (
    <ul className="fork-options" aria-label="ทางเลือกที่จุดนี้">
      {options.map((option) => (
        <li key={option.id}>
          <button
            type="button"
            className={`fork-option side-${option.side.toLowerCase()}${option.current ? " is-current" : ""}`}
            disabled={option.current}
            onClick={() => onView(option)}
          >
            <span className="fo-side">{game.players[option.side] || option.side}</span>
            <span className="fo-move">{option.text}</span>
            <span className="fo-score">{option.score}</span>
            <span className="fo-meta">
              {option.current ? "กำลังดู" : option.live ? "เส้นที่เล่นอยู่" : `${option.length} ตา`}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TileStrip({ tiles, muted = false }: { tiles: TileInstance[]; muted?: boolean }) {
  return (
    <div className={`turn-record-tiles ${muted ? "muted" : ""}`}>
      {Array.from({ length: RACK_SIZE }).map((_, index) => {
        const tile = tiles[index];
        if (!tile) return <span className="turn-record-empty-tile" key={`empty-${index}`} />;
        return (
          <span className="turn-record-tile" key={tile.id}>
            <Tile compact showPoint tile={tile} />
          </span>
        );
      })}
    </div>
  );
}
