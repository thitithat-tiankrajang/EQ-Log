// Semantic facts over the canonical scored equation's physical tile sequence.
// EQ-Lab has already validated the placement. This parser follows the
// canonical expression grammar (unary minus, ×/÷ precedence, then +/−) to
// report exact BigInt rational properties; display text is never parsed.
const DIGITS = new Set(Array.from({ length: 10 }, (_, n) => String(n)));
const HEAVY = new Set(Array.from({ length: 11 }, (_, n) => String(n + 10)));
const mark = (tile) => tile.face === "×" || tile.face === "x" ? "*" : tile.face === "÷" ? "/" : tile.face;
const abs = (n) => n < 0n ? -n : n;
function gcd(a, b) { while (b) [a, b] = [b, a % b]; return a || 1n; }
function rational(n, d = 1n) {
  if (d === 0n) throw new Error("a validated equation divided by zero");
  if (d < 0n) [n, d] = [-n, -d];
  const common = gcd(abs(n), d);
  return { n: n / common, d: d / common };
}
function combine(a, b, op) {
  if (op === "+") return rational(a.n * b.d + b.n * a.d, a.d * b.d);
  if (op === "-") return rational(a.n * b.d - b.n * a.d, a.d * b.d);
  if (op === "*") return rational(a.n * b.n, a.d * b.d);
  return rational(a.n * b.d, a.d * b.n);
}

function parseSide(faces) {
  let cursor = 0;
  const operations = [];
  let fractionAddSub = false;
  function number() {
    const face = faces[cursor];
    if (HEAVY.has(face)) { cursor++; return rational(BigInt(face)); }
    if (!DIGITS.has(face)) throw new Error("unexpected token in validated equation");
    let digits = "";
    while (DIGITS.has(faces[cursor])) digits += faces[cursor++];
    return rational(BigInt(digits));
  }
  function unary() {
    if (faces[cursor] === "-") { cursor++; const x = unary(); return rational(-x.n, x.d); }
    return number();
  }
  function binary(next, accepted) {
    let left = next();
    while (accepted.includes(faces[cursor])) {
      const op = faces[cursor++];
      const right = next();
      operations.push(op);
      if ((op === "+" || op === "-") && (left.d !== 1n || right.d !== 1n)) fractionAddSub = true;
      left = combine(left, right, op);
    }
    return left;
  }
  const term = () => binary(unary, ["*", "/"]);
  const value = binary(term, ["+", "-"]);
  if (cursor !== faces.length) throw new Error("unparsed token in validated equation");
  return { value, operations, fractionAddSub };
}

export function equationFacts(tiles) {
  const faces = tiles.map(mark);
  const sides = [[]];
  for (const face of faces) {
    if (face === "=") sides.push([]);
    else sides[sides.length - 1].push(face);
  }
  const parsed = sides.map(parseSide);
  const result = parsed[0].value;
  const operations = parsed.flatMap((side) => side.operations);
  return {
    result: { numerator: String(result.n), denominator: String(result.d) },
    fractionAddSub: parsed.some((side) => side.fractionAddSub),
    mulDivOnly: operations.length > 0 && operations.every((op) => op === "*" || op === "/"),
    fractionResult: result.d !== 1n,
    negativeResult: result.n < 0n,
    operations: operations.map((op) => op === "*" ? "×" : op === "/" ? "÷" : op),
  };
}

export function hasEquationProperty(facts, property, threshold) {
  if (property === "FRACTION_ADD_SUB") return facts.fractionAddSub;
  if (property === "MUL_DIV_ONLY") return facts.mulDivOnly;
  if (property === "FRACTION_RESULT") return facts.fractionResult;
  if (property === "NEGATIVE_RESULT") return facts.negativeResult;
  if (property === "LARGE_INTEGER_RESULT")
    return facts.result.denominator === "1" && abs(BigInt(facts.result.numerator)) > BigInt(threshold);
  throw new Error(`unknown equation property ${property}`);
}
