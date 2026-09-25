// Words the Study puzzle admin shows for the generator's codes.
import type {
  ContentFilter,
  HookSubtype,
  MoveLabel,
  SetStatus,
  TileCategory,
  PuzzleOrigin,
} from "../../features/studyPuzzles/api";

export const ORIGIN_TEXT: Record<PuzzleOrigin, string> = {
  AUTHENTIC_SEEDED: "แจกตาม seed",
  CONFIG_GUIDED_RACK: "จัดชุดเบี้ยเพื่อค้นหาโจทย์",
};

export const VERIFY_TEXT: Record<string, string> = {
  sourceReplay: "เล่นซ้ำเกมต้นทาง",
  sourceState: "กระดานและสถานะต้นทาง",
  rackLegal: "ชุดเบี้ยอยู่ในจำนวนที่มีจริง",
  tileConservation: "เบี้ยครบ 100 ตัว",
  positionHash: "ตำแหน่งโจทย์ตรงกับ hash",
  puzzleHash: "บันทึกโจทย์และเฉลยไม่เปลี่ยน",
  stage5b: "ตาอันดับ 1 ของ Stage 5B",
  analysis: "รายละเอียดรูปแบบและสมการจากกติกา",
  eqlab: "ตัวตรวจ EQ-Lab",
  amathCli: "ตัวตรวจ C++",
};

export const MOVE_LABEL_TEXT: Record<MoveLabel, { name: string; hint: string }> = {
  EXTEND: { name: "EXTEND · ต่อ", hint: "ต่อสมการที่มีอยู่บนแถวเดียวกันที่หัวหรือท้าย" },
  CROSS: { name: "CROSS · ไขว้", hint: "แถวใหม่ลากผ่านเบี้ยบนกระดานที่อยู่แนวตั้งฉาก" },
  HOOK: { name: "HOOK · ฮุก", hint: "เบี้ยใหม่ไปเติมหัว/ท้าย/เชื่อมสมการเดิม ได้แต้มอีกสมการ" },
};

export const HOOK_TEXT: Record<HookSubtype, string> = {
  HEAD: "เติมหัว",
  TAIL: "เติมท้าย",
  JOIN: "เชื่อมสองชิ้น",
};

export const CATEGORY_TEXT: Record<TileCategory, { name: string; symbol: string }> = {
  digit: { name: "เลข 0–9", symbol: "N" },
  heavy: { name: "เลข 10–20", symbol: "H" },
  operator: { name: "+ − × ÷", symbol: "O" },
  choice: { name: "เบี้ยสองหน้า (+/− ×/÷)", symbol: "O" },
  equals: { name: "เบี้ย =", symbol: "=" },
  blank: { name: "เบี้ยว่าง", symbol: "?" },
};

export const CONTENT_TEXT: Record<ContentFilter, string> = {
  any: "ไม่จำกัด",
  arithmetic: "คำนวณหลายขั้น",
  fraction: "หารแล้วได้เศษส่วน",
  "fraction-sum": "บวกลบเศษส่วน",
  large: "มีเลขหลักร้อย",
};

export const STATUS_TEXT: Record<SetStatus, string> = {
  running: "กำลังสร้าง",
  complete: "ครบ",
  stopped: "หยุดแล้ว (เก็บข้อที่ได้)",
  failed: "ล้มเหลว",
  interrupted: "ถูกตัดกลางทาง",
};

const REASONS: Record<string, string> = {
  "geometry.noPlacement": "พื้นที่ไม่พอสำหรับจำนวนเบี้ยที่ต้องลง",
  "geometry.moveType": "โครงสร้างกระดานไม่รองรับประเภทที่เลือก",
  "geometry.equations": "โครงสร้างกระดานไม่รองรับจำนวนสมการ",
  "geometry.equationTiles": "กระดานไม่มีตำแหน่งที่รองรับจำนวนเบี้ยในสมการ",
  "rack.authenticComposition": "ชุดเบี้ยจริงมีชนิดเบี้ยไม่พอตามเงื่อนไข",
  "rack.noMatchingLegalMove": "ไม่มีตาที่ถูกกติกาตรงเงื่อนไขสำหรับชุดเบี้ยนี้",
  "position.opening": "กระดานว่าง (ตาแรก)",
  "position.boardTiles": "จำนวนเบี้ยบนกระดานไม่อยู่ในช่วง",
  "position.inconsistent": "Study ถามตำแหน่งนี้แบบเดียวกันไม่ได้",
  "bestPlay.notPlacement": "ตาที่ดีที่สุดคือแลก/ผ่าน",
  "rules.eqlabRefused": "EQ-Lab ไม่ยอมรับตาของ engine",
  "rules.scoreMismatch": "แต้มไม่ตรงกันระหว่างตัวตรวจ",
  "rules.validatorDisagreed": "ตัวตรวจ C++ ไม่ยอมรับ",
  "provenance.replayFailed": "เล่นซ้ำจากบันทึกไม่ได้",
  "bestPlay.score": "แต้มไม่อยู่ในช่วง",
  "bestPlay.tiles": "จำนวนเบี้ยที่ลงไม่อยู่ในช่วง",
  "bestPlay.equations": "จำนวนสมการที่ได้แต้มไม่อยู่ในช่วง",
  "bestPlay.moveType": "ประเภทการลงไม่ตรง",
  "bestPlay.content": "เนื้อหาสมการไม่ตรง",
  "rack.size": "จำนวนเบี้ยในมือไม่อยู่ในช่วง",
  "geometry.expectedExtend": "ต้องเป็น EXTEND",
  "geometry.extend.headContact": "คู่สัมผัสด้านหัวไม่ตรง",
  "geometry.extend.tailContact": "คู่สัมผัสด้านท้ายไม่ตรง",
  "equation.tiles": "จำนวนเบี้ยในสมการไม่ตรง",
  "equation.reusedBoardTiles": "จำนวนเบี้ยเดิมในสมการไม่ตรง",
  "equation.placedParticipating": "จำนวนเบี้ยใหม่ในสมการไม่ตรง",
  "equation.scope": "ไม่มีสมการเดียวที่ตรงทุกเงื่อนไข",
  "mobility.tooManyLegalPlacements": "มีตาที่ลงได้มากเกินไป",
  "mobility.tooFewLegalPlacements": "มีตาที่ลงได้น้อยเกินไป",
  "mobility.countUnavailable": "นับจำนวนตาที่ลงได้ไม่ครบ",
  "bestPlay.trivialZero": "คูณ/หารศูนย์แบบง่ายเกินไป",
  "answer.maxNear": "มีตาที่ค่าใกล้กันมากเกินไป",
  "rack.minDifficulty": "เบี้ยในมือไม่ติดขัดพอ",
  duplicate: "ตำแหน่งซ้ำกับข้อที่มีแล้ว",
  perGameLimit: "เกินจำนวนโจทย์ต่อเกม",
};

export function reasonText(code: string): string {
  if (code in REASONS) return REASONS[code]!;
  if (code.startsWith("rack.group.")) return `Rack: กลุ่ม ${code.slice(11)} ไม่อยู่ในช่วง`;
  if (code.startsWith("rack.specific.")) return `Rack: เบี้ย ${code.slice(14)} ไม่อยู่ในช่วง`;
  if (code.startsWith("bestPlay.group."))
    return `ตาที่ดีที่สุด: กลุ่ม ${code.slice(15)} ไม่อยู่ในช่วง`;
  if (code.startsWith("bestPlay.specific."))
    return `ตาที่ดีที่สุด: เบี้ย ${code.slice(18)} ไม่อยู่ในช่วง`;
  if (code.startsWith("geometry.extend.expected."))
    return `รูปแบบ EXTEND ต้องเป็น ${code.slice("geometry.extend.expected.".length)}`;
  if (code.startsWith("equation.property.")) return `สมการไม่ตรงคุณสมบัติ ${code.slice(18)}`;
  const category = /^bestPlay\.composition\.(\w+)$/.exec(code)?.[1] as TileCategory | undefined;
  if (category && category in CATEGORY_TEXT)
    return `${CATEGORY_TEXT[category].name}: จำนวนไม่อยู่ในช่วง`;
  return REASONS[code] ?? code;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} วิ`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60
    ? `${minutes} นาที ${seconds % 60} วิ`
    : `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที`;
}
