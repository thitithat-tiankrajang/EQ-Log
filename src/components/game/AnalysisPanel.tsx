// The panel that took the Live View's place.
//
// "Live View" drew the position that is already on the board, under a heading that said so.
// The log panel's `Live | Last turn` tag says the same thing in four words and costs no space,
// so the dock was showing a spectator what they were already looking at — and it was sitting in
// the one part of the layout tall enough to hold a real tool.
//
// It is kept for board-analysis tools. Branching used to be drawn here and moved to the turn log
// and its map, where the turns already are: this panel is empty until those tools arrive, and
// each should stand on its own, because a panel of tools that only works when all of them are
// present is a panel nobody can add to.
export function AnalysisPanel() {
  return (
    <div className="analysis-panel is-empty">
      <p className="analysis-empty">เครื่องมือวิเคราะห์กระดานจะมาอยู่ที่นี่</p>
    </div>
  );
}
