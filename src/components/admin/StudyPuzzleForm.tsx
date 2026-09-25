import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Dices, Search } from "lucide-react";
import { SelectControl } from "../ui/SelectControl";
import type {
  ContentFilter,
  MoveLabel,
  Range,
  StudyPuzzleConfig,
  TileCategory,
  TileGroup,
  EquationProperty,
  ContactCategory,
  ContactPair,
} from "../../features/studyPuzzles/api";
import { AMATH_TOKENS } from "../../game";
import { CATEGORY_TEXT, CONTENT_TEXT, MOVE_LABEL_TEXT } from "./studyPuzzleLabels";

const CATEGORIES: TileCategory[] = ["digit", "heavy", "operator", "choice", "equals", "blank"];
const GROUPS: TileGroup[] = [...CATEGORIES, "arithmetic", "operatorLike"];
const SPECIAL_GROUPS: TileGroup[] = ["arithmetic", "operatorLike"];
const TILE_KINDS = Object.keys(AMATH_TOKENS);
const PROPERTIES: { key: EquationProperty; label: string }[] = [
  { key: "FRACTION_ADD_SUB", label: "บวก/ลบค่าที่เป็นเศษส่วน" },
  { key: "MUL_DIV_ONLY", label: "มีเฉพาะคูณ/หาร" },
  { key: "FRACTION_RESULT", label: "ผลลัพธ์เป็นเศษส่วน" },
  { key: "LARGE_INTEGER_RESULT", label: "ผลลัพธ์เป็นจำนวนเต็มขนาดใหญ่" },
  { key: "NEGATIVE_RESULT", label: "ผลลัพธ์ติดลบ" },
];
const CONTACTS: { key: ContactCategory; label: string }[] = [
  { key: "DIGIT", label: "เลข 0–9" },
  { key: "HEAVY_NUMBER", label: "เลข 10–20" },
  { key: "ARITHMETIC_OPERATOR", label: "+ − × ÷" },
  { key: "EQUALS", label: "=" },
];
const GROUP_LABELS: Record<TileGroup, string> = {
  digit: "เลข 0–9",
  heavy: "เลข 10–20",
  operator: "+ − × ÷",
  choice: "เบี้ยสองหน้า",
  equals: "=",
  blank: "เบี้ยว่าง",
  arithmetic: "เครื่องหมายคำนวณรวมเบี้ยสองหน้า (ไม่รวม =)",
  operatorLike: "เครื่องหมายทุกชนิดรวม =",
};
const LABELS: MoveLabel[] = ["EXTEND", "CROSS", "HOOK"];
const CONTENTS: ContentFilter[] = ["any", "arithmetic", "fraction", "fraction-sum", "large"];
const ANY: Range = { min: null, max: null };

export const randomSeed = () => Math.floor(Math.random() * 2_147_483_647);

/** The generator's own defaults (tools/study-puzzles/lib/config.mjs). */
export function defaultStudyConfig(seed = randomSeed()): StudyPuzzleConfig {
  return {
    target: 6,
    label: "",
    seed,
    maxPerGame: 1,
    parallelGames: 2,
    search: { strategy: "GUIDED", rackBudget: 24 },
    position: { boardTiles: { min: 12, max: 65 } },
    bestPlay: {
      score: { ...ANY },
      tiles: { ...ANY },
      equations: { ...ANY },
      moveTypes: [],
      composition: Object.fromEntries(GROUPS.map((key) => [key, { ...ANY }])) as Record<
        TileGroup,
        Range
      >,
      specific: {},
      content: "any",
      excludeTrivialZero: true,
    },
    answer: { maxNear: 4 },
    rack: { minDifficulty: null, size: { ...ANY }, groups: {}, specific: {} },
    geometry: { extend: { shapes: [], headContacts: [], tailContacts: [] } },
    equation: {
      scope: "MAIN",
      tiles: { ...ANY },
      reusedBoardTiles: { ...ANY },
      placedParticipating: { ...ANY },
      properties: [],
      largeIntegerThreshold: 1000,
    },
    mobility: { legalPlacements: { ...ANY } },
  };
}

type Patch = {
  bestPlay?: Partial<StudyPuzzleConfig["bestPlay"]>;
  rack?: StudyPuzzleConfig["rack"];
  target?: number;
};

export const PRESETS: { key: string; label: string; patch: Patch }[] = [
  {
    key: "class",
    label: "ชุดสอนทั่วไป",
    patch: {
      bestPlay: { score: { min: 70, max: null }, tiles: { min: 6, max: null } },
      rack: { minDifficulty: 3 },
    },
  },
  {
    key: "extend",
    label: "ต่อ (EXTEND)",
    patch: { bestPlay: { moveTypes: ["EXTEND"], score: { min: 40, max: null } } },
  },
  {
    key: "cross",
    label: "ไขว้ (CROSS)",
    patch: { bestPlay: { moveTypes: ["CROSS"], score: { min: 60, max: null } } },
  },
  { key: "hook", label: "ฮุก (HOOK)", patch: { target: 3, bestPlay: { moveTypes: ["HOOK"] } } },
  { key: "bingo", label: "บิงโก", patch: { bestPlay: { tiles: { min: 8, max: null } } } },
  {
    key: "fraction-sum",
    label: "บวกลบเศษส่วน",
    patch: { bestPlay: { content: "fraction-sum", score: { min: 50, max: null } } },
  },
  {
    key: "large",
    label: "เลขหลักร้อย",
    patch: { bestPlay: { content: "large", score: { min: 60, max: null } } },
  },
];

/** A preset over the current set's name, size and seed: every filter it does not name goes back to Any. */
export function applyPreset(current: StudyPuzzleConfig, patch: Patch): StudyPuzzleConfig {
  const base = defaultStudyConfig(current.seed);
  return {
    ...current,
    target: patch.target ?? current.target,
    bestPlay: { ...base.bestPlay, ...patch.bestPlay },
    answer: base.answer,
    rack: patch.rack ?? base.rack,
    geometry: base.geometry,
    equation: base.equation,
    mobility: base.mobility,
  };
}

const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));
const activeRange = (value: Range) => value.min !== null || value.max !== null;
const formatRange = (label: string, value: Range) =>
  `${label}${label ? " " : ""}${!activeRange(value) ? "ไม่จำกัด" : value.min !== null && value.min === value.max ? `= ${value.min}` : value.min !== null && value.max !== null ? `${value.min}–${value.max}` : value.min !== null ? `≥ ${value.min}` : `≤ ${value.max}`}`;
function formProblems(config: StudyPuzzleConfig): string[] {
  const problems: string[] = [];
  const baseGroups = CATEGORIES;
  const kindGroup = (kind: string): TileCategory | null => {
    const type = AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS]?.type;
    return (
      (
        {
          lightNumber: "digit",
          heavyNumber: "heavy",
          operator: "operator",
          choice: "choice",
          equals: "equals",
          Blank: "blank",
        } as Record<string, TileCategory>
      )[type ?? ""] ?? null
    );
  };
  const possibleComposition = (
    groups: Partial<Record<TileGroup, Range>>,
    specific: Record<string, Range>,
    minSize: number,
    maxSize: number,
  ): boolean => {
    if (
      TILE_KINDS.some(
        (kind) =>
          (specific[kind]?.min ?? 0) >
          Math.min(
            AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS].count,
            specific[kind]?.max ?? AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS].count,
          ),
      )
    )
      return false;
    const options = baseGroups.map((group) => {
      const kinds = TILE_KINDS.filter((kind) => kindGroup(kind) === group);
      const min = Math.max(
        groups[group]?.min ?? 0,
        kinds.reduce((sum, kind) => sum + (specific[kind]?.min ?? 0), 0),
      );
      const max = Math.min(
        maxSize,
        groups[group]?.max ?? maxSize,
        kinds.reduce(
          (sum, kind) =>
            sum +
            Math.min(
              AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS].count,
              specific[kind]?.max ?? 8,
            ),
          0,
        ),
      );
      return { group, min, max };
    });
    if (options.some(({ min, max }) => min > max)) return false;
    const counts: Partial<Record<TileCategory, number>> = {};
    function visit(index: number, total: number): boolean {
      if (index === options.length) {
        const arithmetic = (counts.operator ?? 0) + (counts.choice ?? 0);
        return (
          total >= minSize &&
          total <= maxSize &&
          (groups.arithmetic?.min == null || arithmetic >= groups.arithmetic.min) &&
          (groups.arithmetic?.max == null || arithmetic <= groups.arithmetic.max) &&
          (groups.operatorLike?.min == null ||
            arithmetic + (counts.equals ?? 0) >= groups.operatorLike.min) &&
          (groups.operatorLike?.max == null ||
            arithmetic + (counts.equals ?? 0) <= groups.operatorLike.max)
        );
      }
      const { group, min, max } = options[index];
      for (let n = min; n <= max && total + n <= maxSize; n++) {
        counts[group] = n;
        if (visit(index + 1, total + n)) return true;
      }
      return false;
    }
    return visit(0, 0);
  };
  const checkRanges = (items: Record<string, Range>, label: string) => {
    for (const [key, value] of Object.entries(items))
      if (value.min !== null && value.max !== null && value.min > value.max)
        problems.push(`${label} ${key}: ขั้นต่ำมากกว่าขั้นสูง`);
  };
  const checkKinds = (
    specific: Record<string, Range>,
    groups: Partial<Record<TileGroup, Range>>,
    label: string,
  ) => {
    checkRanges(specific, label);
    for (const [kind, range] of Object.entries(specific)) {
      const physical = AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS];
      if (!physical) problems.push(`${label}: ไม่รู้จักเบี้ย ${kind}`);
      else if ((range.min ?? 0) > physical.count)
        problems.push(`${label} ${kind}: มีทั้งหมด ${physical.count} ตัว`);
    }
    checkRanges(groups as Record<string, Range>, label);
    for (const group of GROUPS) {
      const minimum = Object.entries(specific).reduce((sum, [kind, range]) => {
        const type = AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS]?.type;
        const inGroup =
          group === "arithmetic"
            ? type === "operator" || type === "choice"
            : group === "operatorLike"
              ? type === "operator" || type === "choice" || type === "equals"
              : (
                  {
                    digit: "lightNumber",
                    heavy: "heavyNumber",
                    operator: "operator",
                    choice: "choice",
                    equals: "equals",
                    blank: "Blank",
                  } as Record<string, string>
                )[group] === type;
        return sum + (inGroup ? (range.min ?? 0) : 0);
      }, 0);
      if (
        groups[group]?.max !== null &&
        groups[group]?.max !== undefined &&
        minimum > groups[group]!.max!
      )
        problems.push(
          `${label}: เบี้ยเฉพาะขั้นต่ำ ${minimum} ตัว เกินกลุ่ม ${GROUP_LABELS[group]} สูงสุด ${groups[group]!.max}`,
        );
    }
  };
  checkKinds(config.rack.specific ?? {}, config.rack.groups ?? {}, "Rack");
  checkKinds(config.bestPlay.specific ?? {}, config.bestPlay.composition, "ตาที่ดีที่สุด");
  checkRanges({ size: config.rack.size ?? ANY }, "Rack");
  checkRanges(
    {
      tiles: config.bestPlay.tiles,
      equations: config.bestPlay.equations,
      score: config.bestPlay.score,
    },
    "ตาที่ดีที่สุด",
  );
  if (
    !possibleComposition(
      config.rack.groups ?? {},
      config.rack.specific ?? {},
      config.rack.size?.min ?? 1,
      config.rack.size?.max ?? 8,
    )
  )
    problems.push("เงื่อนไขเบี้ยในมือขัดกันหรือเกินจำนวนเบี้ยจริง");
  if (
    !possibleComposition(
      config.bestPlay.composition,
      config.bestPlay.specific ?? {},
      config.bestPlay.tiles.min ?? 1,
      config.bestPlay.tiles.max ?? 8,
    )
  )
    problems.push("เงื่อนไขเบี้ยที่ลงขัดกันหรือเกินจำนวนเบี้ยจริง");
  const containingGroups = Object.fromEntries(
    GROUPS.map((group) => [
      group,
      {
        min: Math.max(
          config.rack.groups?.[group]?.min ?? 0,
          config.bestPlay.composition[group]?.min ?? 0,
        ),
        max: config.rack.groups?.[group]?.max ?? null,
      },
    ]),
  ) as Partial<Record<TileGroup, Range>>;
  const containingSpecific = Object.fromEntries(
    TILE_KINDS.map((kind) => [
      kind,
      {
        min: Math.max(
          config.rack.specific?.[kind]?.min ?? 0,
          config.bestPlay.specific?.[kind]?.min ?? 0,
        ),
        max: config.rack.specific?.[kind]?.max ?? null,
      },
    ]),
  ) as Record<string, Range>;
  if (
    !possibleComposition(
      containingGroups,
      containingSpecific,
      Math.max(config.rack.size?.min ?? 1, config.bestPlay.tiles.min ?? 1),
      config.rack.size?.max ?? 8,
    )
  )
    problems.push("เบี้ยในมือไม่สามารถมีเบี้ยที่ตาที่ดีที่สุดต้องลงตามเงื่อนไขได้");
  if (
    config.rack.size?.max !== null &&
    config.rack.size?.max !== undefined &&
    (config.bestPlay.tiles.min ?? 0) > config.rack.size.max
  )
    problems.push("ตาที่ดีที่สุดต้องลงเบี้ยมากกว่าจำนวนเบี้ยในมือ");
  if (
    config.equation?.properties.includes("MUL_DIV_ONLY") &&
    config.equation.properties.includes("FRACTION_ADD_SUB")
  )
    problems.push("สมการเดียวกันเป็นทั้งเฉพาะคูณ/หารและบวก/ลบเศษส่วนไม่ได้");
  if (
    config.equation?.properties.includes("FRACTION_RESULT") &&
    config.equation.properties.includes("LARGE_INTEGER_RESULT")
  )
    problems.push("สมการเดียวกันเป็นทั้งผลเศษส่วนและจำนวนเต็มไม่ได้");
  if (
    config.bestPlay.moveTypes.length === 1 &&
    config.bestPlay.moveTypes[0] === "HOOK" &&
    config.bestPlay.equations.max !== null &&
    config.bestPlay.equations.max < 2
  )
    problems.push("HOOK ได้แต้มอย่างน้อย 2 สมการ");
  return problems;
}

function RangeField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: Range;
  min: number;
  max: number;
  onChange: (next: Range) => void;
}) {
  const id = useId();
  return (
    <div className="eq-field eq-study-range">
      <span id={`${id}-label`}>{label}</span>
      <div className="eq-study-range-inputs" role="group" aria-labelledby={`${id}-label`}>
        <input
          aria-label={`${label} ขั้นต่ำ`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          placeholder="ไม่จำกัด"
          value={value.min ?? ""}
          onChange={(event) => onChange({ ...value, min: numberOrNull(event.target.value) })}
        />
        <span aria-hidden>–</span>
        <input
          aria-label={`${label} ขั้นสูง`}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          placeholder="ไม่จำกัด"
          value={value.max ?? ""}
          onChange={(event) => onChange({ ...value, max: numberOrNull(event.target.value) })}
        />
      </div>
      {hint && <small>{hint}</small>}
      <div className="eq-study-range-shortcuts">
        <button type="button" onClick={() => onChange({ min: null, max: null })}>
          Any
        </button>
        <button
          type="button"
          onClick={() => {
            const n = value.min ?? value.max;
            if (n != null) onChange({ min: n, max: n });
          }}
        >
          Exact
        </button>
      </div>
    </div>
  );
}

function SpecificControls({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Record<string, Range>;
  onChange: (next: Record<string, Range>) => void;
}) {
  return (
    <div className="eq-study-specific">
      <label>
        {label}{" "}
        <select
          aria-label={`${label} เพิ่มชนิดเบี้ย`}
          value=""
          onChange={(event) => {
            const kind = event.target.value;
            if (kind) onChange({ ...value, [kind]: { min: 1, max: null } });
          }}
        >
          <option value="">เพิ่มชนิดเบี้ย…</option>
          {TILE_KINDS.filter((kind) => !(kind in value)).map((kind) => (
            <option key={kind} value={kind}>
              {AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS].token} ({kind})
            </option>
          ))}
        </select>
      </label>
      <div className="eq-study-composition">
        {Object.entries(value).map(([kind, range]) => (
          <div key={kind}>
            <RangeField
              label={`${label} ${AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS]?.token ?? kind}`}
              value={range}
              min={0}
              max={AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS]?.count ?? 8}
              onChange={(next) => onChange({ ...value, [kind]: next })}
            />
            <button
              type="button"
              onClick={() => {
                const next = { ...value };
                delete next[kind];
                onChange(next);
              }}
            >
              ลบ {kind}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContactPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ContactPair[];
  onChange: (next: ContactPair[]) => void;
}) {
  const [anchor, setAnchor] = useState<ContactCategory>("DIGIT");
  const [extension, setExtension] = useState<ContactCategory>("DIGIT");
  return (
    <div className="eq-field">
      <span>{label} (เบี้ยเดิม → เบี้ยใหม่)</span>
      <div className="eq-study-contact-picker">
        <select
          aria-label={`${label} เบี้ยเดิม`}
          value={anchor}
          onChange={(event) => setAnchor(event.target.value as ContactCategory)}
        >
          {CONTACTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <span>→</span>
        <select
          aria-label={`${label} เบี้ยใหม่`}
          value={extension}
          onChange={(event) => setExtension(event.target.value as ContactCategory)}
        >
          {CONTACTS.map((item) => (
            <option key={item.key} value={item.key}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (!value.some((pair) => pair[0] === anchor && pair[1] === extension))
              onChange([...value, [anchor, extension]]);
          }}
        >
          เพิ่ม
        </button>
      </div>
      {value.map((pair) => (
        <button
          key={pair.join(":")}
          type="button"
          onClick={() => onChange(value.filter((item) => item !== pair))}
        >
          {pair.join(" → ")} ×
        </button>
      ))}
    </div>
  );
}

function ConfigSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="eq-study-advanced" open={open}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen(!open);
        }}
      >
        {title}
      </summary>
      {open && children}
    </details>
  );
}

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const id = useId();
  return (
    <div className="eq-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-describedby={hint ? `${id}-hint` : undefined}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={Number.isNaN(value) ? "" : value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        required
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}

export function StudyPuzzleForm({
  config,
  preset,
  canGenerate,
  onChange,
  onPreset,
  onSubmit,
}: {
  config: StudyPuzzleConfig;
  preset: string | null;
  canGenerate: boolean;
  onChange: (next: StudyPuzzleConfig) => void;
  onPreset: (key: string) => void;
  onSubmit: () => void;
}) {
  const best = config.bestPlay;
  const search = config.search ?? { strategy: "GUIDED", rackBudget: 24 };
  const rack = config.rack;
  const extension = config.geometry?.extend ?? { shapes: [], headContacts: [], tailContacts: [] };
  const equation = config.equation ?? defaultStudyConfig(config.seed).equation!;
  const mobility = config.mobility ?? { legalPlacements: { ...ANY } };
  const problems = formProblems(config);
  const describeGroups = (groups: Partial<Record<TileGroup, Range>>) =>
    GROUPS.filter((key) => groups[key] && activeRange(groups[key]!)).map(
      (key) => `${GROUP_LABELS[key]} ${formatRange("", groups[key]!)}`,
    );
  const describeSpecific = (specific: Record<string, Range>) =>
    Object.entries(specific)
      .filter(([, range]) => activeRange(range))
      .map(
        ([kind, range]) =>
          `${AMATH_TOKENS[kind as keyof typeof AMATH_TOKENS]?.token ?? kind} ${formatRange("", range)}`,
      );
  const rackSummary = [
    formatRange("เบี้ยในมือ", rack.size ?? ANY),
    ...describeGroups(rack.groups ?? {}),
    ...describeSpecific(rack.specific ?? {}),
  ].join(" · ");
  const bestSummary = [
    best.moveTypes.join(" / ") || "ทุกประเภท",
    formatRange("ลงเบี้ย", best.tiles),
    ...describeGroups(best.composition),
    ...describeSpecific(best.specific ?? {}),
  ].join(" · ");
  const equationSummary = [
    equation.scope,
    formatRange("ความยาว", equation.tiles),
    formatRange("เบี้ยเดิม", equation.reusedBoardTiles),
    formatRange("เบี้ยใหม่ในสมการ", equation.placedParticipating),
    ...equation.properties.map((property) =>
      property === "LARGE_INTEGER_RESULT"
        ? `${property} > ${equation.largeIntegerThreshold}`
        : property,
    ),
  ].join(" · ");
  const geometrySummary = [
    extension.shapes.join("/") || "EXTEND ทุกแบบ",
    ...extension.headContacts.map((pair) => `หัว ${pair.join("→")}`),
    ...extension.tailContacts.map((pair) => `ท้าย ${pair.join("→")}`),
  ].join(" · ");
  const setBest = (patch: Partial<StudyPuzzleConfig["bestPlay"]>) =>
    onChange({ ...config, bestPlay: { ...best, ...patch } });
  const setRack = (patch: Partial<StudyPuzzleConfig["rack"]>) =>
    onChange({ ...config, rack: { ...rack, ...patch } });
  const setExtension = (patch: Partial<typeof extension>) =>
    onChange({ ...config, geometry: { extend: { ...extension, ...patch } } });
  const setEquation = (patch: Partial<NonNullable<StudyPuzzleConfig["equation"]>>) =>
    onChange({ ...config, equation: { ...equation, ...patch } });
  const toggleLabel = (label: MoveLabel) =>
    setBest({
      moveTypes: best.moveTypes.includes(label)
        ? best.moveTypes.filter((type) => type !== label)
        : LABELS.filter((type) => type === label || best.moveTypes.includes(type)),
    });

  return (
    <form
      className="eq-study-form"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="eq-segmented-control" aria-label="แนวโจทย์สำเร็จรูป">
        {PRESETS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={preset === item.key ? "is-active" : ""}
            aria-pressed={preset === item.key}
            onClick={() => onPreset(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="eq-study-form-grid">
        <NumberField
          label="จำนวนข้อที่ต้องการ"
          hint="ค้นหาต่อไปจนได้ครบ หรือจนกว่าจะกดหยุด"
          min={1}
          max={50}
          value={config.target}
          onChange={(target) => onChange({ ...config, target })}
        />
        <div className="eq-field">
          <label htmlFor="study-label">ชื่อชุด (ไม่บังคับ)</label>
          <input
            id="study-label"
            maxLength={80}
            placeholder="เช่น ฮุกสำหรับห้องเรียน"
            value={config.label}
            onChange={(event) => onChange({ ...config, label: event.target.value })}
          />
        </div>
      </div>

      <div className="eq-study-form-grid">
        <div className="eq-field">
          <label htmlFor="study-search-strategy">รูปแบบการค้นหา</label>
          <select
            id="study-search-strategy"
            value={search.strategy}
            onChange={(event) =>
              onChange({
                ...config,
                search: { ...search, strategy: event.target.value as typeof search.strategy },
              })
            }
          >
            <option value="GUIDED">Guided search (แนะนำ)</option>
            <option value="AUTHENTIC_ONLY">Authentic seeded only</option>
          </select>
          <small>
            {search.strategy === "GUIDED"
              ? "ใช้กระดานจากเกมจริง แล้วทดลองชุดเบี้ยที่เป็นไปได้จากเบี้ยที่ยังไม่เห็น เพื่อหาโจทย์ตามเงื่อนไขเร็วขึ้น"
              : "ใช้เฉพาะชุดเบี้ยที่แจกจริงตาม seed"}
          </small>
        </div>
        {search.strategy === "GUIDED" && (
          <div className="eq-field">
            <label htmlFor="study-search-effort">ความละเอียดการค้นหา</label>
            <select
              id="study-search-effort"
              value={search.rackBudget}
              onChange={(event) =>
                onChange({
                  ...config,
                  search: { ...search, rackBudget: Number(event.target.value) },
                })
              }
            >
              <option value={8}>Fast · 8 ชุดเบี้ยต่อตำแหน่ง</option>
              <option value={24}>Balanced · 24 ชุดเบี้ยต่อตำแหน่ง</option>
              <option value={64}>Deep · 64 ชุดเบี้ยต่อตำแหน่ง</option>
            </select>
          </div>
        )}
      </div>

      <ConfigSection title="1. Rack ของโจทย์ · เบี้ยที่มีในมือ">
        <p className="eq-study-muted">RACK CONTAINS · นับเบี้ยจริงทั้งมือ รวมเบี้ยที่ไม่ได้ใช้ลง</p>
        <RangeField
          label="จำนวนเบี้ยในมือ"
          value={rack.size ?? ANY}
          min={1}
          max={8}
          onChange={(size) => setRack({ size })}
        />
        <div className="eq-study-composition">
          {GROUPS.map((key) => (
            <RangeField
              key={key}
              label={`Rack ${GROUP_LABELS[key]}`}
              value={rack.groups?.[key] ?? ANY}
              min={0}
              max={8}
              onChange={(range) => setRack({ groups: { ...rack.groups, [key]: range } })}
            />
          ))}
        </div>
        <SpecificControls
          label="Rack ชนิดเบี้ยเฉพาะ"
          value={rack.specific ?? {}}
          onChange={(specific) => setRack({ specific })}
        />
      </ConfigSection>

      <ConfigSection title="2. ตาที่ดีที่สุด · เบี้ยที่วางจริง">
        <p className="eq-study-muted">
          BEST PLAY ACTUALLY PLACES · นับเฉพาะเบี้ยใหม่ ไม่รวมเบี้ยเดิมบนกระดาน
        </p>
        <div className="eq-study-form-grid">
          <RangeField
            label="จำนวนเบี้ยที่ลง"
            min={1}
            max={8}
            value={best.tiles}
            onChange={(tiles) => setBest({ tiles })}
          />
          <RangeField
            label="จำนวนสมการที่ได้แต้ม"
            hint="ฮุกได้แต้มอย่างน้อย 2 สมการ"
            min={1}
            max={9}
            value={best.equations}
            onChange={(equations) => setBest({ equations })}
          />
        </div>
        <div className="eq-study-composition">
          {CATEGORIES.map((key) => (
            <RangeField
              key={key}
              label={`${CATEGORY_TEXT[key].name} (${CATEGORY_TEXT[key].symbol})`}
              min={0}
              max={8}
              value={best.composition[key]}
              onChange={(range) => setBest({ composition: { ...best.composition, [key]: range } })}
            />
          ))}
          {SPECIAL_GROUPS.map((key) => (
            <RangeField
              key={key}
              label={`ตาที่ดีที่สุด ${GROUP_LABELS[key]}`}
              min={0}
              max={8}
              value={best.composition[key] ?? ANY}
              onChange={(range) => setBest({ composition: { ...best.composition, [key]: range } })}
            />
          ))}
        </div>
        <SpecificControls
          label="ตาที่ดีที่สุดวางชนิดเบี้ยเฉพาะ"
          value={best.specific ?? {}}
          onChange={(specific) => setBest({ specific })}
        />
      </ConfigSection>

      <ConfigSection title="3. รูปแบบการลง">
        <fieldset className="eq-study-fieldset">
          <legend>ประเภทการลงของตาที่ดีที่สุด</legend>
          <p className="eq-study-muted">
            เลือกได้หลายแบบ ตาที่มีแบบใดแบบหนึ่งที่เลือกก็ผ่าน · ไม่เลือกเลย = ไม่จำกัด
          </p>
          <div className="eq-study-checks">
            {LABELS.map((label) => (
              <label key={label} className="eq-study-check">
                <input
                  type="checkbox"
                  checked={best.moveTypes.includes(label)}
                  onChange={() => toggleLabel(label)}
                />
                <b>{MOVE_LABEL_TEXT[label].name}</b>
                <small>{MOVE_LABEL_TEXT[label].hint}</small>
              </label>
            ))}
          </div>
          {best.moveTypes.includes("HOOK") && (
            <p className="eq-study-muted">
              HOOK หายาก อาจใช้เวลาหลายนาทีต่อข้อ ดูตัวนับระหว่างค้นหา
            </p>
          )}
        </fieldset>
        <fieldset className="eq-study-fieldset">
          <legend>EXTEND ด้านที่ต่อ (ไม่เลือก = ทุกแบบ)</legend>
          <div className="eq-study-checks">
            {(
              [
                ["HEAD_ONLY", "ต่อหัวอย่างเดียว"],
                ["TAIL_ONLY", "ต่อท้ายอย่างเดียว"],
                ["BOTH", "ต่อทั้งหัวและท้าย"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="eq-study-check">
                <input
                  type="checkbox"
                  checked={extension.shapes.includes(key)}
                  onChange={() =>
                    setExtension({
                      shapes: extension.shapes.includes(key)
                        ? extension.shapes.filter((shape) => shape !== key)
                        : [...extension.shapes, key],
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <p className="eq-study-muted">
            คู่สัมผัสเรียงเป็น (เบี้ยเดิมที่ขอบ, เบี้ยใหม่ที่ติดกัน) · เครื่องหมายคำนวณ + − × ÷
            แยกจาก =
          </p>
          <ContactPicker
            label="สัมผัสด้านหัว"
            value={extension.headContacts}
            onChange={(headContacts) => setExtension({ headContacts })}
          />
          <ContactPicker
            label="สัมผัสด้านท้าย"
            value={extension.tailContacts}
            onChange={(tailContacts) => setExtension({ tailContacts })}
          />
        </fieldset>
      </ConfigSection>

      <ConfigSection title="4. สมการที่เกิดขึ้น">
        <div className="eq-field">
          <label htmlFor="study-equation-scope">ขอบเขตสมการ</label>
          <select
            id="study-equation-scope"
            value={equation.scope}
            onChange={(event) =>
              setEquation({ scope: event.target.value as typeof equation.scope })
            }
          >
            <option value="MAIN">สมการหลัก (MAIN)</option>
            <option value="ANY">สมการใดสมการหนึ่ง (ANY)</option>
            <option value="ALL">ทุกสมการ (ALL)</option>
          </select>
          <small>ANY หมายถึงสมการเดียวที่ตรงทุกข้อที่เลือก</small>
        </div>
        <div className="eq-study-form-grid">
          <RangeField
            label="จำนวนเบี้ยในสมการ"
            value={equation.tiles}
            min={2}
            max={15}
            onChange={(tiles) => setEquation({ tiles })}
          />
          <RangeField
            label="เบี้ยเดิมที่ใช้ในสมการ"
            value={equation.reusedBoardTiles}
            min={0}
            max={15}
            onChange={(reusedBoardTiles) => setEquation({ reusedBoardTiles })}
          />
          <RangeField
            label="เบี้ยใหม่ที่ร่วมในสมการ"
            value={equation.placedParticipating}
            min={0}
            max={8}
            onChange={(placedParticipating) => setEquation({ placedParticipating })}
          />
        </div>
        <fieldset className="eq-study-fieldset">
          <legend>คุณสมบัติทางคณิตศาสตร์ (เลือกได้หลายข้อ)</legend>
          <div className="eq-study-checks">
            {PROPERTIES.map(({ key, label }) => (
              <label key={key} className="eq-study-check">
                <input
                  type="checkbox"
                  checked={equation.properties.includes(key)}
                  onChange={() =>
                    setEquation({
                      properties: equation.properties.includes(key)
                        ? equation.properties.filter((property) => property !== key)
                        : [...equation.properties, key],
                    })
                  }
                />
                {label}
              </label>
            ))}
          </div>
          {equation.properties.includes("LARGE_INTEGER_RESULT") && (
            <NumberField
              label="ผลจำนวนเต็มมากกว่า (ค่าสัมบูรณ์)"
              value={equation.largeIntegerThreshold}
              min={0}
              max={Number.MAX_SAFE_INTEGER}
              onChange={(largeIntegerThreshold) => setEquation({ largeIntegerThreshold })}
            />
          )}
        </fieldset>
        <div className="eq-study-form-grid">
          <div className="eq-field">
            <span id="study-content-label">เนื้อหาสมการแบบเดิม</span>
            <SelectControl<ContentFilter>
              id="study-content"
              ariaLabelledBy="study-content-label"
              value={best.content}
              options={CONTENTS.map((content) => ({
                value: content,
                label: CONTENT_TEXT[content],
              }))}
              onChange={(content) => content && setBest({ content })}
            />
          </div>
          <label className="eq-study-check eq-study-check-inline">
            <input
              type="checkbox"
              checked={best.excludeTrivialZero}
              onChange={(event) => setBest({ excludeTrivialZero: event.target.checked })}
            />
            <span>ไม่เอาสมการคูณ/หารศูนย์แบบง่าย</span>
          </label>
        </div>
      </ConfigSection>

      <ConfigSection title="5. ความติดขัดของมือ">
        <RangeField
          label="จำนวนตาที่สามารถลงได้"
          value={mobility.legalPlacements}
          min={0}
          max={1000000}
          hint="นับเฉพาะการลงเบี้ยที่ถูกกติกา ไม่รวมผ่านหรือแลก"
          onChange={(legalPlacements) => onChange({ ...config, mobility: { legalPlacements } })}
        />
        <div className="eq-field">
          <span id="study-rack-label">ดัชนีเบี้ยติดขัดแบบเดิม (สำหรับชุดเก่า)</span>
          <SelectControl<string>
            id="study-rack"
            ariaLabelledBy="study-rack-label"
            value={rack.minDifficulty === null ? "any" : String(rack.minDifficulty)}
            options={[
              { value: "any", label: "ไม่จำกัด" },
              ...[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
            ]}
            onChange={(value) =>
              value && setRack({ minDifficulty: value === "any" ? null : Number(value) })
            }
          />
        </div>
      </ConfigSection>

      <ConfigSection title="6. เงื่อนไขทั่วไป · แต้ม · ความชัดของคำตอบ">
        <div className="eq-study-form-grid">
          <RangeField
            label="แต้มของตาที่ดีที่สุด"
            min={0}
            max={999}
            value={best.score}
            onChange={(score) => setBest({ score })}
          />
          <NumberField
            label="คำตอบที่ค่าใกล้กันได้สูงสุด"
            hint="ตาที่ค่าประเมินห่างจากอันดับหนึ่งไม่เกิน 0.5"
            min={1}
            max={12}
            value={config.answer.maxNear}
            onChange={(maxNear) => onChange({ ...config, answer: { maxNear } })}
          />
          <RangeField
            label="จำนวนเบี้ยบนกระดาน"
            min={0}
            max={100}
            value={config.position.boardTiles}
            onChange={(boardTiles) => onChange({ ...config, position: { boardTiles } })}
          />
          <NumberField
            label="โจทย์ต่อหนึ่งเกมสูงสุด"
            min={1}
            max={5}
            value={config.maxPerGame}
            onChange={(maxPerGame) => onChange({ ...config, maxPerGame })}
          />
          <NumberField
            label="เล่นเกมพร้อมกัน"
            min={1}
            max={4}
            value={config.parallelGames}
            onChange={(parallelGames) => onChange({ ...config, parallelGames })}
          />
          <div className="eq-field">
            <span id="study-seed-label">เลขสุ่ม</span>
            <div className="eq-study-seed">
              <input
                aria-labelledby="study-seed-label"
                type="number"
                inputMode="numeric"
                min={0}
                max={2147483647}
                value={Number.isNaN(config.seed) ? "" : config.seed}
                onChange={(event) => onChange({ ...config, seed: event.target.valueAsNumber })}
                required
              />
              <button
                className="eq-button eq-button-secondary"
                type="button"
                aria-label="สุ่มเลขใหม่"
                title="สุ่มเลขใหม่"
                onClick={() => onChange({ ...config, seed: randomSeed() })}
              >
                <Dices aria-hidden size={16} />
              </button>
            </div>
            <small>เลขเดิมกับเงื่อนไขเดิมได้ชุดเดิม</small>
          </div>
        </div>
      </ConfigSection>

      <section className="eq-study-spec-summary" aria-label="สรุปเงื่อนไขก่อนค้นหา">
        <strong>สรุปเงื่อนไขก่อนค้นหา</strong>
        <p>Rack: {rackSummary}</p>
        <p>ตาที่ดีที่สุด: {bestSummary}</p>
        <p>รูปแบบการลง: {geometrySummary}</p>
        <p>สมการ: {equationSummary}</p>
        <p>ความติดขัดของมือ: {formatRange("จำนวนตาที่ลงได้", mobility.legalPlacements)}</p>
        <p>
          ทั่วไป: {formatRange("แต้ม", best.score)} · ตาที่ค่าใกล้กันไม่เกิน {config.answer.maxNear}
        </p>
      </section>
      {problems.length > 0 && (
        <div className="eq-alert eq-alert-error" role="alert">
          {problems.map((problem) => (
            <p key={problem}>{problem}</p>
          ))}
        </div>
      )}

      <div className="eq-study-form-footer">
        <p className="eq-study-muted">
          กระดานมาจากเกม self-play จริง ชุดเบี้ยเป็นไปได้ตามจำนวนเบี้ยที่เหลือ เฉลยคือตาที่ Stage 5B
          ให้ค่าสูงสุด ตรวจแต้มตรงกันทั้ง Stage 5B, EQ-Lab และตัวตรวจ C++
        </p>
        <button
          className="eq-button eq-button-primary"
          type="submit"
          disabled={!canGenerate || problems.length > 0}
        >
          <Search aria-hidden size={16} /> เริ่มค้นหา
        </button>
      </div>
    </form>
  );
}
