// What an admin can ask the generator for, normalised and checked (DESIGN.md §4).
//
// Every range is inclusive and `null` means Any. A configuration that no
// position could ever satisfy is refused here, because the generator searches
// until it matches or is stopped: an impossible filter would otherwise just run.

import { isDeepStrictEqual } from "node:util";
import { env } from "./provenance.mjs";
import { categoryOf } from "./analysis.mjs";
import { GROUPS, TILE_KINDS, INVENTORY, compositionPossible, anyRange } from "./specification.mjs";

export const MOVE_TYPES = ["EXTEND", "CROSS", "HOOK"];
export const SEARCH_STRATEGIES = ["AUTHENTIC_ONLY", "GUIDED"];
export const SEARCH_EFFORTS = { FAST: 8, BALANCED: 24, DEEP: 64 };
/** Tile categories of the best play, by canonical kind. */
export const CATEGORIES = ["digit", "heavy", "operator", "choice", "equals", "blank"];
export const CONTENT = ["any", "arithmetic", "fraction", "fraction-sum", "large"];
export const EQUATION_PROPERTIES = ["FRACTION_ADD_SUB", "MUL_DIV_ONLY", "FRACTION_RESULT", "LARGE_INTEGER_RESULT", "NEGATIVE_RESULT"];
export const EQUATION_SCOPES = ["MAIN", "ANY", "ALL"];
export const EXTEND_SHAPES = ["HEAD_ONLY", "TAIL_ONLY", "BOTH"];
export const CONTACT_CATEGORIES = ["DIGIT", "HEAVY_NUMBER", "ARITHMETIC_OPERATOR", "EQUALS"];
const MAX_TILES = 8;
// One main equation plus at most one hooked equation per placed tile.
const MAX_EQUATIONS = MAX_TILES + 1;

export class StudyConfigError extends Error {
  constructor(problems) {
    super(problems.join(" · "));
    this.problems = problems;
    this.status = 400;
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function integer(value, name, min, max, problems) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    problems.push(`${name} ต้องเป็นจำนวนเต็ม ${min}–${max}`);
    return null;
  }
  return value;
}

/** `{ min, max }` with each end a whole number in [lo, hi] or null. */
function range(value, name, lo, hi, problems, fallback = { min: null, max: null }) {
  if (value === undefined || value === null) return { ...fallback };
  if (!isObject(value)) {
    problems.push(`${name} ต้องเป็น { min, max }`);
    return { ...fallback };
  }
  const end = (key) =>
    value[key] === undefined || value[key] === null
      ? null
      : integer(value[key], `${name} ${key}`, lo, hi, problems);
  const min = end("min");
  const max = end("max");
  if (min !== null && max !== null && min > max) problems.push(`${name}: ขั้นต่ำมากกว่าขั้นสูง`);
  return { min, max };
}

export function defaultConfig(seed = 0) {
  return {
    target: 6,
    label: "",
    seed,
    maxPerGame: 1,
    parallelGames: 2,
    search: { strategy: "GUIDED", rackBudget: SEARCH_EFFORTS.BALANCED },
    position: { boardTiles: { min: 12, max: 65 } },
    bestPlay: {
      score: { min: null, max: null },
      tiles: { min: null, max: null },
      equations: { min: null, max: null },
      moveTypes: [],
      composition: Object.fromEntries(GROUPS.map((key) => [key, anyRange()])),
      specific: {},
      content: "any",
      excludeTrivialZero: true,
    },
    answer: { maxNear: 4 },
    rack: { minDifficulty: null, size: anyRange(), groups: {}, specific: {} },
    geometry: { extend: { shapes: [], headContacts: [], tailContacts: [] } },
    equation: { scope: "MAIN", tiles: anyRange(), reusedBoardTiles: anyRange(), placedParticipating: anyRange(), properties: [], largeIntegerThreshold: 1000 },
    mobility: { legalPlacements: anyRange() },
  };
}

/** The normalised configuration, or a StudyConfigError naming every problem. */
export function configFrom(input) {
  const problems = [];
  if (!isObject(input)) throw new StudyConfigError(["รูปแบบการตั้งค่าไม่ถูกต้อง"]);
  const defaults = defaultConfig();
  const label = input.label ?? "";
  if (typeof label !== "string" || label.trim().length > 80) {
    problems.push("ชื่อชุดยาวได้ไม่เกิน 80 ตัวอักษร");
  }
  const best = isObject(input.bestPlay) ? input.bestPlay : {};
  const composition = isObject(best.composition) ? best.composition : {};
  const moveTypes = best.moveTypes ?? [];
  if (!Array.isArray(moveTypes) || moveTypes.some((type) => !MOVE_TYPES.includes(type))) {
    problems.push(`ประเภทการลงต้องเป็น ${MOVE_TYPES.join(" / ")}`);
  }
  const content = best.content ?? "any";
  if (!CONTENT.includes(content)) problems.push("เงื่อนไขเนื้อหาสมการไม่ถูกต้อง");
  const readSpecific = (value, label) => {
    if (value == null) return {};
    if (!isObject(value)) { problems.push(`${label} ต้องเป็นรายการชนิดเบี้ย`); return {}; }
    const result = {};
    for (const kind of Object.keys(value))
      if (!TILE_KINDS.includes(kind)) problems.push(`${label}: ชนิดเบี้ย ${kind} ไม่มีในชุดมาตรฐาน`);
    for (const kind of TILE_KINDS.filter((kind) => kind in value)) {
      const requested = value[kind];
      result[kind] = range(requested, `${label} ${kind}`, 0, MAX_TILES, problems);
      if ((result[kind].min ?? 0) > INVENTORY[kind]) problems.push(`${label} ${kind} มีทั้งหมด ${INVENTORY[kind]} ตัว`);
    }
    return result;
  };
  const readGroups = (value, label, fill = false) => {
    if (value != null && !isObject(value)) problems.push(`${label} ต้องเป็นรายการกลุ่มเบี้ย`);
    const entries = isObject(value) ? value : {};
    for (const key of Object.keys(entries)) if (!GROUPS.includes(key)) problems.push(`${label}: กลุ่มเบี้ย ${key} ไม่รู้จัก`);
    return Object.fromEntries((fill ? GROUPS : GROUPS.filter((key) => key in entries)).map((key) => [key, range(entries[key], `${label} ${key}`, 0, MAX_TILES, problems)]));
  };
  const extension = input.geometry?.extend ?? {};
  const validateChoiceList = (values, allowed, name) => {
    if (!Array.isArray(values) || values.some((value) => !allowed.includes(value))) { problems.push(`${name} ไม่ถูกต้อง`); return []; }
    return [...new Set(values)];
  };
  const readContacts = (items, label) => {
    if (items == null) return [];
    if (!Array.isArray(items)) { problems.push(`${label} ต้องเป็นรายการคู่ (anchor, extension)`); return []; }
    return items.filter((pair) => {
      const valid = Array.isArray(pair) && pair.length === 2 && pair.every((value) => CONTACT_CATEGORIES.includes(value));
      if (!valid) problems.push(`${label}: คู่สัมผัสต้องเป็น (anchor, extension)`);
      return valid;
    });
  };
  const equation = input.equation ?? {};
  const scope = equation.scope ?? "MAIN";
  if (!EQUATION_SCOPES.includes(scope)) problems.push("ขอบเขตสมการต้องเป็น MAIN / ANY / ALL");
  const properties = validateChoiceList(equation.properties ?? [], EQUATION_PROPERTIES, "คุณสมบัติสมการ");
  const strategy = input.search?.strategy ?? defaults.search.strategy;
  if (!SEARCH_STRATEGIES.includes(strategy))
    problems.push("รูปแบบค้นหาต้องเป็น GUIDED หรือ AUTHENTIC_ONLY");

  const config = {
    target: integer(input.target ?? defaults.target, "จำนวนข้อที่ต้องการ", 1, 50, problems),
    label: typeof label === "string" ? label.trim() : "",
    seed: integer(input.seed, "เลขสุ่ม", 0, 2147483647, problems),
    maxPerGame: integer(input.maxPerGame ?? defaults.maxPerGame, "โจทย์ต่อเกม", 1, 5, problems),
    parallelGames: integer(
      input.parallelGames ?? defaults.parallelGames,
      "เกมที่เล่นพร้อมกัน",
      1,
      4,
      problems,
    ),
    position: {
      boardTiles: range(
        input.position?.boardTiles,
        "จำนวนเบี้ยบนกระดาน",
        0,
        100,
        problems,
        defaults.position.boardTiles,
      ),
    },
    search: {
      strategy,
      rackBudget: integer(
        input.search?.rackBudget ?? defaults.search.rackBudget,
        "ชุดเบี้ยต่อหนึ่งตำแหน่ง",
        1,
        64,
        problems,
      ),
    },
    bestPlay: {
      score: range(best.score, "แต้มของตาที่ดีที่สุด", 0, 999, problems),
      tiles: range(best.tiles, "จำนวนเบี้ยที่ลง", 1, MAX_TILES, problems),
      equations: range(best.equations, "จำนวนสมการที่ได้แต้ม", 1, MAX_EQUATIONS, problems),
      moveTypes: Array.isArray(moveTypes)
        ? [...new Set(moveTypes)].filter((t) => MOVE_TYPES.includes(t))
        : [],
      composition: readGroups(composition, "เบี้ยที่ลง", true),
      specific: readSpecific(best.specific, "เบี้ยเฉพาะที่ลง"),
      content: CONTENT.includes(content) ? content : "any",
      excludeTrivialZero: best.excludeTrivialZero !== false,
    },
    answer: {
      maxNear: integer(
        input.answer?.maxNear ?? defaults.answer.maxNear,
        "คำตอบที่ค่าใกล้กันสูงสุด",
        1,
        12,
        problems,
      ),
    },
    rack: {
      minDifficulty:
        input.rack?.minDifficulty === undefined || input.rack?.minDifficulty === null
          ? null
          : integer(input.rack.minDifficulty, "ความติดมือของเบี้ย", 2, 6, problems),
      size: range(input.rack?.size, "จำนวนเบี้ยในมือ", 1, MAX_TILES, problems),
      groups: readGroups(input.rack?.groups, "กลุ่มเบี้ยในมือ"),
      specific: readSpecific(input.rack?.specific, "เบี้ยเฉพาะในมือ"),
    },
    geometry: { extend: {
      shapes: validateChoiceList(extension.shapes ?? [], EXTEND_SHAPES, "รูปแบบ EXTEND"),
      headContacts: readContacts(extension.headContacts, "สัมผัสด้านหัว"),
      tailContacts: readContacts(extension.tailContacts, "สัมผัสด้านท้าย"),
    } },
    equation: {
      scope: EQUATION_SCOPES.includes(scope) ? scope : "MAIN",
      tiles: range(equation.tiles, "ความยาวสมการ", 2, 15, problems),
      reusedBoardTiles: range(equation.reusedBoardTiles, "เบี้ยเดิมในสมการ", 0, 15, problems),
      placedParticipating: range(equation.placedParticipating, "เบี้ยใหม่ในสมการ", 0, MAX_TILES, problems),
      properties,
      largeIntegerThreshold: integer(equation.largeIntegerThreshold ?? 1000, "เกณฑ์จำนวนเต็มใหญ่", 0, Number.MAX_SAFE_INTEGER, problems),
    },
    mobility: { legalPlacements: range(input.mobility?.legalPlacements, "จำนวนตาที่ลงได้", 0, 1000000, problems) },
  };
  if (problems.length > 0) throw new StudyConfigError(problems);
  const impossible = impossibility(config);
  if (impossible.length > 0) throw new StudyConfigError(impossible);
  return config;
}

/**
 * Where a stored configuration differs from what this normaliser makes of it,
 * as dotted paths two levels deep; [] when it is already exactly that. A
 * configuration normalised by other code — an older normaliser still loaded in a
 * long-running dev server — shows up here as every field that code did not know.
 */
export function configDrift(stored, normalized = configFrom(stored)) {
  const keysOf = (value) => (isObject(value) ? Object.keys(value) : []);
  const paths = [];
  for (const key of new Set([...keysOf(stored), ...keysOf(normalized)])) {
    const [had, has] = [stored?.[key], normalized[key]];
    if (isDeepStrictEqual(had, has)) continue;
    const inner = isObject(had) && isObject(has) ? [...new Set([...keysOf(had), ...keysOf(has)])] : [];
    const differing = inner.filter((sub) => !isDeepStrictEqual(had[sub], has[sub]));
    paths.push(...(differing.length ? differing.map((sub) => `${key}.${sub}`) : [key]));
  }
  return paths;
}

/** Why no best play could ever match, if that is so. */
export function impossibility(config) {
  const problems = [];
  const { tiles, equations, moveTypes, composition } = config.bestPlay;
  if (!compositionPossible({ groups: config.rack.groups, specific: config.rack.specific, minSize: config.rack.size.min ?? 1, maxSize: config.rack.size.max ?? 8 }))
    problems.push("เงื่อนไขชนิดเบี้ยในมือขัดกันหรือเป็นไปไม่ได้ตามจำนวนเบี้ยจริง");
  if (!compositionPossible({ groups: composition, specific: config.bestPlay.specific, minSize: tiles.min ?? 1, maxSize: tiles.max ?? 8 }))
    problems.push("เงื่อนไขเบี้ยที่ตาที่ดีที่สุดต้องลงขัดกันหรือเป็นไปไม่ได้");
  const containingGroups = Object.fromEntries(GROUPS.map((group) => [group, {
    min: Math.max(config.rack.groups[group]?.min ?? 0, composition[group]?.min ?? 0),
    max: config.rack.groups[group]?.max ?? null,
  }]));
  const containingSpecific = Object.fromEntries(TILE_KINDS.map((kind) => [kind, {
    min: Math.max(config.rack.specific[kind]?.min ?? 0, config.bestPlay.specific[kind]?.min ?? 0),
    max: config.rack.specific[kind]?.max ?? null,
  }]));
  if (!compositionPossible({
    groups: containingGroups,
    specific: containingSpecific,
    minSize: Math.max(config.rack.size.min ?? 1, tiles.min ?? 1),
    maxSize: config.rack.size.max ?? 8,
  })) problems.push("เบี้ยในมือไม่สามารถมีเบี้ยที่ตาที่ดีที่สุดต้องลงตามเงื่อนไขได้");
  if ((tiles.min ?? 1) > (config.rack.size.max ?? 8)) problems.push("จำนวนเบี้ยที่ต้องลงเกินจำนวนเบี้ยในมือ");
  const equation = config.equation;
  if (equation.placedParticipating.min !== null && equation.placedParticipating.min > (tiles.max ?? 8))
    problems.push("เบี้ยใหม่ในสมการเกินจำนวนเบี้ยที่ตาที่ดีที่สุดลงได้");
  if (equation.tiles.max !== null &&
    (equation.reusedBoardTiles.min ?? 0) + (equation.placedParticipating.min ?? 0) > equation.tiles.max)
    problems.push("เบี้ยเดิมและเบี้ยใหม่ขั้นต่ำรวมกันเกินความยาวสมการสูงสุด");
  if (equation.tiles.min !== null && equation.reusedBoardTiles.max !== null && equation.placedParticipating.max !== null &&
    equation.reusedBoardTiles.max + equation.placedParticipating.max < equation.tiles.min)
    problems.push("เบี้ยเดิมและเบี้ยใหม่ขั้นสูงรวมกันน้อยกว่าความยาวสมการขั้นต่ำ");
  if (equation.properties.includes("MUL_DIV_ONLY") && equation.properties.includes("FRACTION_ADD_SUB"))
    problems.push("สมการที่มีเฉพาะคูณ/หารไม่สามารถบวกหรือลบเศษส่วนในสมการเดียวกัน");
  if (equation.properties.includes("FRACTION_RESULT") && equation.properties.includes("LARGE_INTEGER_RESULT"))
    problems.push("ผลลัพธ์สมการไม่เป็นทั้งเศษส่วนและจำนวนเต็มในสมการเดียวกัน");
  const inventory = Object.fromEntries(CATEGORIES.map((key) => [key, 0]));
  for (const tile of env.createManifest().tiles) inventory[categoryOf(tile.kind)]++;
  for (const key of CATEGORIES) {
    if ((composition[key].min ?? 0) > inventory[key])
      problems.push(
        `เบี้ย ${key} มีทั้งหมด ${inventory[key]} ตัว แต่ต้องการอย่างน้อย ${composition[key].min}`,
      );
  }
  const mins = CATEGORIES.reduce((sum, key) => sum + (composition[key].min ?? 0), 0);
  const maxes = Math.min(
    MAX_TILES,
    CATEGORIES.reduce(
      (sum, key) => sum + Math.min(composition[key].max ?? MAX_TILES, inventory[key]),
      0,
    ),
  );
  const tilesMax = tiles.max ?? MAX_TILES;
  const tilesMin = tiles.min ?? 1;
  if (mins > tilesMax) {
    problems.push(`เบี้ยขั้นต่ำรวมกัน ${mins} ตัว เกินจำนวนเบี้ยที่ลงได้ (${tilesMax})`);
  }
  if (tilesMin > maxes) {
    problems.push(
      `เบี้ยขั้นสูงของทุกประเภทรวมกันได้แค่ ${maxes} ตัว น้อยกว่าที่ต้องลง (${tilesMin})`,
    );
  }
  // HOOK always scores a second equation; the labels are inclusive (OR), so
  // this is the one combination no move can meet.
  const onlyHook = moveTypes.length === 1 && moveTypes[0] === "HOOK";
  if (onlyHook && equations.max !== null && equations.max < 2) {
    problems.push("HOOK ได้แต้มจากอย่างน้อย 2 สมการเสมอ แต่จำกัดจำนวนสมการไว้ต่ำกว่านั้น");
  }
  if ((equations.min ?? 1) > tilesMax + 1)
    problems.push(`ลงได้สูงสุด ${tilesMax} เบี้ย จึงได้ไม่เกิน ${tilesMax + 1} สมการ`);
  return problems;
}
