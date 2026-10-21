export function MetricCard({
  label,
  value,
  detail,
  href,
  accent = false,
}: {
  label: string;
  value: number;
  detail: string;
  href: string;
  accent?: boolean;
}) {
  return (
    <li className={`metric-card${accent ? ' metric-card-accent' : ''}`}>
      <a href={href}>
        <span className="metric-label">{label}</span>
        <strong className="metric-value" data-motion-value="">
          {value}
        </strong>
        <span className="metric-detail">
          {detail}
          <span aria-hidden="true">↗</span>
        </span>
      </a>
    </li>
  );
}
