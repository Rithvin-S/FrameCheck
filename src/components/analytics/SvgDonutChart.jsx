import { useMemo } from 'react';

/**
 * Lightweight, dependency-free SVG Donut Chart with center label and legend.
 */
export function SvgDonutChart({
  data = [],
  size = 180,
  strokeWidth = 24,
  centerTitle = '',
  centerSubtitle = '',
  emptyLabel = 'No data',
}) {
  const radius = (size - strokeWidth) / 2;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const { total, segments } = useMemo(() => {
    const validData = Array.isArray(data) ? data : [];
    const sum = validData.reduce((acc, item) => acc + (Math.max(0, Number(item.value)) || 0), 0);

    let cumulativeOffset = 0;
    const computedSegments = validData.map((item) => {
      const val = Math.max(0, Number(item.value)) || 0;
      const pct = sum > 0 ? val / sum : 0;
      const strokeDasharray = `${pct * circumference} ${circumference}`;
      const strokeDashoffset = -cumulativeOffset;
      cumulativeOffset += pct * circumference;

      return {
        ...item,
        value: val,
        pct: (pct * 100).toFixed(1),
        strokeDasharray,
        strokeDashoffset,
      };
    });

    return { total: sum, segments: computedSegments };
  }, [circumference, data]);

  return (
    <div className="fc-donut-wrapper">
      <div className="fc-donut-visual" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="fc-donut-svg"
        >
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--fc-bg-subtle)"
            strokeWidth={strokeWidth}
          />

          {/* Slices */}
          {total > 0
            ? segments.map((seg, idx) => (
                <circle
                  key={seg.label || idx}
                  cx={center}
                  cy={center}
                  r={radius}
                  fill="none"
                  stroke={seg.color || 'var(--fc-accent)'}
                  strokeWidth={strokeWidth}
                  strokeDasharray={seg.strokeDasharray}
                  strokeDashoffset={seg.strokeDashoffset}
                  strokeLinecap="butt"
                  transform={`rotate(-90 ${center} ${center})`}
                  className="fc-donut-slice"
                />
              ))
            : null}
        </svg>

        {/* Center overlay label */}
        <div className="fc-donut-center">
          {total > 0 ? (
            <>
              <span className="fc-donut-center-title">
                {centerTitle || total}
              </span>
              {centerSubtitle ? (
                <span className="fc-donut-center-subtitle">
                  {centerSubtitle}
                </span>
              ) : null}
            </>
          ) : (
            <span className="fc-donut-center-empty">{emptyLabel}</span>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="fc-donut-legend">
        {segments.map((seg, idx) => (
          <div key={seg.label || idx} className="fc-donut-legend-row">
            <span
              className="fc-donut-legend-dot"
              style={{ backgroundColor: seg.color || 'var(--fc-accent)' }}
              aria-hidden="true"
            />
            <span className="fc-donut-legend-name">{seg.label}</span>
            <span className="fc-donut-legend-value">
              {seg.value}{' '}
              <span className="fc-donut-legend-pct">({seg.pct}%)</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

