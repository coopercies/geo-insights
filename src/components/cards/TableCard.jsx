import { useMemo, useState } from 'react';
import { useStore, useFilteredRows } from '../../store.js';
import { formatValue } from '../../lib/stats.js';
import { toNumber } from '../../lib/fields.js';

const PAGE = 200;

export default function TableCard({ card }) {
  const { dataset, rows, filtered } = useFilteredRows(card);
  const select = useStore((s) => s.select);
  const [sort, setSort] = useState(null);

  const columns = useMemo(() => {
    if (!dataset) return [];
    const chosen = card.config.columns;
    if (chosen && chosen.length) return chosen;
    return dataset.fields.slice(0, 8).map((f) => f.name);
  }, [dataset, card.config.columns]);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const an = toNumber(a[key]), bn = toNumber(b[key]);
      if (an !== null && bn !== null) return (an - bn) * mult;
      return String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * mult;
    });
  }, [rows, sort]);

  if (!dataset) return <div className="card-empty">No dataset bound to this table.</div>;

  const page = sorted.slice(0, PAGE);

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} onClick={() => setSort((s) =>
                s && s.key === c ? { key: c, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c, dir: 'asc' }
              )}>
                {c}
                {sort && sort.key === c && <span className="sort-arrow">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {page.map((r) => (
            <tr key={r.__i} onClick={() => select(card.id, dataset.id, [r.__i], `row ${r.__i}`)}>
              {columns.map((c) => {
                const n = toNumber(r[c]);
                return (
                  <td key={c} className={n !== null ? 'num' : ''}>
                    {n !== null ? formatValue(n) : String(r[c] ?? '')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="table-foot">
        {sorted.length > PAGE
          ? `showing ${PAGE.toLocaleString()} of ${sorted.length.toLocaleString()} rows`
          : `${sorted.length.toLocaleString()} rows`}
        {filtered && ' · filtered to selection'}
      </div>
    </div>
  );
}
