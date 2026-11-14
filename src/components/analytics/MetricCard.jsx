/**
 * Reusable stat card for displaying key metrics with an icon, badge, and helper description.
 */
export function MetricCard({
  title,
  value,
  subtitle = null,
  badge = null,
  badgeType = 'default',
  icon = null,
  accentColor = null,
}) {
  return (
    <article className="fc-stat-card fc-analytics-metric-card">
      <div className="fc-metric-card-header">
        <span className="fc-stat-label">{title}</span>
        {icon ? (
          <span
            className="fc-metric-icon"
            style={accentColor ? { color: accentColor } : undefined}
            aria-hidden="true"
          >
            {icon}
          </span>
        ) : null}
      </div>

      <div className="fc-metric-card-body">
        <span className="fc-stat-value fc-metric-value">{value}</span>
        {badge ? (
          <span className={`fc-metric-badge fc-metric-badge-${badgeType}`}>
            {badge}
          </span>
        ) : null}
      </div>

      {subtitle ? <p className="fc-metric-subtitle">{subtitle}</p> : null}
    </article>
  );
}

