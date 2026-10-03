import type { ReactNode } from "react";
import {
  displayToken,
  getAssignmentOptions,
  getTileType,
  tileNeedsAssignment,
  tilePoint,
  type TileInstance,
} from "../../game";

/**
 * Tile artwork, independent of UI typography.
 *
 * A tile face is ONE SVG on a 24-unit grid that fills its tile, so the tile
 * alone decides the scale: the main face, the point value and the corner
 * marks keep their proportions on a 20 px board cell, a 46 px rack tile and a
 * picker button alike. Nothing on the face has a fixed screen size, and font
 * line boxes never position anything.
 *
 * Operators are drawn, not typed: + − × ÷ = share one stroke weight and one
 * optical centre. Numbers are set on an explicit baseline derived from the
 * tile font's cap height (Arial/Helvetica, ~0.716 em), so 7 and 17 sit on the
 * same visual centre; two-digit faces are fitted to a fixed width
 * (textLength), so 10–20 are as large as the tile allows whatever the font's
 * advance widths.
 *
 * Alternative tiles have their own state language:
 *   +/− or ×/÷ not chosen yet   both options, small and neutral: "can be either"
 *   chosen                       the chosen option large in blue, the other as
 *                                a small neutral mark in the corner
 *   blank, not chosen            a plain blank face (as the physical tile)
 *   blank, chosen                the chosen value in blue, a small blank mark
 * Blue therefore always means "the value this tile is being played as".
 */

const STROKES: Record<string, ReactNode> = {
  "+": <path d="M5 12H19M12 5V19" />,
  "-": <path d="M5 12H19" />,
  "×": <path d="M7 7L17 17M17 7L7 17" />,
  "÷": (
    <>
      <path d="M5 12H19" />
      <circle cx="12" cy="6.2" r="1.9" className="lg-glyph-dot" />
      <circle cx="12" cy="17.8" r="1.9" className="lg-glyph-dot" />
    </>
  ),
  "=": <path d="M5 8.6H19M5 15.4H19" />,
};
const ALIASES: Record<string, string> = { "−": "-", x: "×", "/": "÷" };

export function normalizeFace(face: string) {
  return ALIASES[face] ?? face;
}

/**
 * Face geometry on the 24-unit tile grid. CENTRE is slightly above the middle
 * so the face clears the point value in the bottom-right corner.
 */
const CENTRE = 11.6;
const CAP = 0.716;
const NUMBER = { one: { size: 15.4 }, two: { size: 14.2, width: 15 } } as const;
const OPERATOR = 12;

/** One face drawn into the tile grid: an operator, or a number on its cap-height baseline. */
function FaceMark({
  face,
  cx = 12,
  cy = CENTRE,
  scale = 1,
}: {
  face: string;
  cx?: number;
  cy?: number;
  scale?: number;
}) {
  const key = normalizeFace(face);
  const stroke = STROKES[key];
  if (stroke) {
    const size = OPERATOR * scale;
    return (
      <svg
        className="lg-glyph lg-op"
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        overflow="visible"
      >
        {stroke}
      </svg>
    );
  }
  const wide = key.length > 1;
  const size = (wide ? NUMBER.two.size : NUMBER.one.size) * scale;
  return (
    <text
      className={`lg-glyph lg-num${wide ? " is-wide" : ""}`}
      x={cx}
      y={cy + (size * CAP) / 2}
      fontSize={size}
      textAnchor="middle"
      {...(wide ? { textLength: NUMBER.two.width * scale, lengthAdjust: "spacingAndGlyphs" } : {})}
    >
      {key}
    </text>
  );
}

/** One face set in running text (Last Move, Turn Log, chips): em-sized, follows the line. */
export function Glyph({ face, className = "" }: { face: string; className?: string }) {
  const key = normalizeFace(face);
  const stroke = STROKES[key];
  if (stroke)
    return (
      <svg
        className={`lg-glyph lg-op ${className}`}
        viewBox="0 0 24 24"
        aria-hidden="true"
        focusable="false"
      >
        {stroke}
      </svg>
    );
  return (
    <span className={`lg-glyph lg-num${key.length > 1 ? " is-wide" : ""} ${className}`}>{key}</span>
  );
}

/** A single face filling its box on the tile grid (value picker options). */
export function FaceArt({ face }: { face: string }) {
  return (
    <svg className="lg-tf" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g className="lg-face">
        <FaceMark face={face} cy={12} />
      </g>
    </svg>
  );
}

type FaceTile = Pick<TileInstance, "token" | "assignedToken">;

export function tileState(tile: FaceTile) {
  const options = getAssignmentOptions(tile.token);
  const alternative = tileNeedsAssignment(tile.token);
  const chosen = alternative && tile.assignedToken ? normalizeFace(tile.assignedToken) : null;
  return { options, alternative, blank: tile.token === "?", chosen };
}

/**
 * The inside of a tile: main face, corner mark and point value, all on the
 * tile's own grid. `ask`: an unchosen blank placed on the board shows "?".
 */
export function TileFace({ tile, ask = false }: { tile: FaceTile; ask?: boolean }) {
  const { options, alternative, blank, chosen } = tileState(tile);
  const point = tilePoint(tile as TileInstance);
  let body: ReactNode = null;
  let corner: ReactNode = null;
  if (!alternative) body = <FaceMark face={displayToken(tile as TileInstance)} />;
  else if (chosen) {
    body = <FaceMark face={chosen} />;
    corner = blank ? (
      <rect className="lg-blank-mark" x="2.7" y="2.7" width="3.8" height="3.8" rx="0.7" />
    ) : (
      <g className="lg-alt-mark">
        <FaceMark
          face={options.map(normalizeFace).find((face) => face !== chosen) ?? ""}
          cx={4.8}
          cy={4.8}
          scale={0.42}
        />
      </g>
    );
  } else if (blank) {
    if (ask)
      body = (
        <text
          className="lg-ask"
          x="12"
          y={CENTRE + (12 * CAP) / 2}
          fontSize="12"
          textAnchor="middle"
        >
          ?
        </text>
      );
  } else
    body = (
      <g className="lg-pair">
        <FaceMark face={options[0]} cx={7.6} scale={0.66} />
        <FaceMark face={options[1]} cx={16.4} scale={0.66} />
      </g>
    );
  return (
    <svg className="lg-tf" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {corner}
      <g className="lg-face">{body}</g>
      <text className="lg-point" x="21.5" y="21.7" fontSize="5.2" textAnchor="end">
        {point}
      </text>
    </svg>
  );
}

export function tileClass(tile: FaceTile) {
  const { alternative, chosen, blank } = tileState(tile);
  return `lg-type-${getTileType(tile as TileInstance)}${alternative ? " is-alternative" : ""}${
    chosen ? " is-chosen" : alternative && !blank ? " is-open" : ""
  }${blank ? " is-blank" : ""}`;
}

/** An equation drawn with tile glyphs (Last Move, Turn Log). Text twin for assistive tech. */
export function Expression({ faces }: { faces: string[] }) {
  return (
    <span className="lg-expr">
      <span className="lg-visually-hidden">{faces.join("")}</span>
      <span className="lg-expr-glyphs" aria-hidden="true">
        {faces.map((face, index) => (
          <Glyph key={index} face={face} />
        ))}
      </span>
    </span>
  );
}
