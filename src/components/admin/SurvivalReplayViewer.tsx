import { useState } from "react";
import reference from "../../features/survival/reference-endgame.json";
import type { SurvivalLevel } from "../../features/survival/repository";

type Replay = SurvivalLevel["winning_replays"][number];

function actionLabel(action: Replay["actions"][number]): string {
  if (action.type === "pass") return "ผ่าน";
  if (action.type === "exchange") return `แลก ${action.move.kinds?.join(" ") ?? "เบี้ย"}`;
  const placements = action.move.placements ?? [];
  return placements
    .map(
      ({ cell, face }) =>
        `${face}@${String.fromCharCode(65 + (cell % 15))}${Math.floor(cell / 15) + 1}`,
    )
    .join(" ");
}

export function SurvivalReplayViewer({ replay }: { replay: Replay }) {
  const [step, setStep] = useState(0);
  const board = reference.board.map((tile) => tile?.face ?? "");
  const current = Math.min(step, replay.actions.length);
  for (const action of replay.actions.slice(0, current)) {
    if (action.type !== "place") continue;
    for (const placement of action.move.placements ?? []) {
      board[placement.cell] = placement.face;
    }
  }
  const action = replay.actions[current - 1];
  const placed = new Set(action?.move.placements?.map((placement) => placement.cell));
  return (
    <div className="eq-survival-replay">
      <p>
        {replay.policy} · เกมตัวอย่าง {replay.trial + 1} · จบ {replay.scores.A}–{replay.scores.B}
      </p>
      <div className="eq-page-actions">
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={current === 0}
          onClick={() => setStep(current - 1)}
        >
          ตาก่อน
        </button>
        <span className="eq-survival-replay-step">
          ตา {current}/{replay.actions.length}
        </span>
        <button
          type="button"
          className="eq-button eq-button-secondary"
          disabled={current === replay.actions.length}
          onClick={() => setStep(current + 1)}
        >
          ตาถัดไป
        </button>
      </div>
      <p aria-live="polite">
        {action
          ? `${action.side === "A" ? "ผู้เล่น" : "Authur"}: ${actionLabel(action)} · +${action.score}`
          : "ตำแหน่งเริ่มต้น"}
      </p>
      <div className="eq-survival-board" aria-label="กระดาน replay">
        {board.map((face, cell) => (
          <span
            key={cell}
            className={`eq-survival-cell${placed.has(cell) ? " is-new" : ""}`}
            title={`${String.fromCharCode(65 + (cell % 15))}${Math.floor(cell / 15) + 1}`}
          >
            {face}
          </span>
        ))}
      </div>
    </div>
  );
}
