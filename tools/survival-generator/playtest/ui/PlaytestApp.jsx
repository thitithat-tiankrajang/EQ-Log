// Offline Survival playtest — the page. EQ-Lab's own Board and Rack draw the
// game; everything shown comes from the server's player view (server/engine.mjs
// `publicAttempt`), which never holds the bag order, Authur's rack or any
// generator analysis. The score preview is EQ-Lab's own `validateMove`; the
// server's rules engine has the final word on every move.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Board } from "../../../../src/components/board/Board.tsx";
import { Rack } from "../../../../src/components/board/Rack.tsx";
import {
  AMATH_TOKENS,
  boardWithPending,
  createBoard,
  getAssignmentOptions,
  tileNeedsAssignment,
  validateMove,
} from "../../../../src/game.ts";
import { api } from "./api.js";

const SIZE = 15;
const cellOf = (row, col) => row * SIZE + col;
const faceOf = (kind, face) => (tileNeedsAssignment(kind) ? face : AMATH_TOKENS[kind].token);
const noop = () => {};

/** The server's public board → EQ-Lab's BoardSnapshot. */
function toSnapshot(board, seats) {
  const snapshot = createBoard();
  for (const t of board) {
    const tile = tileNeedsAssignment(t.kind)
      ? { id: `board-${t.cell}`, token: t.kind, assignedToken: t.face }
      : { id: `board-${t.cell}`, token: t.kind };
    snapshot[Math.floor(t.cell / SIZE)][t.cell % SIZE] = { tile, placedTurn: t.turn, side: seats[t.owner] };
  }
  return snapshot;
}

/** The run of tiles through `cell` along one direction, as faces. */
function runThrough(cells, cell, dr, dc) {
  let row = Math.floor(cell / SIZE);
  let col = cell % SIZE;
  while (row - dr >= 0 && col - dc >= 0 && cells.has((row - dr) * SIZE + (col - dc))) {
    row -= dr;
    col -= dc;
  }
  const faces = [];
  while (row < SIZE && col < SIZE && cells.has(row * SIZE + col)) {
    faces.push(cells.get(row * SIZE + col));
    row += dr;
    col += dc;
  }
  return faces;
}

/**
 * Each placing turn with the whole equation it formed along its line, existing
 * tiles included. Rebuilt from the public moves alone, starting from `start`.
 */
function withLines(turns, start = new Map()) {
  const cells = new Map(start);
  const lines = turns.map((turn) => {
    if (turn.type !== "place") return null;
    for (const p of turn.placements) cells.set(p.cell, faceOf(p.kind, p.face));
    const first = turn.placements[0].cell;
    const sameRow = turn.placements.every((p) => Math.floor(p.cell / SIZE) === Math.floor(first / SIZE));
    const across = runThrough(cells, first, 0, 1);
    const down = runThrough(cells, first, 1, 0);
    const line = turn.placements.length > 1 ? (sameRow ? across : down) : across.length >= down.length ? across : down;
    return line.join("");
  });
  return { lines, cells };
}

function describe(turn, line) {
  if (turn.type === "place") return `วาง ${turn.placements.length} ตัว · ${line} · +${turn.scoreGained}`;
  if (turn.type === "exchange") return `แลกเบี้ย ${turn.tilesExchanged} ตัว`;
  return "ผ่าน";
}

function ending(result) {
  const who = (side) => (side === "player" ? "คุณ" : "Authur");
  if (result.reason === "rack_out") return `${who(result.bonusTo)}ลงเบี้ยหมดราง · โบนัส +${result.bonusPoints}`;
  if (result.bonusTo) return `6 ตาติดกันไม่มีแต้ม · ${who(result.bonusTo)}ได้ +${result.bonusPoints}`;
  return "6 ตาติดกันไม่มีแต้ม · แต้มในรางเท่ากัน ไม่มีโบนัส";
}

// ── level picker ─────────────────────────────────────────────────────────────
function LevelPicker({ levels, error, onStart }) {
  return (
    <main className="pt-page">
      <header className="pt-header">
        <p className="eq-eyebrow">Survival · Playtest (offline)</p>
        <h1>เลือกด่าน</h1>
        <p>เริ่มจากกลางเกมจริงของ Authur ปะทะ Authur แล้วเล่นต่อจนเกมจบ ต้องมีคะแนนสุดท้ายสูงกว่า Authur จึงจะชนะ</p>
      </header>
      {error && <p className="pt-error" role="alert">{error}</p>}
      {!levels ? (
        <p>กำลังโหลดด่าน…</p>
      ) : (
        <div className="pt-levels">
          {levels.map((level) => (
            <article className="pt-level" key={level.id}>
              <span className="eq-eyebrow">ด่าน {level.number}</span>
              <h2>ตามอยู่ {level.deficit} แต้ม</h2>
              <p>
                คุณ {level.scores.player} : Authur {level.scores.authur}
              </p>
              <p>
                ตาที่ {level.turnNumber} · เบี้ยในถุง {level.bagRemaining}
              </p>
              <button className="eq-button eq-button-primary" type="button" onClick={() => onStart(level.id)}>
                เริ่มด่านนี้
              </button>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

// ── logs ─────────────────────────────────────────────────────────────────────
function SourceLog({ log }) {
  const { lines } = withLines(log.turns);
  return (
    <details className="pt-log">
      <summary>บันทึกเกมก่อนเริ่มด่าน · Authur ปะทะ Authur {log.turns.length} ตา</summary>
      <ol>
        {log.turns.map((t, i) => (
          <li key={t.turn}>
            <span className="pt-log-turn">ตา {t.turn}</span>
            <span className="pt-log-who">{t.seat === "player" ? "ฝั่งคุณ (Authur เล่นแทน)" : "Authur"}</span>
            <span className="pt-log-move">{describe(t, lines[i])}</span>
            <span className="pt-log-score">
              {t.scoresAfter.player}:{t.scoresAfter.authur}
            </span>
          </li>
        ))}
      </ol>
      <p className="pt-log-note">▼ คุณรับช่วงต่อที่ตา {log.takeover.turn}</p>
    </details>
  );
}

function AttemptLog({ log, sourceLog }) {
  if (log.length === 0) return <p className="pt-log-note">ยังไม่มีการเดินในรอบนี้</p>;
  const { lines } = withLines(log, withLines(sourceLog.turns).cells);
  return (
    <ol className="pt-log pt-attempt-log">
      {log.map((t, i) => (
        <li key={t.turn} className={t.seat === "player" ? "is-player" : "is-authur"}>
          <span className="pt-log-turn">ตา {t.turn}</span>
          <span className="pt-log-who">{t.seat === "player" ? "คุณ" : "Authur"}</span>
          <span className="pt-log-move">{describe(t, lines[i])}</span>
          <span className="pt-log-score">
            {t.scoresAfter.player}:{t.scoresAfter.authur}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── the game ─────────────────────────────────────────────────────────────────
function Game({ initial, onRetry, onExit }) {
  const [game, setGame] = useState(initial);
  const [pending, setPending] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [mode, setMode] = useState("place");
  const [exchangeIds, setExchangeIds] = useState([]);
  const [picker, setPicker] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  const [thinkingSince, setThinkingSince] = useState(null);
  const [now, setNow] = useState(Date.now());

  const board = useMemo(() => toSnapshot(game.board, game.seats), [game.board, game.seats]);
  // As in EQ-Lab's Play screen: the board shows the move being composed; the preview scores it against the board without it.
  const shown = useMemo(
    () => (pending.length ? boardWithPending(board, pending, game.turnNumber, game.seats.player) : board),
    [board, pending, game.turnNumber, game.seats.player],
  );
  const myTurn = game.status === "your-turn" && !busy;
  const pendingIds = new Set(pending.map((p) => p.tile.id));
  const rackTiles = game.rack.filter((t) => !pendingIds.has(t.id)).map((t) => ({ id: t.id, token: t.kind }));
  const preview = pending.length > 0 ? validateMove(board, pending) : null;

  // Where Authur just played, marked on the board.
  const lastAuthur = [...game.log].reverse().find((t) => t.seat === "authur");
  const marks = useMemo(() => {
    const map = new Map();
    if (lastAuthur?.placements && game.log.at(-1) === lastAuthur) {
      for (const p of lastAuthur.placements) {
        map.set(`${Math.floor(p.cell / SIZE)}:${p.cell % SIZE}`, { tone: "selected", label: "ตาล่าสุดของ Authur" });
      }
    }
    return map;
  }, [game.log, lastAuthur]);

  // Callbacks the board and rack keep across renders read the latest state here.
  const live = useRef(null);
  live.current = { game, pending, selectedId, mode, busy };

  const runAuthur = useCallback(async (attemptId) => {
    setBusy("authur");
    setThinkingSince(Date.now());
    setMessage(null);
    try {
      setGame(await api.authur(attemptId));
    } catch (error) {
      setMessage(`Authur: ${error.message}`);
    } finally {
      setBusy(null);
      setThinkingSince(null);
    }
  }, []);

  useEffect(() => {
    if (game.status === "authur-to-move" && live.current.busy === null) void runAuthur(game.attemptId);
  }, [game.status, game.attemptId, game.turnNumber, runAuthur]);

  useEffect(() => {
    if (thinkingSince === null) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [thinkingSince]);

  const onCellClick = useCallback((row, col) => {
    const { game: g, pending: placed, selectedId: selected, mode: m, busy: b } = live.current;
    if (g.status !== "your-turn" || b || m !== "place") return;
    const here = placed.find((p) => p.row === row && p.col === col);
    if (here) {
      setPending(placed.filter((p) => p !== here));
      setSelectedId(here.tile.id);
      return;
    }
    if (!selected || g.board.some((t) => t.cell === cellOf(row, col))) return;
    const tile = g.rack.find((t) => t.id === selected);
    if (!tile) return;
    setPending([...placed, { tile: { id: tile.id, token: tile.kind }, row, col }]);
    setSelectedId(null);
    if (tileNeedsAssignment(tile.kind)) setPicker(tile.id);
  }, []);

  const onRackTileClick = useCallback((tile) => {
    const { game: g, selectedId: selected, mode: m, busy: b } = live.current;
    if (g.status !== "your-turn" || b) return;
    if (m === "exchange") {
      setExchangeIds((ids) => (ids.includes(tile.id) ? ids.filter((id) => id !== tile.id) : [...ids, tile.id]));
      return;
    }
    setSelectedId(selected === tile.id ? null : tile.id);
  }, []);

  const onExchangeSelectTiles = useCallback((ids, additive) => {
    setExchangeIds((current) => (additive ? [...new Set([...current, ...ids])] : ids));
  }, []);

  const onAssignmentEdit = useCallback((tileId) => setPicker(tileId), []);

  async function send(move) {
    setBusy("move");
    setMessage(null);
    try {
      const next = await api.move(game.attemptId, move);
      setPending([]);
      setSelectedId(null);
      setExchangeIds([]);
      setMode("place");
      setGame(next);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(null);
    }
  }

  const submit = () =>
    send({
      type: "place",
      placements: pending.map((p) => ({ tileId: p.tile.id, cell: cellOf(p.row, p.col), face: p.assignedToken })),
    });
  const exchange = () => send({ type: "exchange", tileIds: exchangeIds });
  const pass = () => {
    if (window.confirm("ผ่านตานี้? (นับเป็นตาที่ไม่มีแต้ม)")) void send({ type: "pass" });
  };
  const recall = () => {
    setPending([]);
    setSelectedId(null);
  };
  const retry = () => {
    if (game.status === "finished" || window.confirm("เริ่มด่านนี้ใหม่จากจุดเริ่มเดิม? รอบนี้จะถูกบันทึกไว้แบบยังไม่จบ")) onRetry();
  };
  const exit = () => {
    if (game.status === "finished" || window.confirm("กลับไปเลือกด่าน? รอบนี้จะถูกบันทึกไว้แบบยังไม่จบ")) onExit();
  };

  const pickerTile = picker ? pending.find((p) => p.tile.id === picker) : null;
  const diff = game.scores.player - game.scores.authur;
  const status =
    game.status === "finished"
      ? "เกมจบแล้ว"
      : game.status === "your-turn"
        ? "ตาของคุณ"
        : `Authur กำลังคิด… ${thinkingSince ? Math.max(0, Math.round((now - thinkingSince) / 1000)) : 0} วินาที`;

  return (
    <main className="pt-page pt-game">
      <header className="pt-game-header">
        <div>
          <p className="eq-eyebrow">
            Survival · Playtest · ด่าน {game.level.number}
          </p>
          <h1>{status}</h1>
        </div>
        <div className="pt-actions">
          <button className="eq-button" type="button" onClick={retry} disabled={busy !== null}>
            เล่นใหม่
          </button>
          <button className="eq-button" type="button" onClick={exit} disabled={busy !== null}>
            เลือกด่าน
          </button>
        </div>
      </header>

      <section className="pt-scoreboard" aria-label="คะแนน">
        <div className={`pt-score ${game.status === "your-turn" ? "is-active" : ""}`}>
          <span>คุณ</span>
          <strong>{game.scores.player}</strong>
        </div>
        <div className="pt-score-diff">{diff === 0 ? "เสมอ" : diff > 0 ? `นำ ${diff}` : `ตาม ${-diff}`}</div>
        <div className={`pt-score ${game.status === "authur-to-move" ? "is-active" : ""}`}>
          <span>Authur</span>
          <strong>{game.scores.authur}</strong>
        </div>
        <dl className="pt-facts">
          <div>
            <dt>ตาที่</dt>
            <dd>{game.turnNumber}</dd>
          </div>
          <div>
            <dt>เบี้ยในถุง</dt>
            <dd>{game.bagCount}</dd>
          </div>
          <div>
            <dt>Authur ถือ</dt>
            <dd>{game.authurRackCount} ตัว</dd>
          </div>
          <div>
            <dt>ตาไม่มีแต้มติดกัน</dt>
            <dd>{game.scorelessStreak}/6</dd>
          </div>
        </dl>
      </section>

      <div className="pt-layout">
        <div className="pt-board-column">
          <Rack
            rack={[]}
            hiddenCount={game.authurRackCount}
            side={game.seats.authur}
            label="Authur"
            active={game.status === "authur-to-move"}
            selectedRackTileId={null}
            exchangeOutgoingIds={[]}
            onTileClick={noop}
          />
          <Board
            board={shown}
            pendingPlacements={pending}
            cellMarks={marks}
            selectedRackTileId={selectedId}
            selectedPendingTileId={null}
            onCellClick={onCellClick}
            onPendingAssignmentEdit={onAssignmentEdit}
          />
          <Rack
            rack={rackTiles}
            side={game.seats.player}
            label="เบี้ยของคุณ"
            active={myTurn}
            selectedRackTileId={selectedId}
            exchangeOutgoingIds={exchangeIds}
            actionMode={mode === "exchange" ? "exchange" : "none"}
            onTileClick={onRackTileClick}
            onExchangeSelectTiles={onExchangeSelectTiles}
          />

          {game.status !== "finished" && (
            <div className="pt-controls">
              {mode === "place" ? (
                <>
                  <button className="eq-button eq-button-primary" type="button" onClick={submit} disabled={!myTurn || pending.length === 0}>
                    ส่งตา
                  </button>
                  <button className="eq-button" type="button" onClick={recall} disabled={!myTurn || pending.length === 0}>
                    เก็บเบี้ยคืน
                  </button>
                  <button
                    className="eq-button"
                    type="button"
                    onClick={() => {
                      recall();
                      setMode("exchange");
                    }}
                    disabled={!myTurn || !game.exchangeAllowed}
                    title={game.exchangeAllowed ? "" : "แลกไม่ได้: เบี้ยในถุงเหลือน้อยเกินไป"}
                  >
                    แลกเบี้ย
                  </button>
                  <button className="eq-button" type="button" onClick={pass} disabled={!myTurn}>
                    ผ่าน
                  </button>
                </>
              ) : (
                <>
                  <button className="eq-button eq-button-primary" type="button" onClick={exchange} disabled={!myTurn || exchangeIds.length === 0}>
                    แลก {exchangeIds.length} ตัว
                  </button>
                  <button
                    className="eq-button"
                    type="button"
                    onClick={() => {
                      setMode("place");
                      setExchangeIds([]);
                    }}
                  >
                    ยกเลิก
                  </button>
                  <span className="pt-hint">แตะเบี้ยที่จะแลก</span>
                </>
              )}
            </div>
          )}

          {preview && (
            <p className={`pt-preview ${preview.isValid ? "is-valid" : "is-invalid"}`}>
              {preview.isValid ? `ถ้าส่งตานี้: +${preview.score} แต้ม` : preview.errors[0]}
            </p>
          )}
          {message && (
            <p className="pt-error" role="alert">
              {message}
              {game.status === "authur-to-move" && busy === null && (
                <button className="eq-button" type="button" onClick={() => void runAuthur(game.attemptId)}>
                  ให้ Authur เดินอีกครั้ง
                </button>
              )}
            </p>
          )}
          {game.status === "your-turn" && pending.length === 0 && mode === "place" && !message && (
            <p className="pt-hint">แตะเบี้ยในราง แล้วแตะช่องบนกระดาน · แตะเบี้ยที่วางแล้วเพื่อยกออก · เบี้ยพิเศษดับเบิลคลิกเพื่อเปลี่ยนค่า</p>
          )}
        </div>

        <aside className="pt-side">
          {game.result && (
            <section className={`pt-result is-${game.result.outcome}`} aria-live="polite">
              <h2>{game.result.outcome === "win" ? "คุณชนะ!" : game.result.outcome === "loss" ? "คุณแพ้" : "เสมอ"}</h2>
              <p className="pt-result-score">
                คุณ {game.result.scores.player} : Authur {game.result.scores.authur}
                <span> ({game.result.margin > 0 ? "+" : ""}{game.result.margin})</span>
              </p>
              <p>{ending(game.result)}</p>
              <p>
                เล่นไป {game.result.yourTurns} ตา · Authur {game.result.authurTurns} ตา
              </p>
              {game.result.savedAs && <p className="pt-log-note">บันทึกไว้ที่ {game.result.savedAs}</p>}
              <div className="pt-actions">
                <button className="eq-button eq-button-primary" type="button" onClick={onRetry}>
                  เล่นด่านนี้ใหม่
                </button>
                <button className="eq-button" type="button" onClick={onExit}>
                  เลือกด่าน
                </button>
              </div>
            </section>
          )}
          <section>
            <h2 className="pt-side-title">รอบนี้</h2>
            <AttemptLog log={game.log} sourceLog={game.sourceLog} />
          </section>
          <section>
            <SourceLog log={game.sourceLog} />
          </section>
        </aside>
      </div>

      {pickerTile && (
        <div className="pt-picker" role="dialog" aria-label="เลือกค่าเบี้ย">
          <div className="pt-picker-card">
            <h2>เลือกค่าให้เบี้ย {AMATH_TOKENS[pickerTile.tile.token].token}</h2>
            <div className="pt-picker-options">
              {getAssignmentOptions(pickerTile.tile.token).map((value) => (
                <button
                  key={value}
                  className={`eq-button ${pickerTile.assignedToken === value ? "eq-button-primary" : ""}`}
                  type="button"
                  onClick={() => {
                    setPending((placed) => placed.map((p) => (p.tile.id === picker ? { ...p, assignedToken: value } : p)));
                    setPicker(null);
                  }}
                >
                  {value}
                </button>
              ))}
            </div>
            <button className="eq-button" type="button" onClick={() => setPicker(null)}>
              ปิด
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

// ── the app ──────────────────────────────────────────────────────────────────
export function PlaytestApp() {
  const [levels, setLevels] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [error, setError] = useState(null);

  // The attempt id lives in the URL, so a reload resumes the same game (while the server runs).
  const show = (next) => {
    setAttempt(next);
    window.history.replaceState(null, "", next ? `?attempt=${encodeURIComponent(next.attemptId)}` : window.location.pathname);
  };

  useEffect(() => {
    api
      .levels()
      .then((data) => setLevels(data.levels))
      .catch((cause) => setError(cause.message));
    const resume = new URLSearchParams(window.location.search).get("attempt");
    if (resume) {
      api
        .attempt(resume)
        .then(show)
        .catch((cause) => {
          setError(`เล่นรอบเดิมต่อไม่ได้: ${cause.message}`);
          show(null);
        });
    }
  }, []);

  const start = async (levelId) => {
    setError(null);
    try {
      show(await api.start(levelId));
    } catch (cause) {
      setError(cause.message);
      show(null);
    }
  };

  if (!attempt) return <LevelPicker levels={levels} error={error} onStart={start} />;
  return <Game key={attempt.attemptId} initial={attempt} onRetry={() => start(attempt.level.id)} onExit={() => show(null)} />;
}
