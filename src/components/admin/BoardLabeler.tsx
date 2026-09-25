// ── Admin → Vision dataset → Board Labeler ───────────────────────────────────
//
// Trusted OCCUPANCY ground truth for real board photos: per square TILE,
// EMPTY or UNSURE, painted by a person. Admin-only, lazy-loaded, and entirely
// local — photos and labels stay in this browser (IndexedDB) until exported.
// No model is loaded or consulted here, for any role; for SEALED_TEST that is
// also enforced by `suggestionsAllowed`.
//
// Per board: 1 Corners (drag the grid's four corners, loupe, arrow nudge)
// → 2 Paint (all squares start EMPTY; paint the tiles) → 3 Review (counts,
// every UNSURE listed, complete).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import "./board-labeler.css";
import { CROP_CONTRACT, rectifyBoard } from "../../features/boardVision/crops";
import {
  applyHomography,
  boardToImage,
  type Point,
  type Quad,
} from "../../features/boardVision/geometry";
import { decodePhoto, type Photo } from "../../features/boardVision/photo";
import {
  EMPTY_HISTORY,
  ROLES,
  batchOrder,
  complete,
  completionProblem,
  cornersProblem,
  counts,
  createBoard,
  defaultCorners,
  exportAll,
  exportTraining,
  neighbour,
  readDataset,
  redo,
  resetCorners,
  roleChangeNeedsConfirmation,
  setCorners,
  setRole,
  setSession,
  squareAtCanonical,
  squareBoxCanonical,
  squareName,
  squaresBetween,
  stroke as applyStroke,
  undo,
  paint as paintSquares,
  boardIdFor,
  type BoardLabels,
  type DatasetRole,
  type History,
  type Occupancy,
} from "../../features/boardVision/labeling/boardLabels";
import { indexedDbStore, type LabelStore } from "../../features/boardVision/labeling/labelStore";

type Step = "corners" | "paint" | "review";
const STATUS_LABEL = {
  NOT_STARTED: "Not started",
  DRAFT: "Draft",
  COMPLETED: "Completed",
} as const;
const BRUSHES: { brush: Occupancy; label: string; keys: string }[] = [
  { brush: "TILE", label: "Tile", keys: "T / 1" },
  { brush: "EMPTY", label: "Empty / eraser", keys: "E / 2" },
  { brush: "UNSURE", label: "Unsure", keys: "U / 3" },
];
const N = CROP_CONTRACT.canonicalSize;
const nowIso = () => new Date().toISOString();

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Corners in the decoded photo's pixels (photo.ts may have scaled it down). */
const toDecoded = (q: Quad, scale: number) =>
  q.map(([x, y]) => [x * scale, y * scale] as const) as unknown as Quad;
const toOriginal = (q: Quad, scale: number) =>
  q.map(([x, y]) => [x / scale, y / scale] as const) as unknown as Quad;

export function BoardLabeler({ store: given }: { store?: LabelStore }) {
  const store = useMemo(() => given ?? indexedDbStore(), [given]);
  const [boards, setBoards] = useState<BoardLabels[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Photo | null>(null);
  const [photoMissing, setPhotoMissing] = useState(false);
  const [step, setStep] = useState<Step>("corners");
  const [history, setHistory] = useState<History>(EMPTY_HISTORY);
  const [notice, setNotice] = useState<string | null>(null);
  const [newSession, setNewSession] = useState(
    () => `session-${new Date().toISOString().slice(0, 10)}`,
  );
  const [saved, setSaved] = useState(true);

  const order = useMemo(() => batchOrder(boards), [boards]);
  const board = boards.find((b) => b.boardId === currentId) ?? null;
  const position = board ? order.findIndex((b) => b.boardId === board.boardId) + 1 : 0;

  // ── load the batch ─────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    void store.listBoards().then((list) => {
      if (!alive) return;
      setBoards(list);
      setCurrentId((id) => id ?? batchOrder(list)[0]?.boardId ?? null);
    });
    return () => {
      alive = false;
    };
  }, [store]);

  // ── open the current board's photo ─────────────────────────────────────
  useEffect(() => {
    setPhoto(null);
    setPhotoMissing(false);
    setHistory(EMPTY_HISTORY);
    if (!currentId) return;
    let alive = true;
    void (async () => {
      const b = await store.getBoard(currentId);
      const blob = await store.getImage(currentId);
      if (!alive || !b) return;
      if (!blob) return setPhotoMissing(true);
      const decoded = await decodePhoto(new File([blob], b.image.name, { type: b.image.type }));
      if (!alive) return;
      setPhoto(decoded);
      setStep(b.corners ? (b.status === "COMPLETED" ? "review" : "paint") : "corners");
    })().catch((e: unknown) => setNotice(`Could not open the photo: ${String(e)}`));
    return () => {
      alive = false;
    };
  }, [currentId, store]);

  // ── autosave (debounced) ───────────────────────────────────────────────
  const pending = useRef<BoardLabels | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const b = pending.current;
    pending.current = null;
    if (b) {
      await store.putBoard(b);
      setSaved(true);
    }
  }, [store]);
  useEffect(() => () => void flush(), [flush]);
  const update = useCallback(
    (next: BoardLabels, now = false) => {
      setBoards((list) => list.map((b) => (b.boardId === next.boardId ? next : b)));
      pending.current = next;
      setSaved(false);
      if (timer.current) clearTimeout(timer.current);
      if (now) void flush();
      else timer.current = setTimeout(() => void flush(), 250);
    },
    [flush],
  );

  // ── batch actions ──────────────────────────────────────────────────────
  async function addPhotos(files: FileList | null) {
    if (!files?.length) return;
    const added: string[] = [];
    const notes: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const buf = await file.arrayBuffer();
        const sha = await sha256Hex(buf);
        const id = boardIdFor(sha);
        const existing = await store.getBoard(id);
        if (existing) {
          if (!(await store.getImage(id))) {
            await store.putImage(id, new Blob([buf], { type: file.type }));
            notes.push(`${file.name}: photo re-attached to its labels`);
          } else notes.push(`${file.name}: already in the batch`);
          continue;
        }
        const p = await decodePhoto(file);
        const b = createBoard(
          {
            name: file.name,
            sha256: sha,
            bytes: file.size,
            type: file.type || "image/jpeg",
            lastModified: file.lastModified,
            width: Math.round(p.width / p.scale),
            height: Math.round(p.height / p.scale),
            exifOrientation: p.orientation,
            orientedBy: p.orientedBy,
          },
          newSession.trim() || "session",
          nowIso(),
        );
        await store.putImage(id, new Blob([buf], { type: file.type }));
        await store.putBoard(b);
        added.push(id);
      } catch (e) {
        notes.push(`${file.name}: could not be read (${String(e)})`);
      }
    }
    const list = await store.listBoards();
    setBoards(list);
    if (added[0]) setCurrentId(added[0]);
    setNotice(
      [added.length ? `${added.length} photo(s) added as SEALED_TEST` : "", ...notes]
        .filter(Boolean)
        .join(" · ") || null,
    );
  }

  async function importJson(file: File | undefined) {
    if (!file) return;
    try {
      const incoming = readDataset(JSON.parse(await file.text()));
      let replaced = 0;
      for (const b of incoming) {
        const existing = await store.getBoard(b.boardId);
        if (existing && JSON.stringify(existing) !== JSON.stringify(b)) {
          if (
            !window.confirm(
              `${b.image.name} (${b.boardId}) is already here with different labels. Replace it with the imported version?`,
            )
          )
            continue;
          replaced += 1;
        }
        await store.putBoard(b);
      }
      setBoards(await store.listBoards());
      setNotice(
        `Imported ${incoming.length} board(s)${replaced ? `, ${replaced} replaced` : ""}. Boards without their photo: add the photo again to attach it.`,
      );
    } catch (e) {
      setNotice(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function go(step_: -1 | 1) {
    await flush();
    setCurrentId(neighbour(boards, currentId, step_));
  }

  function changeRole(to: DatasetRole) {
    if (!board) return;
    let confirmed = false;
    if (roleChangeNeedsConfirmation(board, to)) {
      confirmed = window.confirm(
        `${board.image.name} is SEALED_TEST${board.status === "COMPLETED" ? " and COMPLETED" : ""}.\n\n` +
          "Moving it out of the sealed test set means it may be used for development or training, and it can no longer " +
          "serve as an unseen test. The change is recorded in the board's history.\n\nMove it to " +
          to +
          "?",
      );
      if (!confirmed) return;
    }
    update(setRole(board, to, nowIso(), confirmed), true);
  }

  const c = board ? counts(board) : null;
  return (
    <section className="labeler" aria-label="Board labeler">
      <div className="labeler-toolbar">
        <label className="eq-button eq-button-primary labeler-file">
          Add board photos
          <input
            type="file"
            accept="image/*"
            multiple
            aria-label="Add board photos"
            onChange={(e) => void addPhotos(e.target.files).then(() => (e.target.value = ""))}
          />
        </label>
        <label className="labeler-field">
          Session for new photos
          <input
            value={newSession}
            onChange={(e) => setNewSession(e.target.value)}
            aria-label="Session for new photos"
          />
        </label>
        <span className="labeler-spacer" />
        <label className="eq-button eq-button-secondary labeler-file">
          Import JSON
          <input
            type="file"
            accept=".json,application/json"
            aria-label="Import labels JSON"
            onChange={(e) => void importJson(e.target.files?.[0]).then(() => (e.target.value = ""))}
          />
        </label>
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={!boards.length}
          onClick={() =>
            void flush().then(() =>
              download(
                `board-occupancy-all-${nowIso().slice(0, 10)}.json`,
                exportAll(boards, nowIso()),
              ),
            )
          }
        >
          Export all (JSON)
        </button>
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={!boards.length}
          onClick={() => {
            void flush().then(() => {
              const d = exportTraining(boards, nowIso());
              download(`board-occupancy-training-${nowIso().slice(0, 10)}.json`, d);
              setNotice(
                `Training export: ${d.boards.length} board(s) included; ${d.excluded?.length ?? 0} excluded (SEALED_TEST, DEV and unfinished boards are never included).`,
              );
            });
          }}
        >
          Export training set
        </button>
      </div>

      {notice && (
        <div className="eq-alert labeler-notice" role="status">
          <span>{notice}</span>
          <button
            type="button"
            className="eq-button eq-button-secondary"
            onClick={() => setNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {order.length === 0 ? (
        <div className="eq-state">
          <h3>No boards yet</h3>
          <p>
            Add one or more board photos. They stay in this browser; new boards default to
            SEALED_TEST.
          </p>
        </div>
      ) : (
        <>
          <nav className="labeler-batch" aria-label="Boards">
            <button
              type="button"
              className="eq-button eq-button-secondary"
              onClick={() => void go(-1)}
              disabled={position <= 1}
            >
              ← Previous
            </button>
            <strong aria-live="polite">
              {position} / {order.length} boards
            </strong>
            <button
              type="button"
              className="eq-button eq-button-secondary"
              onClick={() => void go(1)}
              disabled={position >= order.length}
            >
              Next →
            </button>
            <ol className="labeler-list">
              {order.map((b, i) => (
                <li key={b.boardId}>
                  <button
                    type="button"
                    aria-current={b.boardId === currentId ? "true" : undefined}
                    onClick={() => void flush().then(() => setCurrentId(b.boardId))}
                  >
                    <span>
                      {i + 1}. {b.image.name}
                    </span>
                    <span className={`labeler-status is-${b.status.toLowerCase()}`}>
                      {STATUS_LABEL[b.status]}
                    </span>
                    {b.role === "SEALED_TEST" && (
                      <span className="labeler-sealed-chip">SEALED</span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </nav>

          {board && (
            <div className="labeler-board">
              <header className="labeler-board-head">
                <div>
                  <h2>{board.image.name}</h2>
                  <p className="labeler-meta">
                    {board.image.width}×{board.image.height} px · EXIF {board.image.exifOrientation}{" "}
                    · id {board.boardId} ·{" "}
                    <span className={`labeler-status is-${board.status.toLowerCase()}`}>
                      {STATUS_LABEL[board.status]}
                    </span>{" "}
                    · {saved ? "saved" : "saving…"}
                  </p>
                </div>
                <label className="labeler-field">
                  Role
                  <select
                    value={board.role}
                    aria-label="Dataset role"
                    onChange={(e) => changeRole(e.target.value as DatasetRole)}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="labeler-field">
                  Session
                  <input
                    value={board.sessionId}
                    aria-label="Board session"
                    onChange={(e) => update(setSession(board, e.target.value, nowIso()))}
                  />
                </label>
              </header>
              {board.role === "SEALED_TEST" && (
                <div className="labeler-sealed" role="note">
                  SEALED TEST — labels come only from your painting. No model output is shown or
                  used, and this board is never included in a training export.
                </div>
              )}

              <nav className="labeler-steps" aria-label="Step">
                {(["corners", "paint", "review"] as Step[]).map((s, i) => (
                  <button
                    key={s}
                    type="button"
                    aria-current={step === s ? "step" : undefined}
                    disabled={s !== "corners" && Boolean(cornersProblem(board.corners))}
                    onClick={() => setStep(s)}
                  >
                    {i + 1} {s === "corners" ? "Corners" : s === "paint" ? "Paint" : "Review"}
                  </button>
                ))}
              </nav>

              {photoMissing ? (
                <div className="eq-state">
                  <h3>Photo not in this browser</h3>
                  <p>
                    These labels were imported. Add the same photo file again ({board.image.name})
                    to attach it.
                  </p>
                </div>
              ) : !photo ? (
                <div className="eq-state">
                  <p>Opening photo…</p>
                </div>
              ) : step === "corners" ? (
                <CornerStep
                  key={board.boardId}
                  photo={photo}
                  initial={board.corners ? toDecoded(board.corners, photo.scale) : null}
                  onChange={(q) => update(setCorners(board, toOriginal(q, photo.scale), nowIso()))}
                  onReset={() => update(resetCorners(board, nowIso()), true)}
                  onDone={() => setStep("paint")}
                  hasCorners={Boolean(board.corners)}
                />
              ) : (
                <PaintAndReview
                  key={board.boardId}
                  step={step}
                  photo={photo}
                  board={board}
                  history={history}
                  onBoard={(b, h) => {
                    update(b);
                    if (h) setHistory(h);
                  }}
                  onComplete={(b) => {
                    update(b, true);
                    setNotice(`${b.image.name} completed and saved.`);
                  }}
                  onStep={setStep}
                />
              )}

              {c && (
                <p className="labeler-counts" aria-label="Counts">
                  <span className="is-tile">TILE: {c.TILE}</span>
                  <span>EMPTY: {c.EMPTY}</span>
                  <span className="is-unsure">UNSURE: {c.UNSURE}</span>
                  <span>TOTAL: {c.TOTAL}</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── step 1: corners ──────────────────────────────────────────────────────
function CornerStep({
  photo,
  initial,
  onChange,
  onReset,
  onDone,
  hasCorners,
}: {
  photo: Photo;
  initial: Quad | null;
  onChange: (q: Quad) => void;
  onReset: () => void;
  onDone: () => void;
  hasCorners: boolean;
}) {
  const [quad, setQuad] = useState<Quad>(
    () => initial ?? defaultCorners(photo.width, photo.height),
  );
  const moved = useRef(false);
  const [active, setActiveState] = useState(0);
  // the latest corners and active corner, for key repeats faster than renders
  const quadRef = useRef(quad);
  const activeRef = useRef(active);
  const setActive = (i: number) => {
    activeRef.current = i;
    setActiveState(i);
  };
  const show = (q: Quad) => {
    quadRef.current = q;
    setQuad(q);
  };
  const [drag, setDrag] = useState<number | null>(null);
  const photoRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const problem = cornersProblem(quad);

  useEffect(() => {
    const ctx = photoRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0);
  }, [photo]);

  // the loupe: the active corner at 3×, with the grid lines through it
  useEffect(() => {
    const L = loupeRef.current?.getContext("2d");
    const src = photoRef.current;
    if (!L || !src) return;
    const size = 180,
      zoom = 3,
      half = size / zoom / 2;
    const [cx, cy] = quad[active]!;
    L.imageSmoothingEnabled = false;
    L.fillStyle = "#000";
    L.fillRect(0, 0, size, size);
    L.drawImage(src, cx - half, cy - half, half * 2, half * 2, 0, 0, size, size);
    L.strokeStyle = "rgba(255,40,40,.9)";
    L.beginPath();
    L.moveTo(size / 2, 0);
    L.lineTo(size / 2, size);
    L.moveTo(0, size / 2);
    L.lineTo(size, size / 2);
    L.stroke();
  }, [quad, active, photo]);

  const commit = (q: Quad) => {
    moved.current = true;
    show(q);
    if (!cornersProblem(q)) onChange(q);
  };
  const toPhoto = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return [
      ((e.clientX - r.left) / Math.max(r.width, 1)) * photo.width,
      ((e.clientY - r.top) / Math.max(r.height, 1)) * photo.height,
    ];
  };
  const clamp = ([x, y]: Point): Point => [
    Math.min(Math.max(x, -0.25 * photo.width), 1.25 * photo.width),
    Math.min(Math.max(y, -0.25 * photo.height), 1.25 * photo.height),
  ];
  // one step = one pixel of the ORIGINAL photo (= `scale` decoded pixels)
  const nudge = (dx: number, dy: number) =>
    commit(
      quadRef.current.map((p, i) =>
        i === activeRef.current ? clamp([p[0] + dx * photo.scale, p[1] + dy * photo.scale]) : p,
      ) as unknown as Quad,
    );
  // keyboard: 1–4 pick a corner, arrows nudge it (Shift: 10 px)
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      )
        return;
      if (/^[1-4]$/.test(e.key)) return setActive(Number(e.key) - 1);
      const d = e.shiftKey ? 10 : 1;
      const mv = (
        { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<
          string,
          [number, number]
        >
      )[e.key];
      if (mv) {
        e.preventDefault();
        nudgeRef.current(mv[0], mv[1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const grid = useMemo(() => {
    if (cornersProblem(quad)) return [];
    const h = boardToImage(quad);
    const segs: [Point, Point][] = [];
    for (let k = 0; k <= 15; k += 1) {
      segs.push([applyHomography(h, [k, 0]), applyHomography(h, [k, 15])]);
      segs.push([applyHomography(h, [0, k]), applyHomography(h, [15, k])]);
    }
    return segs;
  }, [quad]);
  const lw = Math.max(1, photo.width / 900);

  return (
    <div className="labeler-corners">
      <div
        className="labeler-stage"
        aria-label="Photo with grid corners; 1–4 selects a corner, arrows nudge 1 px (Shift: 10 px)"
      >
        <canvas
          ref={photoRef}
          className="labeler-photo"
          width={photo.width}
          height={photo.height}
        />
        <svg
          ref={svgRef}
          className="labeler-overlay"
          viewBox={`0 0 ${photo.width} ${photo.height}`}
          onPointerMove={(e) => {
            if (drag === null) return;
            e.preventDefault();
            const q = quadRef.current.map((p, i) =>
              i === drag ? clamp(toPhoto(e)) : p,
            ) as unknown as Quad;
            show(q);
          }}
          onPointerUp={() => {
            if (drag !== null) commit(quadRef.current);
            setDrag(null);
          }}
        >
          {grid.map(([a, b], i) => (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="rgba(0,220,255,.85)"
              strokeWidth={lw}
            />
          ))}
          <polygon
            points={quad.map((p) => p.join(",")).join(" ")}
            fill="none"
            stroke={problem ? "#ff3b30" : "#00dcff"}
            strokeWidth={lw * 2}
          />
          {quad.map(([x, y], i) => (
            <g
              key={i}
              className={`labeler-handle${i === active ? " is-active" : ""}`}
              role="button"
              aria-label={`Corner ${i + 1}`}
              onPointerDown={(e) => {
                e.preventDefault();
                (e.target as Element).setPointerCapture?.(e.pointerId);
                setActive(i);
                setDrag(i);
              }}
            >
              <circle cx={x} cy={y} r={lw * 14} />
              <text x={x} y={y} fontSize={lw * 14}>
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <aside className="labeler-side">
        <p>
          Drag the four corners of the <b>15×15 grid</b> (not the frame): 1 top-left, 2 top-right, 3
          bottom-right, 4 bottom-left, as you read the board. Check the cyan grid sits on the
          board's lines everywhere.
        </p>
        <canvas
          ref={loupeRef}
          className="labeler-loupe"
          width={180}
          height={180}
          aria-label={`Loupe, corner ${active + 1}`}
        />
        <div className="labeler-nudge" role="group" aria-label={`Nudge corner ${active + 1}`}>
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={active === n - 1}
              onClick={() => setActive(n - 1)}
            >
              {n}
            </button>
          ))}
          <button type="button" aria-label="Nudge left" onClick={() => nudge(-1, 0)}>
            ←
          </button>
          <button type="button" aria-label="Nudge up" onClick={() => nudge(0, -1)}>
            ↑
          </button>
          <button type="button" aria-label="Nudge down" onClick={() => nudge(0, 1)}>
            ↓
          </button>
          <button type="button" aria-label="Nudge right" onClick={() => nudge(1, 0)}>
            →
          </button>
        </div>
        {problem && (
          <p className="labeler-problem" role="alert">
            {problem}
          </p>
        )}
        <div className="labeler-actions">
          <button
            type="button"
            className="eq-button eq-button-secondary"
            onClick={() => {
              moved.current = true;
              show(defaultCorners(photo.width, photo.height));
              onReset();
            }}
          >
            Reset corners
          </button>
          <button
            type="button"
            className="eq-button eq-button-primary"
            disabled={Boolean(problem)}
            onClick={() => {
              if (moved.current || !initial) onChange(quad);
              onDone();
            }}
          >
            {hasCorners ? "Use corners" : "Use corners → paint"}
          </button>
        </div>
      </aside>
    </div>
  );
}

// ── steps 2 and 3: paint, review ─────────────────────────────────────────
function PaintAndReview({
  step,
  photo,
  board,
  history,
  onBoard,
  onComplete,
  onStep,
}: {
  step: "paint" | "review";
  photo: Photo;
  board: BoardLabels;
  history: History;
  onBoard: (b: BoardLabels, h?: History) => void;
  onComplete: (b: BoardLabels) => void;
  onStep: (s: Step) => void;
}) {
  const [brush, setBrush] = useState<Occupancy>("TILE");
  const [hover, setHover] = useState<number | null>(null);
  const [flash, setFlash] = useState<number | null>(null);
  const [opacity, setOpacity] = useState(0.45);
  const [reviewed, setReviewed] = useState(false);
  const boardRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<{ base: BoardLabels; cells: Set<number>; last: number } | null>(null);

  const rectified = useMemo(() => {
    if (!board.corners) return null;
    const b = rectifyBoard(photo, toDecoded(board.corners, photo.scale));
    const px = new Uint8ClampedArray(N * N * 4);
    for (let i = 0; i < N * N; i += 1) {
      px[i * 4] = b.data[i * 3]!;
      px[i * 4 + 1] = b.data[i * 3 + 1]!;
      px[i * 4 + 2] = b.data[i * 3 + 2]!;
      px[i * 4 + 3] = 255;
    }
    return px;
  }, [photo, board.corners]);

  useEffect(() => {
    const ctx = boardRef.current?.getContext("2d");
    if (ctx && rectified) ctx.putImageData(new ImageData(rectified, N, N), 0, 0);
  }, [rectified]);

  // labels, drawn over the board: TILE translucent green, UNSURE amber hatch, EMPTY nothing
  useEffect(() => {
    const ctx = overlayRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, N, N);
    const { pxPerSquare: C, marginSquares: M } = CROP_CONTRACT;
    ctx.strokeStyle = "rgba(255,255,255,.55)";
    ctx.lineWidth = 1;
    for (let k = 0; k <= 15; k += 1) {
      const o = (k + M) * C;
      ctx.beginPath();
      ctx.moveTo(o, M * C);
      ctx.lineTo(o, (15 + M) * C);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(M * C, o);
      ctx.lineTo((15 + M) * C, o);
      ctx.stroke();
    }
    for (const cell of board.cells) {
      const { x, y, size } = squareBoxCanonical(cell.index);
      if (cell.occupancy === "TILE") {
        ctx.fillStyle = `rgba(22,163,74,${opacity})`;
        ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
        ctx.strokeStyle = "rgba(22,163,74,.95)";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2.5, y + 2.5, size - 5, size - 5);
      } else if (cell.occupancy === "UNSURE") {
        ctx.save();
        ctx.beginPath();
        ctx.rect(x + 2, y + 2, size - 4, size - 4);
        ctx.clip();
        ctx.strokeStyle = `rgba(245,158,11,${Math.min(1, opacity + 0.35)})`;
        ctx.lineWidth = 4;
        for (let d = -size; d < size; d += 10) {
          ctx.beginPath();
          ctx.moveTo(x + d, y + size);
          ctx.lineTo(x + d + size, y);
          ctx.stroke();
        }
        ctx.restore();
        ctx.strokeStyle = "rgba(245,158,11,1)";
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 2.5, y + 2.5, size - 5, size - 5);
      }
    }
    for (const [i, colour] of [
      [hover, "rgba(37,99,235,1)"],
      [flash, "rgba(236,72,153,1)"],
    ] as const) {
      if (i === null) continue;
      const { x, y, size } = squareBoxCanonical(i);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 4;
      ctx.strokeRect(x, y, size, size);
    }
  }, [board.cells, hover, flash, opacity]);

  const squareAt = (e: { clientX: number; clientY: number }) => {
    const r = overlayRef.current!.getBoundingClientRect();
    return squareAtCanonical(
      ((e.clientX - r.left) / Math.max(r.width, 1)) * N,
      ((e.clientY - r.top) / Math.max(r.height, 1)) * N,
    );
  };

  const now = nowIso;
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (step !== "paint" || e.button !== 0) return;
    e.preventDefault();
    const i = squareAt(e);
    if (i < 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    strokeRef.current = { base: board, cells: new Set([i]), last: i };
    const next = paintSquares(board, [i], brush, now());
    if (next !== board) onBoard(next);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const i = squareAt(e);
    setHover(i >= 0 ? i : null);
    const s = strokeRef.current;
    if (!s || i < 0 || i === s.last) return;
    e.preventDefault();
    for (const j of squaresBetween(s.last, i)) s.cells.add(j);
    s.last = i;
    const next = paintSquares(s.base, s.cells, brush, now());
    if (next !== s.base) onBoard(next);
  };
  const onUp = () => {
    const s = strokeRef.current;
    strokeRef.current = null;
    if (!s) return;
    const r = applyStroke(s.base, history, s.cells, brush, now());
    if (r.board !== s.base) onBoard(r.board, r.history);
  };

  const doUndo = useCallback(() => {
    const r = undo(board, history, nowIso());
    if (r.board !== board) onBoard(r.board, r.history);
  }, [board, history, onBoard]);
  const doRedo = useCallback(() => {
    const r = redo(board, history, nowIso());
    if (r.board !== board) onBoard(r.board, r.history);
  }, [board, history, onBoard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        return e.shiftKey ? doRedo() : doUndo();
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        return doRedo();
      }
      if (mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t" || k === "1") setBrush("TILE");
      else if (k === "e" || k === "2") setBrush("EMPTY");
      else if (k === "u" || k === "3") setBrush("UNSURE");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doUndo, doRedo]);

  const unsure = board.cells.filter((c) => c.occupancy === "UNSURE");
  const c = counts(board);
  const problem = completionProblem(board, reviewed);

  return (
    <div className={`labeler-paint is-${step}`}>
      <div className="labeler-stage labeler-board-stage">
        <canvas ref={boardRef} className="labeler-rectified" width={N} height={N} />
        <canvas
          ref={overlayRef}
          className="labeler-labels"
          width={N}
          height={N}
          aria-label={`Rectified board. Brush ${brush}. Click or drag to paint.`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onDragStart={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
      <aside className="labeler-side">
        <p className="labeler-hover" aria-live="polite">
          {hover !== null ? squareName(hover) : "—"}
        </p>
        {step === "paint" ? (
          <>
            <div className="labeler-brushes" role="radiogroup" aria-label="Brush">
              {BRUSHES.map((b) => (
                <button
                  key={b.brush}
                  type="button"
                  role="radio"
                  aria-checked={brush === b.brush}
                  className={`labeler-brush is-${b.brush.toLowerCase()}`}
                  onClick={() => setBrush(b.brush)}
                >
                  {b.label} <kbd>{b.keys}</kbd>
                </button>
              ))}
            </div>
            <div className="labeler-actions">
              <button
                type="button"
                className="eq-button eq-button-secondary"
                onClick={doUndo}
                disabled={!history.past.length}
              >
                Undo
              </button>
              <button
                type="button"
                className="eq-button eq-button-secondary"
                onClick={doRedo}
                disabled={!history.future.length}
              >
                Redo
              </button>
            </div>
            <label className="labeler-field">
              Label opacity
              <input
                type="range"
                min={0.1}
                max={0.8}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </label>
            <p className="labeler-hint">
              Every square starts EMPTY: paint only the tiles. Drag to paint many; Empty is the
              eraser. ⌘/Ctrl-Z undo, ⇧⌘Z / Ctrl-Y redo.
            </p>
            <button
              type="button"
              className="eq-button eq-button-primary"
              onClick={() => onStep("review")}
            >
              Review →
            </button>
          </>
        ) : (
          <>
            <h3>Review</h3>
            <p>
              TILE {c.TILE} · EMPTY {c.EMPTY} · UNSURE {c.UNSURE} · TOTAL {c.TOTAL}
            </p>
            <div className="labeler-mini" role="list" aria-label="Labelled 15×15 board">
              {board.cells.map((cell) => (
                <span
                  key={cell.index}
                  role="listitem"
                  aria-label={`${squareName(cell.index)} ${cell.occupancy}`}
                  className={`labeler-mini-cell is-${cell.occupancy.toLowerCase()}`}
                  onMouseEnter={() => setFlash(cell.index)}
                  onMouseLeave={() => setFlash(null)}
                />
              ))}
            </div>
            <div className="labeler-unsure">
              <strong>UNSURE squares ({unsure.length})</strong>
              {unsure.length === 0 ? (
                <p>None.</p>
              ) : (
                <ul>
                  {unsure.map((u) => (
                    <li key={u.index}>
                      <button type="button" onClick={() => setFlash(u.index)}>
                        {squareName(u.index)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <label className="labeler-check">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              I reviewed all 225 squares against the photo.
            </label>
            {problem && reviewed && (
              <p className="labeler-problem" role="alert">
                {problem}
              </p>
            )}
            <div className="labeler-actions">
              <button
                type="button"
                className="eq-button eq-button-secondary"
                onClick={() => onStep("paint")}
              >
                ← Back to painting
              </button>
              <button
                type="button"
                className="eq-button eq-button-primary"
                disabled={Boolean(problem)}
                onClick={() => onComplete(complete(board, reviewed, nowIso()))}
              >
                {board.status === "COMPLETED" ? "Completed ✓ (save again)" : "Mark completed"}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

export default BoardLabeler;
