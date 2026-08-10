import type { DensityBin } from "../../botStats";

// A compact histogram of the bot's per-game score. Bars are drawn as inline SVG
// so it needs no chart library and inherits the panel's theme via currentColor.
export function ScoreDensityChart({ bins, mean }: { bins: DensityBin[]; mean: number }) {
  if (bins.length === 0) {
    return <p className="bstat-empty">No games recorded yet.</p>;
  }

  const width = 520;
  const height = 180;
  const padL = 8;
  const padR = 8;
  const padTop = 14;
  const padBottom = 26;
  const plotW = width - padL - padR;
  const plotH = height - padTop - padBottom;

  const maxCount = Math.max(...bins.map((b) => b.count), 1);
  const min = bins[0].from;
  const max = bins[bins.length - 1].to;
  const span = Math.max(max - min, 1);
  const gap = bins.length > 1 ? 3 : 0;
  const slot = plotW / bins.length;
  const barW = Math.max(slot - gap, 2);

  // Where the mean falls along the x axis (for the dashed marker line).
  const meanX = padL + ((mean - min) / span) * plotW;

  return (
    <div className="bstat-chart">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Distribution of the bot's score across games"
        preserveAspectRatio="none"
      >
        {/* baseline */}
        <line
          x1={padL}
          y1={padTop + plotH}
          x2={width - padR}
          y2={padTop + plotH}
          className="bstat-chart-axis"
        />
        {bins.map((bin, i) => {
          const h = (bin.count / maxCount) * plotH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = padTop + plotH - h;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(h, bin.count > 0 ? 2 : 0)}
                rx={2}
                className="bstat-chart-bar"
              />
              {bin.count > 0 && (
                <text x={x + barW / 2} y={y - 4} className="bstat-chart-count">
                  {bin.count}
                </text>
              )}
            </g>
          );
        })}
        {/* mean marker */}
        {mean >= min && mean <= max && (
          <line
            x1={meanX}
            y1={padTop - 6}
            x2={meanX}
            y2={padTop + plotH}
            className="bstat-chart-mean"
          />
        )}
        {/* x-axis end labels */}
        <text x={padL} y={height - 8} className="bstat-chart-tick" textAnchor="start">
          {min}
        </text>
        <text x={width - padR} y={height - 8} className="bstat-chart-tick" textAnchor="end">
          {max}
        </text>
      </svg>
      <div className="bstat-chart-legend">
        <span className="bstat-chart-legend-item">
          <span className="bstat-swatch bstat-swatch-bar" /> games at score
        </span>
        <span className="bstat-chart-legend-item">
          <span className="bstat-swatch bstat-swatch-mean" /> average ({mean.toFixed(1)})
        </span>
      </div>
    </div>
  );
}
