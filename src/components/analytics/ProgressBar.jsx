/**
 * Accessible visual progress bar supporting single percentage and multi-segment stacked modes.
 */
export function ProgressBar({
  value = 0,
  label = null,
  helperText = null,
  segments = null,
  height = 8,
}) {
  const safePct = Math.min(100, Math.max(0, Number(value) || 0));

  return (
    <div className="fc-progress-container" aria-label={label || 'Progress'}>
      {label || helperText ? (
        <div className="fc-progress-meta">
          {label ? <span className="fc-progress-label">{label}</span> : null}
          {helperText ? (
            <span className="fc-progress-helper">{helperText}</span>
          ) : null}
        </div>
      ) : null}

      <div
        className="fc-progress-track"
        style={{ height: `${height}px` }}
        role="progressbar"
        aria-valuenow={safePct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.isArray(segments) && segments.length > 0 ? (
          segments.map((seg, idx) => {
            const segPct = Math.min(100, Math.max(0, Number(seg.pct) || 0));
            if (segPct <= 0) return null;
            return (
              <div
                key={seg.label || idx}
                className="fc-progress-segment"
                style={{
                  width: `${segPct}%`,
                  backgroundColor: seg.color || 'var(--fc-accent)',
                }}
                title={`${seg.label || ''}: ${seg.value ?? ''} (${segPct.toFixed(1)}%)`}
              />
            );
          })
        ) : (
          <div
            className="fc-progress-fill"
            style={{ width: `${safePct}%` }}
          />
        )}
      </div>

      {Array.isArray(segments) && segments.length > 0 ? (
        <div className="fc-progress-legend">
          {segments.map((seg, idx) => (
            <div key={seg.label || idx} className="fc-progress-legend-item">
              <span
                className="fc-progress-legend-dot"
                style={{ backgroundColor: seg.color || 'var(--fc-accent)' }}
                aria-hidden="true"
              />
              <span className="fc-progress-legend-label">
                {seg.label} ({seg.value ?? `${seg.pct.toFixed(1)}%`})
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

