// ── Study: hand the engine a position and ask what it would play ─────────────
//
// Everything else in this app is a GAME — a room, a turn order, a log. Study is
// the opposite of that on purpose: there is no room, no opponent, no clock and
// no history of how the position arose. You type a board, you type your rack,
// you pick a strength, and the engine answers.
//
// The one thing that IS kept is the answer. Each analysis writes a permanent
// record of the top ten moves, and the list at the bottom of this page is that
// archive. The record is written by the SERVER at the moment the search
// finishes, not by this page, so closing the tab during a long `super` search
// still leaves the result behind.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, ChevronLeft, Loader2, Plus, Sparkles, Trash2, TriangleAlert } from "lucide-react";

import { ApplicationShell } from "../../../app/shells/ApplicationShell";
import { AccountChip, useAuth } from "../../../auth";
import { Board } from "../../board/Board";

/** Read-only boards take no clicks. Module-level so the identity is stable, which
 *  is what `Board`'s picture comparison asks of every callback it is given. */
const NO_CELL_CLICK = () => {};
import { Tile } from "../../board/Tile";
import {
  EngineApiError,
  isEngineApiConfigured,
  requestStudyAnalysis,
  type EngineProgress,
  type EngineQueueState,
  type StudyAnalysisResult,
} from "../../../bot/engineApi";
import { AMATH_TOKENS, type AmathToken } from "../../../constants/tileDefinitions";
import { BOARD_SIZE } from "../../../constants/gameRules";
import {
  createBoard,
  displayToken,
  findBoardEquationIssues,
  getAssignmentOptions,
  tileNeedsAssignment,
  type BoardSnapshot,
  type TileInstance,
} from "../../../game";
import {
  deleteStudyRecord,
  listStudyRecords,
  type StudyRecord,
} from "../../../features/study/repository";
// The board and the tiles bring their own stylesheet. `play-styles.css` ships
// only with the lazily loaded Play chunk (see AppRoot.tsx), so a <Board> on any
// other route renders as unstyled markup — a vertical stack of 225 buttons and
// transparent tiles — unless the page asks for these itself.
import "../../../board-styles.css";
import { StudyRanking } from "./StudyRanking";
import { KEY_LEGEND, resolveStudyKey, type TileStroke } from "../../../gameplay/tileKeys";
import { TOKEN_LIST, countUsage, hiddenInventory, remainingOf } from "./tileSupply";

const RACK_LIMIT = 8;

type Direction = "right" | "down" | "left" | "up";
type Cursor = { row: number; col: number; dir: Direction };

/** right → down → left → up → off. The same cycle the play board uses, so the
 *  gesture a player already knows means the same thing here. */
const DIRECTION_CYCLE: Direction[] = ["right", "down", "left", "up"];

const STEP: Record<Direction, [number, number]> = {
  right: [0, 1],
  down: [1, 0],
  left: [0, -1],
  up: [-1, 0],
};

/** The next empty square in the cursor's direction, skipping tiles already
 *  there — so typing a word across an existing letter does what it looks like. */
function advanceCursor(cursor: Cursor, board: BoardSnapshot): Cursor | null {
  const [dr, dc] = STEP[cursor.dir];
  let { row, col } = cursor;
  for (;;) {
    row += dr;
    col += dc;
    if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
    if (!board[row]?.[col]) return { row, col, dir: cursor.dir };
  }
}

/** One square back along the direction of travel, occupied or not: this is what
 *  Backspace undoes, and it has to reach the tile that was just typed. */
function retreatCursor(cursor: Cursor): Cursor | null {
  const [dr, dc] = STEP[cursor.dir];
  const row = cursor.row - dr;
  const col = cursor.col - dc;
  if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return null;
  return { row, col, dir: cursor.dir };
}

type Step = "board" | "rack" | "review" | "level" | "running" | "result";

const LEVELS: Array<{ value: string; label: string; desc: string; meter: number }> = [
  { value: "medium", label: "Fast", desc: "คิดเร็ว ตอบไวที่สุด", meter: 1 },
  { value: "hard", label: "Balanced", desc: "ค้นลึกขึ้น เล่นคมขึ้น", meter: 2 },
  { value: "max", label: "Deep", desc: "เต็มกำลังภายใต้เพดานเวลาของเอนจิน", meter: 3 },
  {
    value: "super",
    label: "Unlimited",
    desc: "ไม่จำกัดเวลา คิดจนครบ 100% — ตาละหลายนาที",
    meter: 4,
  },
];

function newTile(token: AmathToken, assignedToken?: string): TileInstance {
  return assignedToken
    ? { id: crypto.randomUUID(), token, assignedToken }
    : { id: crypto.randomUUID(), token };
}

export function StudyPage() {
  const { configured, userId } = useAuth();

  const [step, setStep] = useState<Step>("board");
  const [scoreSelf, setScoreSelf] = useState(0);
  const [scoreOpponent, setScoreOpponent] = useState(0);
  const [board, setBoard] = useState<BoardSnapshot>(() => createBoard());
  const [rack, setRack] = useState<TileInstance[]>([]);
  const [activeToken, setActiveToken] = useState<AmathToken | null>(null);
  const [cursor, setCursor] = useState<Cursor | null>(null);
  /** Whether `B` is waiting for the face the blank stands in for. Modal by
   *  design — a prefix costs one extra unmodified key and buys all 25 faces,
   *  where a modifier for each would need combinations no platform leaves
   *  free. It is shown on screen so it can never be silently armed. */
  const [blankArmed, setBlankArmed] = useState(false);

  const [level, setLevel] = useState<string>("max");
  const [result, setResult] = useState<StudyAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<EngineProgress | null>(null);
  const [queued, setQueued] = useState<EngineQueueState | null>(null);

  const [records, setRecords] = useState<StudyRecord[]>([]);
  const [recordsError, setRecordsError] = useState<string | null>(null);
  const [openRecord, setOpenRecord] = useState<StudyRecord | null>(null);

  const used = useMemo(() => countUsage(board, rack), [board, rack]);
  const inventory = useMemo(() => hiddenInventory(used), [used]);
  const issues = useMemo(() => findBoardEquationIssues(board), [board]);

  const refreshRecords = useCallback(() => {
    if (!userId) return;
    listStudyRecords()
      .then((rows) => {
        setRecords(rows);
        setRecordsError(null);
      })
      .catch((cause: unknown) =>
        setRecordsError(cause instanceof Error ? cause.message : "โหลดรายการไม่สำเร็จ"),
      );
  }, [userId]);

  useEffect(refreshRecords, [refreshRecords]);

  // Clicking the board is about the CURSOR, never about placing directly: an
  // occupied square gives its tile back, an empty one takes the cursor and then
  // cycles its direction. Tiles arrive from the keyboard or the palette, always
  // at the cursor — one destination instead of two competing ones.
  // `Board` compares its picture and ignores callback identity, so the callback
  // it is handed must be stable. Same ref indirection as the Play view: fixed
  // identity, current behaviour.
  const cellClickRef = useRef<(row: number, col: number) => void>(() => {});
  const handleCellClick = useCallback(
    (row: number, col: number) => cellClickRef.current(row, col),
    [],
  );
  cellClickRef.current = (row: number, col: number) => {
    if (board[row]?.[col]) {
      const next = board.map((line) => [...line]);
      next[row]![col] = null;
      setBoard(next);
      return;
    }
    if (cursor && cursor.row === row && cursor.col === col) {
      const position = DIRECTION_CYCLE.indexOf(cursor.dir);
      const nextDir = DIRECTION_CYCLE[position + 1];
      setCursor(nextDir ? { row, col, dir: nextDir } : null);
      return;
    }
    setCursor({ row, col, dir: "right" });
  };

  const addToRack = useCallback(
    (token: AmathToken) => {
      setRack((current) => {
        if (current.length >= RACK_LIMIT) return current;
        if (remainingOf(countUsage(board, current), token) <= 0) return current;
        return [...current, newTile(token)];
      });
    },
    [board],
  );

  /** Put one tile down: at the cursor on the board step, on the rack otherwise.
   *  The keyboard and the palette both come through here, so they cannot drift
   *  apart. */
  const placeStroke = useCallback(
    (stroke: TileStroke) => {
      if (step === "rack") {
        // A rack tile has no face — a blank in hand is still a blank, and which
        // value it is played as is a decision the engine makes, not this page.
        addToRack(stroke.token);
        return;
      }
      if (step !== "board" || !cursor) return;
      if (board[cursor.row]?.[cursor.col]) return;
      if (remainingOf(used, stroke.token) <= 0) return;
      const face =
        stroke.assignedToken ??
        (tileNeedsAssignment(stroke.token) ? getAssignmentOptions(stroke.token)[0] : undefined);
      const next = board.map((line) => [...line]);
      next[cursor.row]![cursor.col] = {
        tile: newTile(stroke.token, face),
        placedTurn: 0,
        side: "A",
      };
      setBoard(next);
      setCursor(advanceCursor(cursor, next));
    },
    [addToRack, board, cursor, step, used],
  );

  const moveCursor = useCallback((dir: Direction) => {
    setCursor((current) => {
      if (!current) return { row: 7, col: 7, dir };
      const [dr, dc] = STEP[dir];
      const row = current.row + dr;
      const col = current.col + dc;
      if (row < 0 || col < 0 || row >= BOARD_SIZE || col >= BOARD_SIZE) return current;
      // Moving does not re-aim: a player nudging the cursor into place is
      // still typing the same way when they get there.
      return { row, col, dir: current.dir };
    });
  }, []);

  const toggleDirection = useCallback((cycleAll: boolean) => {
    setCursor((current) => {
      if (!current) return current;
      if (cycleAll) {
        const at = DIRECTION_CYCLE.indexOf(current.dir);
        return { ...current, dir: DIRECTION_CYCLE[(at + 1) % DIRECTION_CYCLE.length]! };
      }
      // Right and down are the two a player actually alternates between; the
      // other two are behind Shift so this stays a single tap.
      return { ...current, dir: current.dir === "right" ? "down" : "right" };
    });
  }, []);

  const eraseHere = useCallback(() => {
    if (!cursor || !board[cursor.row]?.[cursor.col]) return;
    const next = board.map((line) => [...line]);
    next[cursor.row]![cursor.col] = null;
    setBoard(next);
  }, [board, cursor]);

  /** Backspace: step back along the direction of travel and clear that square. */
  const eraseBack = useCallback(() => {
    if (!cursor) return;
    const back = retreatCursor(cursor);
    if (!back) return;
    if (board[back.row]?.[back.col]) {
      const next = board.map((line) => [...line]);
      next[back.row]![back.col] = null;
      setBoard(next);
    }
    setCursor(back);
  }, [board, cursor]);

  /** Enter: take the current step forward, but only when it is actually ready.
   *  Gated so a stray Enter cannot skip past a board or a rack that is not
   *  finished — the one way this shortcut could cost more time than it saves. */
  const confirmStep = useCallback(() => {
    setStep((current) => {
      if (current === "board") return "rack";
      if (current === "rack") return rack.length > 0 ? "review" : current;
      if (current === "review") return "level";
      return current;
    });
  }, [rack.length]);

  const pickToken = (token: AmathToken) => {
    // Two-faced tiles arm the face row instead of landing immediately: placing
    // `+/-` as `+` when the player meant `-` is a silent wrong answer, and they
    // would have to spot it on the board to notice.
    if (tileNeedsAssignment(token)) {
      setActiveToken((current) => (current === token ? null : token));
      return;
    }
    setActiveToken(null);
    placeStroke({ token });
  };

  // Typing a position. Bound to the window rather than to the board, because
  // the board is a grid of buttons and requiring the right one to hold focus
  // would make the first keystroke after any click do nothing.
  useEffect(() => {
    if (step !== "board" && step !== "rack" && step !== "review") return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // The score fields are text inputs. Typing `5` into one must mean five,
      // not a tile.
      if (
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      const action = resolveStudyKey(event, blankArmed);
      if (!action) return;
      // Only now: an unclaimed keystroke belongs to the browser.
      event.preventDefault();

      switch (action.kind) {
        case "armBlank":
          setBlankArmed(true);
          return;
        case "bareBlank":
          setBlankArmed(false);
          placeStroke({ token: "?" });
          return;
        case "tile":
          setBlankArmed(false);
          placeStroke(action.stroke);
          return;
        case "cancel":
          if (blankArmed) setBlankArmed(false);
          else setCursor(null);
          return;
        case "toggleDirection":
          toggleDirection(action.cycleAll);
          return;
        case "move":
          moveCursor(action.dir);
          return;
        case "eraseBack":
          eraseBack();
          return;
        case "eraseHere":
          eraseHere();
          return;
        case "confirmStep":
          confirmStep();
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    blankArmed,
    confirmStep,
    eraseBack,
    eraseHere,
    moveCursor,
    placeStroke,
    step,
    toggleDirection,
  ]);

  if (!configured || !userId) {
    return (
      <ApplicationShell title="Study" actions={<AccountChip />} routeKey="study">
        <section className="eq-state eq-state-access">
          <Sparkles size={30} />
          <h2>ลงชื่อเข้าใช้เพื่อใช้ Study</h2>
          <p>โจทย์ที่วิเคราะห์แล้วจะถูกเก็บไว้กับบัญชีของคุณ</p>
        </section>
      </ApplicationShell>
    );
  }

  const startOver = () => {
    setStep("board");
    setBoard(createBoard());
    setRack([]);
    setScoreSelf(0);
    setScoreOpponent(0);
    setResult(null);
    setError(null);
    setProgress(null);
    setQueued(null);
    setOpenRecord(null);
    setCursor(null);
    setActiveToken(null);
    setBlankArmed(false);
  };

  const analyse = async (chosen: string) => {
    setLevel(chosen);
    setStep("running");
    setError(null);
    setProgress(null);
    setQueued(null);
    try {
      const answer = await requestStudyAnalysis({
        scoreSelf,
        scoreOpponent,
        board: board.flatMap((line, r) =>
          line.flatMap((cell, c) =>
            cell ? [{ r, c, kind: cell.tile.token, token: displayTokenFor(cell.tile) }] : [],
          ),
        ),
        rack: rack.map((tile) => tile.token),
        level: chosen,
        onQueued: setQueued,
        onRunning: () => setQueued(null),
        onProgress: setProgress,
      });
      setResult(answer);
      setStep("result");
      refreshRecords();
    } catch (cause) {
      setError(
        cause instanceof EngineApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "วิเคราะห์ไม่สำเร็จ",
      );
      setStep("level");
    }
  };

  const removeRecord = async (id: string) => {
    try {
      await deleteStudyRecord(id);
      setRecords((current) => current.filter((record) => record.id !== id));
      setOpenRecord((current) => (current?.id === id ? null : current));
    } catch (cause) {
      setRecordsError(cause instanceof Error ? cause.message : "ลบไม่สำเร็จ");
    }
  };

  if (openRecord) {
    return (
      <ApplicationShell
        title="โจทย์ที่บันทึกไว้"
        eyebrow="Study"
        actions={<AccountChip />}
        routeKey="study"
        onBack={() => setOpenRecord(null)}
        backLabel="กลับไปรายการ"
      >
        <SavedRecordView record={openRecord} />
      </ApplicationShell>
    );
  }

  return (
    <ApplicationShell
      title="Study"
      description="ตั้งโจทย์เอง แล้วให้บอทวิเคราะห์ — ไม่มีห้อง ไม่มีเทิร์น ไม่มี log"
      actions={<AccountChip />}
      routeKey="study"
    >
      {!isEngineApiConfigured && (
        <p className="info-banner">
          ยังไม่ได้ตั้งค่า engine service (VITE_ENGINE_API_URL) จึงยังวิเคราะห์ไม่ได้
        </p>
      )}
      {error && <p className="sync-banner">{error}</p>}

      <StepTrail step={step} />

      {step === "board" && (
        <section className="study-step" aria-label="ตั้งกระดานและแต้ม">
          <div className="study-scores">
            <ScoreField label="แต้มของคุณ" value={scoreSelf} onChange={setScoreSelf} />
            <ScoreField label="แต้มคู่แข่ง" value={scoreOpponent} onChange={setScoreOpponent} />
          </div>

          <p className="study-hint">
            แตะช่องว่างเพื่อวางเคอร์เซอร์ แล้ว<b>พิมพ์ได้เลย</b> · <kbd>Space</kbd> สลับทิศ → ↔ ↓ ·{" "}
            <kbd>⌫</kbd> ลบถอยหลัง · <kbd>Enter</kbd> ไปขั้นถัดไป · แตะเบี้ยที่วางแล้วเพื่อเอาออก
          </p>

          <div className="study-board">
            <Board
              board={board}
              pendingPlacements={[]}
              placementCursor={cursor}
              selectedRackTileId={null}
              selectedPendingTileId={null}
              onCellClick={handleCellClick}
            />
          </div>

          {blankArmed ? (
            <p className="study-hint study-armed" role="status">
              Blank พร้อมแล้ว — กดปุ่มของสิ่งที่จะให้มันแทน (เช่น <kbd>7</kbd> · <kbd>⇧3</kbd> ·{" "}
              <kbd>P</kbd> · <kbd>=</kbd>) หรือ <kbd>B</kbd> อีกครั้งเพื่อวางเป็นช่องว่าง ·{" "}
              <kbd>Esc</kbd> ยกเลิก
            </p>
          ) : (
            !cursor && (
              <p className="study-hint study-cursor-hint">
                ยังไม่มีเคอร์เซอร์ — แตะช่องบนกระดานก่อน แล้วค่อยพิมพ์
              </p>
            )
          )}

          <TilePalette
            used={used}
            active={activeToken}
            onPick={pickToken}
            onPlaceFace={(token, face) => placeStroke({ token, assignedToken: face })}
          />

          <KeyLegend />

          <BoardIssues issues={issues} />

          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={startOver}>
              ล้างกระดาน
            </button>
            <button type="button" className="primary-button" onClick={() => setStep("rack")}>
              ยืนยันกระดาน
            </button>
          </div>
        </section>
      )}

      {step === "rack" && (
        <section className="study-step" aria-label="เลือกเบี้ยในมือ">
          <p className="study-hint">
            พิมพ์หรือแตะเพื่อเพิ่มเบี้ยที่ถืออยู่ ได้สูงสุด {RACK_LIMIT} ตัว ·
            แตะเบี้ยในมือเพื่อเอาออก
          </p>

          <div className="study-rack" role="list" aria-label="เบี้ยในมือ">
            {rack.map((tile) => (
              <button
                key={tile.id}
                type="button"
                className="study-rack-tile"
                onClick={() => setRack((current) => current.filter((item) => item.id !== tile.id))}
                aria-label={`เอา ${displayToken(tile)} ออกจากมือ`}
              >
                <Tile tile={tile} />
              </button>
            ))}
            {rack.length === 0 && <p className="study-empty">ยังไม่ได้เลือกเบี้ย</p>}
          </div>

          {blankArmed && (
            <p className="study-hint study-armed" role="status">
              Blank พร้อมแล้ว — กด <kbd>B</kbd> อีกครั้งเพื่อใส่ Blank เปล่าลงมือ · <kbd>Esc</kbd>{" "}
              ยกเลิก
            </p>
          )}

          <TilePalette used={used} active={null} onPick={addToRack} />

          <KeyLegend />

          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={() => setStep("board")}>
              <ChevronLeft size={16} aria-hidden /> กลับไปแก้กระดาน
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={rack.length === 0}
              onClick={() => setStep("review")}
            >
              ยืนยันเบี้ยในมือ
            </button>
          </div>
        </section>
      )}

      {step === "review" && (
        <section className="study-step" aria-label="ตรวจทานโจทย์">
          <h2 className="study-heading">ตรวจทานโจทย์</h2>
          <PositionSummary
            scoreSelf={scoreSelf}
            scoreOpponent={scoreOpponent}
            rack={rack}
            oppRackCount={inventory.oppRackCount}
            bagCount={inventory.bagCount}
          />
          <div className="study-board is-readonly">
            <Board
              board={board}
              pendingPlacements={[]}
              selectedRackTileId={null}
              selectedPendingTileId={null}
              onCellClick={NO_CELL_CLICK}
            />
          </div>
          <BoardIssues issues={issues} />
          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={() => setStep("board")}>
              แก้กระดาน
            </button>
            <button type="button" className="ghost-button" onClick={() => setStep("rack")}>
              แก้เบี้ยในมือ
            </button>
            <button type="button" className="primary-button" onClick={() => setStep("level")}>
              โจทย์ถูกต้อง ไปเลือกระดับบอท
            </button>
          </div>
        </section>
      )}

      {step === "level" && (
        <section className="study-step" aria-label="เลือกระดับบอท">
          <h2 className="study-heading">ให้บอทระดับไหนคิด</h2>
          <div className="study-levels">
            {LEVELS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`study-level${level === option.value ? " is-active" : ""}`}
                onClick={() => void analyse(option.value)}
                disabled={!isEngineApiConfigured}
              >
                <span className="study-level-head">
                  <Bot size={18} aria-hidden />
                  <strong>{option.label}</strong>
                  <span className="bot-strength" aria-hidden="true">
                    {[1, 2, 3, 4].map((bar) => (
                      <i key={bar} className={bar <= option.meter ? "on" : ""} />
                    ))}
                  </span>
                </span>
                <span className="study-level-desc">{option.desc}</span>
              </button>
            ))}
          </div>
          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={() => setStep("review")}>
              <ChevronLeft size={16} aria-hidden /> กลับไปตรวจโจทย์
            </button>
          </div>
        </section>
      )}

      {step === "running" && (
        <section className="study-step study-running" aria-live="polite">
          <Loader2 className="study-spinner" size={28} aria-hidden />
          <h2 className="study-heading">บอทกำลังคิด…</h2>
          {queued ? (
            <p>
              อยู่ในคิว ลำดับที่ {queued.position} (รออีก {queued.ahead} งาน)
            </p>
          ) : progress ? (
            <>
              <div
                className="study-progress"
                role="progressbar"
                aria-valuenow={Math.round(progress.percent)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i style={{ width: `${Math.min(100, Math.max(0, progress.percent))}%` }} />
              </div>
              <p>
                {progress.phase} · {progress.percent.toFixed(1)}% · ผ่านไป{" "}
                {(progress.elapsedMs / 1000).toFixed(0)} วิ
                {progress.etaMs > 0 && ` · เหลือราว ${(progress.etaMs / 1000).toFixed(0)} วิ`}
              </p>
              {progress.detail && <p className="study-hint">{progress.detail}</p>}
            </>
          ) : (
            <p>กำลังเริ่มค้นหา…</p>
          )}
          <p className="study-hint">
            ปิดหน้านี้ได้ — ผลจะถูกบันทึกไว้ในรายการด้านล่างเมื่อคิดเสร็จ
          </p>
        </section>
      )}

      {step === "result" && result && (
        <section className="study-step" aria-label="ผลวิเคราะห์">
          <h2 className="study-heading">
            ผลวิเคราะห์ · ระดับ{" "}
            {LEVELS.find((item) => item.value === result.level)?.label ?? result.level}
          </h2>
          {result.saveError ? (
            <p className="sync-banner">
              วิเคราะห์เสร็จแล้วแต่บันทึกลงฐานข้อมูลไม่สำเร็จ: {result.saveError}
            </p>
          ) : (
            <p className="info-banner">บันทึก 10 อันดับแรกไว้ถาวรแล้ว</p>
          )}
          <PositionSummary
            scoreSelf={result.position.scoreSelf}
            scoreOpponent={result.position.scoreOpponent}
            rack={rack}
            oppRackCount={result.position.oppRackCount}
            bagCount={result.position.bagCount}
          />
          <StudyRanking
            candidates={result.candidates}
            method={result.method}
            summary={result.summary}
          />
          <div className="study-actions">
            <button type="button" className="ghost-button" onClick={() => setStep("level")}>
              ลองระดับอื่นกับโจทย์เดิม
            </button>
            <button type="button" className="primary-button" onClick={startOver}>
              <Plus size={16} aria-hidden /> ตั้งโจทย์ใหม่
            </button>
          </div>
        </section>
      )}

      <section className="study-history" aria-labelledby="study-history-heading">
        <h2 id="study-history-heading">โจทย์ที่วิเคราะห์ไว้</h2>
        {recordsError && <p className="sync-banner">{recordsError}</p>}
        {records.length === 0 && !recordsError && <p className="study-empty">ยังไม่มีรายการ</p>}
        <ul className="study-history-list">
          {records.map((record) => (
            <li key={record.id}>
              <button type="button" onClick={() => setOpenRecord(record)}>
                <strong>
                  {record.rack.join(" ")} · {record.scoreSelf}–{record.scoreOpponent}
                </strong>
                <span>
                  {record.level} · {record.board.length} เบี้ยบนกระดาน · เก็บ{" "}
                  {record.candidates.length} อันดับ
                </span>
                <time dateTime={record.createdAt}>
                  {new Date(record.createdAt).toLocaleString()}
                </time>
              </button>
              <button
                type="button"
                className="study-delete"
                onClick={() => void removeRecord(record.id)}
                aria-label="ลบโจทย์นี้"
              >
                <Trash2 size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </ApplicationShell>
  );
}

/** The face a tile is played as, for the engine's `token` field. */
function displayTokenFor(tile: TileInstance): string {
  return tile.assignedToken ?? tile.token;
}

function StepTrail({ step }: { step: Step }) {
  const order: Step[] = ["board", "rack", "review", "level", "result"];
  const labels: Record<Step, string> = {
    board: "กระดาน",
    rack: "เบี้ยในมือ",
    review: "ตรวจทาน",
    level: "ระดับบอท",
    running: "กำลังคิด",
    result: "ผลลัพธ์",
  };
  const current = step === "running" ? "level" : step;
  const index = order.indexOf(current);
  return (
    <ol className="study-trail">
      {order.map((item, position) => (
        <li
          key={item}
          className={position <= index ? "is-done" : ""}
          aria-current={item === current ? "step" : undefined}
        >
          <span>{position + 1}</span>
          {labels[item]}
        </li>
      ))}
    </ol>
  );
}

function ScoreField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <label className="study-score">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        max={9999}
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onChange(Number.isFinite(parsed) ? Math.max(0, Math.min(9999, Math.trunc(parsed))) : 0);
        }}
      />
    </label>
  );
}

function TilePalette({
  used,
  active,
  onPick,
  onPlaceFace,
}: {
  used: ReturnType<typeof countUsage>;
  active: AmathToken | null;
  onPick: (token: AmathToken) => void;
  onPlaceFace?: (token: AmathToken, face: string) => void;
}) {
  const faces = active && tileNeedsAssignment(active) ? getAssignmentOptions(active) : [];
  return (
    <div className="study-palette">
      <div className="study-palette-grid">
        {TOKEN_LIST.map((token) => {
          const left = remainingOf(used, token);
          return (
            <button
              key={token}
              type="button"
              className={`study-palette-tile${active === token ? " is-active" : ""}`}
              disabled={left <= 0}
              onClick={() => onPick(token)}
              aria-label={`${AMATH_TOKENS[token].token} เหลือ ${left} ตัว`}
            >
              {/* The real tile, not a lookalike: what the palette offers and what
                  lands on the board have to be the same object, or the blank is
                  the one that gives it away. */}
              <Tile tile={{ id: `palette-${token}`, token }} />
              {/* Distinguished from the tile's own point badge by the ×. */}
              <small>×{left}</small>
            </button>
          );
        })}
      </div>
      {faces.length > 0 && onPlaceFace && active && (
        <div className="study-faces">
          <span>วางเป็น:</span>
          {faces.map((face) => (
            <button key={face} type="button" onClick={() => onPlaceFace(active, face)}>
              {face}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyLegend() {
  const groups = [...new Set(KEY_LEGEND.map((entry) => entry.group))];
  return (
    <details className="study-keys">
      <summary>คีย์ลัดสำหรับพิมพ์เบี้ย</summary>
      {groups.map((group) => (
        <section key={group}>
          <h3>{group}</h3>
          <dl>
            {KEY_LEGEND.filter((entry) => entry.group === group).map((entry) => (
              <div key={entry.keys}>
                <dt>
                  <kbd>{entry.keys}</kbd>
                </dt>
                <dd>{entry.means}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <p>
        ใช้แค่ <kbd>⇧</kbd> ตัวเดียวทั้งชุด ไม่มี <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>⌘</kbd> เลย —
        ทั้งสามตัวถูกระบบปฏิบัติการหรือเบราว์เซอร์จองไว้ และจองคนละแบบบน Windows กับ macOS
        ตารางนี้จึง เหมือนกันทั้งสองระบบและไม่ต้องใช้ numpad
      </p>
      <p>
        เลขและตัวอักษรจับที่ <b>ปุ่มจริง</b> ไม่ใช่ตัวอักษรที่พิมพ์ออกมา
        สลับเป็นโหมดพิมพ์ไทยแล้วยังใช้ได้ ทุกปุ่ม (ยกเว้นคีย์บอร์ด AZERTY ที่แถวตัวเลขต้องกด Shift
        อยู่แล้ว)
      </p>
    </details>
  );
}

function BoardIssues({ issues }: { issues: ReturnType<typeof findBoardEquationIssues> }) {
  if (issues.length === 0) return null;
  return (
    <div className="study-issues" role="status">
      <p>
        <TriangleAlert size={16} aria-hidden /> กระดานนี้มีแถวที่ไม่เป็นสมการที่ถูกกฎ{" "}
        {issues.length} แถว — ยืนยันต่อได้ แต่ผลวิเคราะห์จะอ้างอิงกระดานตามที่วางไว้จริง
      </p>
      <ul>
        {issues.slice(0, 5).map((issue) => (
          <li key={`${issue.direction}:${issue.cells[0]?.row}:${issue.cells[0]?.col}`}>
            <code>{issue.expressionText}</code> — {issue.error}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PositionSummary({
  scoreSelf,
  scoreOpponent,
  rack,
  oppRackCount,
  bagCount,
}: {
  scoreSelf: number;
  scoreOpponent: number;
  rack: TileInstance[];
  oppRackCount: number;
  bagCount: number;
}) {
  return (
    <dl className="study-summary-grid">
      <div>
        <dt>แต้ม</dt>
        <dd>
          คุณ {scoreSelf} · คู่แข่ง {scoreOpponent}
        </dd>
      </div>
      <div>
        <dt>เบี้ยในมือ</dt>
        <dd>{rack.map((tile) => displayToken(tile)).join(" ") || "—"}</dd>
      </div>
      <div>
        <dt>คู่แข่งถือ</dt>
        <dd>{oppRackCount} ตัว</dd>
      </div>
      <div>
        <dt>ในถุง</dt>
        <dd>
          {bagCount} ตัว{bagCount === 0 && " · บอทจะรู้มือคู่แข่งทั้งหมดและแก้แบบ exact"}
        </dd>
      </div>
    </dl>
  );
}

function SavedRecordView({ record }: { record: StudyRecord }) {
  const board = useMemo(() => {
    const snapshot = createBoard();
    for (const cell of record.board) {
      const token = cell.kind as AmathToken;
      const row = snapshot[cell.r];
      if (!row) continue;
      row[cell.c] = {
        tile:
          cell.token && cell.token !== cell.kind
            ? { id: `${cell.r}:${cell.c}`, token, assignedToken: cell.token }
            : { id: `${cell.r}:${cell.c}`, token },
        placedTurn: 0,
        side: "A",
      };
    }
    return snapshot;
  }, [record]);

  return (
    <>
      <dl className="study-summary-grid">
        <div>
          <dt>แต้ม</dt>
          <dd>
            คุณ {record.scoreSelf} · คู่แข่ง {record.scoreOpponent}
          </dd>
        </div>
        <div>
          <dt>เบี้ยในมือ</dt>
          <dd>{record.rack.join(" ")}</dd>
        </div>
        <div>
          <dt>คู่แข่งถือ / ในถุง</dt>
          <dd>
            {record.oppRackCount} / {record.bagCount}
          </dd>
        </div>
        <div>
          <dt>ระดับบอท</dt>
          <dd>{record.level}</dd>
        </div>
      </dl>
      <div className="study-board is-readonly">
        <Board
          board={board}
          pendingPlacements={[]}
          selectedRackTileId={null}
          selectedPendingTileId={null}
          onCellClick={NO_CELL_CLICK}
        />
      </div>
      <StudyRanking
        candidates={record.candidates}
        method={record.method}
        summary={record.summary}
      />
    </>
  );
}
