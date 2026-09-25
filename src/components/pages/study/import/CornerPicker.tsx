// ── Placing the four grid corners on a photo ─────────────────────────────────
//
// Measured tolerance (tests/board-vision-geometry.test.ts): corners within
// about a tenth of a square put every crop on its own square; at a third of a
// square, one crop in eight lands on a neighbour. So this is built for
// precision, not speed:
//
//   • the whole 15×15 grid is drawn through the current corners, so a corner
//     that is slightly off shows as grid lines drifting off the board's lines;
//   • a loupe shows the active corner at 2× the photo's own resolution, with
//     the grid drawn in it;
//   • the active corner moves 1 photo pixel per arrow key (10 with Shift).
//
// Corners that would describe a mirrored or crossed board are REFUSED, with the
// reason shown — never re-ordered behind the person's back. Which physical
// corner is row 1 does not matter here: the recogniser works that out.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { pxPerSquare } from "../../../../features/boardVision/crops";
import {
  GeometryError,
  applyHomography,
  boardToImage,
  validateQuad,
  type Point,
  type Quad,
} from "../../../../features/boardVision/geometry";
import type { Photo } from "../../../../features/boardVision/photo";
import { BOARD_SIZE } from "../../../../constants/gameRules";

const LOUPE = 176;
const LOUPE_ZOOM = 2;
const LOW_RESOLUTION = 25; // photo px per square below which reading suffers

export function defaultQuad(width: number, height: number): Quad {
  const side = Math.min(width, height) * 0.7;
  const x = (width - side) / 2;
  const y = (height - side) / 2;
  return [
    [x, y],
    [x + side, y],
    [x + side, y + side],
    [x, y + side],
  ];
}

function quadProblem(quad: Quad): string | null {
  try {
    validateQuad(quad);
    return null;
  } catch (error) {
    if (error instanceof GeometryError) {
      return "มุมไขว้กันหรือเรียงกลับด้าน — จุด 1→2→3→4 ต้องวนตามเข็มนาฬิกาไปรอบตาราง";
    }
    throw error;
  }
}

/** The 16 + 16 grid lines, as segments in photo coordinates. */
function gridSegments(quad: Quad): [Point, Point][] {
  let h;
  try {
    h = boardToImage(quad);
  } catch {
    return [];
  }
  const out: [Point, Point][] = [];
  for (let k = 0; k <= BOARD_SIZE; k += 1) {
    out.push([applyHomography(h, [k, 0]), applyHomography(h, [k, BOARD_SIZE])]);
    out.push([applyHomography(h, [0, k]), applyHomography(h, [BOARD_SIZE, k])]);
  }
  return out;
}

export function CornerPicker({
  photo,
  initial,
  busy,
  onConfirm,
  onBack,
}: {
  photo: Photo;
  initial?: Quad;
  busy: boolean;
  onConfirm: (quad: Quad) => void;
  onBack: () => void;
}) {
  const [quad, setQuad] = useState<Quad>(() => initial ?? defaultQuad(photo.width, photo.height));
  const [active, setActive] = useState<number | null>(null);
  const dragging = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLCanvasElement>(null);

  // The full-resolution photo, drawn once, as the source for view and loupe.
  const source = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = photo.width;
    canvas.height = photo.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null; // no canvas support (tests): the picker still works
    ctx.putImageData(new ImageData(photo.data, photo.width, photo.height), 0, 0);
    return canvas;
  }, [photo]);

  useEffect(() => {
    const view = viewRef.current;
    const ctx = view?.getContext("2d");
    if (!view || !ctx || !source) return;
    view.width = Math.min(photo.width, 1600);
    view.height = Math.round((view.width * photo.height) / photo.width);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, view.width, view.height);
  }, [photo, source]);

  const segments = useMemo(() => gridSegments(quad), [quad]);
  const problem = useMemo(() => quadProblem(quad), [quad]);
  const resolution = problem ? null : pxPerSquare(quad) / photo.scale;

  // The loupe: the active corner at LOUPE_ZOOM× photo resolution.
  useEffect(() => {
    const loupe = loupeRef.current;
    const ctx = loupe?.getContext("2d");
    if (active === null || !loupe || !ctx || !source) return;
    const [cx, cy] = quad[active]!;
    const span = LOUPE / LOUPE_ZOOM;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(source, cx - span / 2, cy - span / 2, span, span, 0, 0, LOUPE, LOUPE);
    const toLoupe = ([x, y]: Point): Point => [
      (x - cx) * LOUPE_ZOOM + LOUPE / 2,
      (y - cy) * LOUPE_ZOOM + LOUPE / 2,
    ];
    ctx.strokeStyle = "rgba(0, 170, 255, 0.9)";
    ctx.lineWidth = 1;
    for (const [a, b] of segments) {
      const [ax, ay] = toLoupe(a);
      const [bx, by] = toLoupe(b);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.strokeStyle = "#ff2d55";
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, 0);
    ctx.lineTo(LOUPE / 2, LOUPE);
    ctx.moveTo(0, LOUPE / 2);
    ctx.lineTo(LOUPE, LOUPE / 2);
    ctx.stroke();
  }, [active, quad, segments, source]);

  const move = useCallback(
    (index: number, point: Point) => {
      // A corner may sit a little outside the photo: a board that is not quite
      // in frame can still be described (its missing squares read as unseen).
      const clamp = (v: number, max: number) => Math.min(max * 1.25, Math.max(-max * 0.25, v));
      setQuad((current) => {
        const next = [...current] as Point[];
        next[index] = [clamp(point[0], photo.width), clamp(point[1], photo.height)];
        return next as unknown as Quad;
      });
    },
    [photo.width, photo.height],
  );

  const toPhoto = (event: PointerEvent): Point | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return [
      ((event.clientX - rect.left) * photo.width) / rect.width,
      ((event.clientY - rect.top) * photo.height) / rect.height,
    ];
  };

  /** Move the active corner one photo pixel (ten with `big`). */
  const nudge = (key: string, big: boolean): boolean => {
    if (active === null) return false;
    const step = big ? 10 : 1;
    const delta: Record<string, Point> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const d = delta[key];
    if (!d) return false;
    const [x, y] = quad[active]!;
    move(active, [x + d[0], y + d[1]]);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (/^[1-4]$/.test(event.key)) {
      setActive(Number(event.key) - 1);
      event.preventDefault();
      return;
    }
    if (nudge(event.key, event.shiftKey)) event.preventDefault();
  };

  // Handles are drawn a constant size on screen whatever the photo's size.
  const rect = svgRef.current?.getBoundingClientRect();
  const unit = rect && rect.width > 0 ? photo.width / rect.width : photo.width / 600;

  return (
    <section className="study-step corner-picker" aria-label="วางมุมของตาราง">
      <h2 className="study-heading">วางมุมทั้งสี่ของตาราง</h2>
      <p className="study-hint">
        ลากจุด <b>1–4</b> ไปที่มุมของ<b>ตาราง 15×15</b> (มุมนอกสุดของเส้นตาราง ไม่ใช่ขอบกระดาน)
        เรียงตามเข็มนาฬิกา · เส้นสีฟ้าต้องทับเส้นบนกระดานพอดีทุกเส้น ·
        เลือกมุมแล้วขยับทีละพิกเซลด้วยปุ่มลูกศรด้านล่างหรือแป้นลูกศร (<kbd>⇧</kbd> ทีละ 10)
      </p>

      <div className="corner-picker-stage">
        <canvas ref={viewRef} className="corner-picker-photo" aria-hidden="true" />
        <svg
          ref={svgRef}
          className="corner-picker-overlay"
          viewBox={`0 0 ${photo.width} ${photo.height}`}
          preserveAspectRatio="none"
          onPointerMove={(event) => {
            if (dragging.current === null) return;
            const p = toPhoto(event);
            if (p) move(dragging.current, p);
          }}
          onPointerUp={() => {
            dragging.current = null;
          }}
        >
          {segments.map(([a, b], i) => (
            <line
              key={i}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              className={i < 2 || i >= segments.length - 2 ? "grid-edge" : "grid-line"}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polygon
            points={quad.map(([x, y]) => `${x},${y}`).join(" ")}
            className={problem ? "quad invalid" : "quad"}
            vectorEffect="non-scaling-stroke"
          />
          {quad.map(([x, y], i) => (
            <g
              key={i}
              role="button"
              tabIndex={-1}
              aria-label={`มุมที่ ${i + 1}`}
              aria-pressed={active === i}
              className={`corner-handle${active === i ? " is-active" : ""}`}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture?.(event.pointerId);
                dragging.current = i;
                setActive(i);
              }}
              onPointerMove={(event) => {
                if (dragging.current !== i) return;
                const p = toPhoto(event);
                if (p) move(i, p);
              }}
              onPointerUp={() => {
                dragging.current = null;
              }}
            >
              <circle cx={x} cy={y} r={16 * unit} className="corner-hit" />
              <circle
                cx={x}
                cy={y}
                r={6 * unit}
                className="corner-dot"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={x + 12 * unit}
                y={y - 12 * unit}
                fontSize={18 * unit}
                className="corner-label"
              >
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
        {active !== null && (
          <canvas
            ref={loupeRef}
            width={LOUPE}
            height={LOUPE}
            className="corner-loupe"
            aria-label={`ขยายมุมที่ ${active + 1}`}
          />
        )}
      </div>

      <div className="corner-picker-controls" role="group" aria-label="ปรับมุมทีละพิกเซล">
        {[0, 1, 2, 3].map((i) => (
          <button
            key={i}
            type="button"
            className="ghost-button"
            aria-pressed={active === i}
            onClick={() => setActive(i)}
            onKeyDown={onKeyDown}
          >
            มุม {i + 1}
          </button>
        ))}
        {(
          [
            ["ArrowLeft", "←"],
            ["ArrowUp", "↑"],
            ["ArrowDown", "↓"],
            ["ArrowRight", "→"],
          ] as const
        ).map(([key, arrow]) => (
          <button
            key={key}
            type="button"
            className="ghost-button"
            disabled={active === null}
            aria-label={`ขยับมุม ${active === null ? "" : active + 1} ${arrow} 1 พิกเซล`}
            onClick={() => nudge(key, false)}
          >
            {arrow}
          </button>
        ))}
      </div>

      {problem && (
        <p className="sync-banner" role="alert">
          {problem}
        </p>
      )}
      {resolution !== null && resolution < LOW_RESOLUTION && (
        <p className="study-hint" role="status">
          กระดานในรูปเล็ก (ราว {resolution.toFixed(0)} พิกเซลต่อช่อง) —
          ถ่ายใกล้ขึ้นหรือใช้รูปความละเอียดสูงจะอ่านได้แม่นกว่า
        </p>
      )}

      <div className="study-actions">
        <button type="button" className="ghost-button" onClick={onBack} disabled={busy}>
          เลือกรูปใหม่
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={busy || problem !== null}
          onClick={() => onConfirm(quad)}
        >
          {busy ? "กำลังอ่านกระดาน…" : "อ่านกระดาน"}
        </button>
      </div>
    </section>
  );
}
