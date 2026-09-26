import { memo } from "react";
import type { DrawEdit, TileInstance } from "../../game";
import { candidateCounts, type DrawEditWindow } from "../../gameplay/drawEdit";
import { Tile } from "../board/Tile";

/**
 * What a host may deal into the focused slot, shown only on the host's own screen while
 * re-dealing is on (⌥R). It lists the bag as it stood at the draw — never the opponent's rack,
 * which is not a tile the draw could have produced.
 */
export const DrawEditPanel = memo(function DrawEditPanel({
  drawWindow,
  edits,
  focus,
  playerName,
  slots,
}: {
  drawWindow: DrawEditWindow;
  edits: DrawEdit[];
  focus: number;
  playerName: string;
  slots: (TileInstance | null)[];
}) {
  const focused = slots[focus] ?? null;
  const editable = focused !== null && drawWindow.drawnIds.has(focused.id);
  const original = focused ? edits.find((edit) => edit.toId === focused.id) : undefined;
  const counts = candidateCounts(drawWindow);

  return (
    <aside className="draw-edit-panel" aria-label="แก้เบี้ยที่หยิบ">
      <header>
        <strong>แก้เบี้ยที่หยิบ · {playerName}</strong>
        <span>เห็นเฉพาะ host</span>
      </header>
      <p className="draw-edit-focus">
        ช่อง {focus + 1}:{" "}
        {!focused ? (
          "ว่าง"
        ) : editable ? (
          <>
            <b>{focused.token}</b>
            {original ? ` (เดิม ${original.from})` : " (แอปหยิบมา)"}
          </>
        ) : (
          <>
            <b>{focused.token}</b> อยู่ในมือก่อนการหยิบ · แก้ไม่ได้
          </>
        )}
      </p>
      <div className="draw-edit-candidates" aria-label="เบี้ยที่กำหนดได้">
        {counts.length === 0 ? (
          <span className="draw-edit-empty">ไม่มีเบี้ยในถุงให้เลือก</span>
        ) : (
          counts.map(({ token, count }) => (
            <span className="draw-edit-chip" key={token}>
              <Tile compact tile={{ id: `candidate-${token}`, token }} />
              <small>×{count}</small>
            </span>
          ))
        )}
      </div>
      {edits.length > 0 && (
        <p className="draw-edit-log">
          แก้แล้ว: {edits.map((edit) => `${edit.from}→${edit.to}`).join(" · ")}
        </p>
      )}
      <p className="draw-edit-keys">
        ←→ / Space เลือกช่อง · พิมพ์เบี้ย (1 แล้ว 8 = 18, ⇧ตัวเลข = 10–19, T = 20, P M X D, = ,
        B = blank) · ⌫ คืนเบี้ยเดิม · ⌥R / Esc ออก
      </p>
    </aside>
  );
});
