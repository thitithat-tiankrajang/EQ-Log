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
 * Operators are drawn, not typed: every operator shares one 24-unit grid, one
 * stroke weight and one optical centre, so + − × ÷ = read as a set at phone
 * size (a font's hyphen is short and thin, its slash leans and sits low, and
 * its × and ÷ rarely share a height). Numbers stay text — digits are what
 * fonts are good at — set heavy with tabular figures.
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

/** One face: a drawn operator or a set number. */
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

type FaceTile = Pick<TileInstance, "token" | "assignedToken">;

export function tileState(tile: FaceTile) {
  const options = getAssignmentOptions(tile.token);
  const alternative = tileNeedsAssignment(tile.token);
  const chosen = alternative && tile.assignedToken ? normalizeFace(tile.assignedToken) : null;
  return { options, alternative, blank: tile.token === "?", chosen };
}

/** The inside of a tile: glyph(s) and point value. */
export function TileFace({ tile }: { tile: FaceTile }) {
  const { options, alternative, blank, chosen } = tileState(tile);
  const point = tilePoint(tile as TileInstance);
  let body: ReactNode;
  let corner: ReactNode = null;
  if (!alternative) body = <Glyph face={displayToken(tile as TileInstance)} />;
  else if (chosen) {
    body = <Glyph face={chosen} className="is-chosen" />;
    corner = blank ? (
      <span className="lg-blank-mark" />
    ) : (
      <span className="lg-alt-mark">
        <Glyph face={options.map(normalizeFace).find((face) => face !== chosen) ?? ""} />
      </span>
    );
  } else if (blank) body = null;
  else
    body = (
      <span className="lg-pair">
        <Glyph face={options[0]} />
        <Glyph face={options[1]} />
      </span>
    );
  return (
    <>
      {corner}
      <span className="lg-face">{body}</span>
      <small className="lg-point">{point}</small>
    </>
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
