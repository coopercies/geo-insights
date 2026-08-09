import { useMemo } from 'react';
import { useStore, useFilteredRows } from '../../store.js';
import { computeStat, formatValue, STATS } from '../../lib/stats.js';

export default function StatCard({ card }) {
  const { dataset, rows, allRows, filtered } = useFilteredRows(card);
  const { stat, field, label } = card.config;

  const value = useMemo(
    () => (dataset ? computeStat(rows, field, stat) : null),
    [dataset, rows, field, stat]
  );
  // The share-of-total line is what makes a selection legible: "12 of 480".
  const total = useMemo(
    () => (dataset && filtered ? computeStat(allRows, field, stat) : null),
    [dataset, allRows, field, stat, filtered]
  );

  if (!dataset) return <div className="card-empty">No dataset bound to this statistic.</div>;

  const statLabel = STATS.find((s) => s.key === stat)?.label ?? stat;
  const caption = label || (stat === 'count' ? `${statLabel} of features` : `${statLabel} of ${field ?? '—'}`);
  const pct = filtered && total ? (value / total) * 100 : null;

  return (
    <div className="stat-card">
      <div className="stat-caption">{caption}</div>
      <div className="stat-value">{formatValue(value)}</div>
      {filtered ? (
        <div className="stat-sub">
          of {formatValue(total)} total
          {pct !== null && Number.isFinite(pct) && <span className="stat-pct"> · {pct.toFixed(1)}%</span>}
        </div>
      ) : (
        <div className="stat-sub stat-sub-quiet">all {allRows.length.toLocaleString()} rows</div>
      )}
    </div>
  );
}
