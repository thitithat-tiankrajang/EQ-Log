import type { MoveValidation } from "../../game";
import { RACK_SIZE } from "../../constants/gameRules";

export function EquationPreview({ validation }: { validation: MoveValidation }) {
  if (validation.equations.length === 0) return null;
  return (
    <div className="equation-preview">
      {validation.equations.map((equation, index) => (
        <div
          className={equation.isValid ? "valid-equation" : "invalid-equation"}
          key={`${equation.direction}-${index}`}
        >
          <span>{equation.expressionText}</span>
          <strong>
            {equation.isValid
              ? `${equation.score} pts${equation.multiplier > 1 ? ` (E x ${equation.multiplier})` : ""}`
              : equation.error}
          </strong>
        </div>
      ))}
      {validation.bingoBonus > 0 && (
        <div className="valid-equation">
          <span>Bingo - all {RACK_SIZE} tiles placed</span>
          <strong>+{validation.bingoBonus} pts</strong>
        </div>
      )}
    </div>
  );
}
