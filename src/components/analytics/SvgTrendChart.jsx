import { useMemo, useState } from 'react';

const SERIES_CONFIG = [
  {
    key: 'annotations_created',
    label: 'Annotations Created',
    color: '#2563eb', // --fc-accent
  },
  {
    key: 'annotations_resolved',
    label: 'Annotations Resolved (Current)',
    color: '#15803d', // --fc-success
  },
  {
    key: 'images_completed',
    label: 'Images Completed',
    color: '#b45309', // --fc-warning
  },
  {
    key: 'batches_created',
    label: 'Batches Uploaded',
    color: '#9333ea', // purple
  },
];

/**
 * Responsive, zero-dependency SVG trend chart for 30-day daily review activity.
 */
export function SvgTrendChart({ data = [], height = 240 }) {
  const [activeSeriesKey, setActiveSeriesKey] = useState('all');
  const [hoveredIndex, setHoveredIndex] = useState(null);

  const chartPoints = useMemo(() => {
    return Array.isArray(data) ? data : [];
  }, [data]);

  const viewWidth = 680;
  const viewHeight = 200;
  const paddingLeft = 36;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 32;

  const usableWidth = viewWidth - paddingLeft - paddingRight;
  const usableHeight = viewHeight - paddingTop - paddingBottom;

  const { maxVal, seriesData } = useMemo(() => {
    let currentMax = 1;

    SERIES_CONFIG.forEach((series) => {
      chartPoints.forEach((pt) => {
        const val = Number(pt[series.key]) || 0;
        if (val > currentMax) currentMax = val;
      });
    });

    // Round up Y-axis max nicely
    const niceMax = Math.max(5, Math.ceil(currentMax / 5) * 5);

    const count = chartPoints.length;
    const stepX = count > 1 ? usableWidth / (count - 1) : usableWidth;

    const computed = SERIES_CONFIG.map((series) => {
      const coords = chartPoints.map((pt, idx) => {
        const val = Number(pt[series.key]) || 0;
        const x = paddingLeft + idx * stepX;
        const y = paddingTop + usableHeight - (val / niceMax) * usableHeight;
        return { x, y, val };
      });

      const pathData = coords
        .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
        .join(' ');

      const areaData = coords.length > 0
        ? `${pathData} L ${coords[coords.length - 1].x.toFixed(1)} ${(paddingTop + usableHeight).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(paddingTop + usableHeight).toFixed(1)} Z`
        : '';

      return {
        ...series,
        coords,
        pathData,
        areaData,
      };
    });

    return { maxVal: niceMax, seriesData: computed };
  }, [chartPoints, usableHeight, usableWidth]);

  const yTicks = [
    { value: maxVal, y: paddingTop },
    { value: Math.round(maxVal / 2), y: paddingTop + usableHeight / 2 },
    { value: 0, y: paddingTop + usableHeight },
  ];

  // X-axis label points (every ~5 days)
  const xLabels = useMemo(() => {
    if (chartPoints.length === 0) return [];
    const step = Math.max(1, Math.floor(chartPoints.length / 6));
    const labels = [];
    for (let i = 0; i < chartPoints.length; i += step) {
      const stepX = chartPoints.length > 1 ? usableWidth / (chartPoints.length - 1) : 0;
      labels.push({
        label: chartPoints[i].label || chartPoints[i].date,
        x: paddingLeft + i * stepX,
      });
    }
    return labels;
  }, [chartPoints, usableWidth]);

  const visibleSeries = activeSeriesKey === 'all'
    ? seriesData
    : seriesData.filter((s) => s.key === activeSeriesKey);

  const hoveredPoint = hoveredIndex !== null && chartPoints[hoveredIndex]
    ? chartPoints[hoveredIndex]
    : null;

  return (
    <div className="fc-trend-chart-card">
      <div className="fc-trend-header">
        <div className="fc-trend-title-group">
          <h3 className="fc-trend-title">Review Activity Trend (Last 30 Days)</h3>
          <p className="fc-trend-subtitle">
            Daily activity counts derived from actual creation, completion, and current resolution timestamps.
          </p>
        </div>

        <div className="fc-trend-controls" role="group" aria-label="Series filter">
          <button
            type="button"
            className={`fc-btn fc-btn-sm ${activeSeriesKey === 'all' ? 'fc-btn-primary' : 'fc-btn-secondary'}`}
            onClick={() => setActiveSeriesKey('all')}
          >
            All Events
          </button>
          {SERIES_CONFIG.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`fc-btn fc-btn-sm ${activeSeriesKey === s.key ? 'fc-btn-primary' : 'fc-btn-secondary'}`}
              onClick={() => setActiveSeriesKey(s.key)}
            >
              {s.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      <div className="fc-trend-svg-container" style={{ minHeight: `${height}px` }}>
        <svg
          viewBox={`0 0 ${viewWidth} ${viewHeight}`}
          className="fc-trend-svg"
          preserveAspectRatio="none"
          onMouseLeave={() => setHoveredIndex(null)}
        >
          {/* Horizontal Gridlines */}
          {yTicks.map((tick) => (
            <g key={tick.value}>
              <line
                x1={paddingLeft}
                y1={tick.y}
                x2={viewWidth - paddingRight}
                y2={tick.y}
                stroke="var(--fc-border)"
                strokeDasharray="4 4"
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 6}
                y={tick.y + 4}
                textAnchor="end"
                className="fc-trend-tick-label"
              >
                {tick.value}
              </text>
            </g>
          ))}

          {/* Area fills */}
          {visibleSeries.map((s) =>
            s.areaData ? (
              <path
                key={`area-${s.key}`}
                d={s.areaData}
                fill={s.color}
                fillOpacity={activeSeriesKey === 'all' ? 0.05 : 0.12}
                className="fc-trend-area"
              />
            ) : null
          )}

          {/* Lines */}
          {visibleSeries.map((s) =>
            s.pathData ? (
              <path
                key={`line-${s.key}`}
                d={s.pathData}
                fill="none"
                stroke={s.color}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="fc-trend-line"
              />
            ) : null
          )}

          {/* X-axis labels */}
          {xLabels.map((xl, idx) => (
            <text
              key={idx}
              x={xl.x}
              y={viewHeight - 10}
              textAnchor="middle"
              className="fc-trend-tick-label"
            >
              {xl.label}
            </text>
          ))}

          {/* Hover hit targets */}
          {chartPoints.map((_, idx) => {
            const stepX = chartPoints.length > 1 ? usableWidth / (chartPoints.length - 1) : 0;
            const x = paddingLeft + idx * stepX;
            return (
              <rect
                key={idx}
                x={x - stepX / 2}
                y={paddingTop}
                width={stepX}
                height={usableHeight}
                fill="transparent"
                onMouseEnter={() => setHoveredIndex(idx)}
              />
            );
          })}

          {/* Hover guideline */}
          {hoveredIndex !== null ? (() => {
            const stepX = chartPoints.length > 1 ? usableWidth / (chartPoints.length - 1) : 0;
            const x = paddingLeft + hoveredIndex * stepX;
            return (
              <line
                x1={x}
                y1={paddingTop}
                x2={x}
                y2={paddingTop + usableHeight}
                stroke="var(--fc-accent)"
                strokeWidth={1.5}
                strokeDasharray="2 2"
                pointerEvents="none"
              />
            );
          })() : null}
        </svg>
      </div>

      {/* Tooltip summary bar */}
      <div className="fc-trend-footer">
        {hoveredPoint ? (
          <div className="fc-trend-tooltip-row">
            <span className="fc-trend-tooltip-date">
              {hoveredPoint.label} ({hoveredPoint.date}):
            </span>
            <span className="fc-trend-tooltip-item" style={{ color: '#2563eb' }}>
              Created: <strong>{hoveredPoint.annotations_created}</strong>
            </span>
            <span className="fc-trend-tooltip-item" style={{ color: '#15803d' }}>
              Resolved: <strong>{hoveredPoint.annotations_resolved}</strong>
            </span>
            <span className="fc-trend-tooltip-item" style={{ color: '#b45309' }}>
              Completed Imgs: <strong>{hoveredPoint.images_completed}</strong>
            </span>
            <span className="fc-trend-tooltip-item" style={{ color: '#9333ea' }}>
              Batches: <strong>{hoveredPoint.batches_created}</strong>
            </span>
          </div>
        ) : (
          <div className="fc-trend-legend-row">
            {SERIES_CONFIG.map((s) => (
              <span key={s.key} className="fc-trend-legend-pill">
                <span
                  className="fc-trend-legend-dot"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                <span>{s.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

