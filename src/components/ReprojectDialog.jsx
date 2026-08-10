import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store.js';
import { detectCrs, tryCandidate, reprojectCollection, haversine, targetFromAttributes } from '../lib/reproject.js';

const fmt = (n) => (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(1));
const coord = ([lon, lat]) => `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;

/**
 * Choosing a source CRS. Nothing is applied without showing where the data
 * lands first — a wrong CRS produces perfectly valid coordinates in the wrong
 * place, so "it worked" is not evidence of anything.
 */
export default function ReprojectDialog({ dataset, onClose }) {
  const datasets = useStore((s) => s.datasets);
  const reprojectDataset = useStore((s) => s.reprojectDataset);
  const setStatus = useStore((s) => s.setStatus);

  const [results, setResults] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [manual, setManual] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [manualTarget, setManualTarget] = useState('');

  // Reference point, best source first: another layer already in lat/lon, then
  // this layer's own degree-valued attribute columns, then somewhere you type.
  const otherLayer = datasets.find((d) => d.id !== dataset.id && d.bbox && !d.projected);
  const fromAttrs = targetFromAttributes(dataset);
  const typed = (() => {
    const m = manualTarget.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { at: [lon, lat], from: 'the location you entered' };
  })();

  const ref = typed
    ? typed
    : otherLayer
      ? {
          at: [(otherLayer.bbox[0] + otherLayer.bbox[2]) / 2, (otherLayer.bbox[1] + otherLayer.bbox[3]) / 2],
          from: `“${otherLayer.name}”`,
        }
      : fromAttrs;
  const target = ref ? ref.at : null;

  useEffect(() => {
    let live = true;
    detectCrs(dataset.rawBbox, target)
      .then((list) => { if (live) { setResults(list); setChosen(list[0] ?? null); } })
      .catch((err) => { if (live) { setError(err.message); setResults([]); } });
    return () => { live = false; };
  }, [dataset.id, target && target.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const test = async () => {
    const code = Number(manual.replace(/[^0-9]/g, ''));
    if (!code) return setError('Enter an EPSG code, for example 2229.');
    setBusy(true);
    setError(null);
    try {
      const hit = await tryCandidate(code, dataset.rawBbox);
      if (!hit) throw new Error(`EPSG:${code} does not produce valid coordinates for this data.`);
      const entry = { ...hit, label: `EPSG:${code}`, km: target ? haversine(hit.at, target) : null };
      setResults((list) => [entry, ...(list || []).filter((r) => r.code !== code)]);
      setChosen(entry);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const converted = reprojectCollection(dataset.geojson, chosen.def);
      reprojectDataset(dataset.id, converted, chosen.code);
      setStatus({ kind: 'ok', text: `${dataset.name} reprojected from EPSG:${chosen.code} to WGS84.` });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  // Portalled to the body: this dialog is opened from the sidebar and from a
  // map card, both of which carry backdrop-filter — and a filtered ancestor
  // becomes the containing block for position:fixed, trapping the modal inside
  // a 258px column.
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reproject “{dataset.name}”</h2>

        <p className="modal-note">
          Its coordinates are {dataset.projected?.units ?? 'projected'}, so the source system
          has to be identified before they can be converted to latitude/longitude.
          {ref
            ? ` Candidates are ranked by how close they land to ${ref.from}.`
            : ' Nothing is loaded to check the result against, so enter roughly where this data should be and the candidates will be ranked by distance.'}
        </p>

        {!ref && (
          <div className="crs-manual">
            <div className="share-label">Roughly where is this data?</div>
            <div className="share-link">
              <input
                type="text"
                value={manualTarget}
                placeholder="latitude, longitude — e.g. 34.05, -118.24"
                onChange={(e) => setManualTarget(e.target.value)}
              />
            </div>
          </div>
        )}

        {results === null && <p className="modal-note">Testing candidate systems…</p>}

        {results && results.length > 0 && (
          <ul className="crs-list">
            {results.slice(0, 6).map((r) => {
              const good = r.km !== null && r.km < 50;
              return (
                <li key={r.code}>
                  <button
                    className={`crs-option${chosen?.code === r.code ? ' on' : ''}`}
                    onClick={() => setChosen(r)}
                  >
                    <span className="crs-name">
                      EPSG:{r.code}
                      <span className="crs-label"> · {r.label}</span>
                    </span>
                    <span className="crs-meta">
                      lands at {coord(r.at)}
                      {r.km !== null && (
                        <span className={good ? 'crs-good' : 'crs-far'}>
                          {' · '}{fmt(r.km)} km away
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {results && results.length === 0 && (
          <p className="modal-note">
            None of the candidates produced valid coordinates. Enter the EPSG code from
            whatever produced this file — QGIS shows it in the layer’s properties.
          </p>
        )}

        <div className="crs-manual">
          <div className="share-label">Or enter a code</div>
          <div className="share-link">
            <input
              type="text"
              value={manual}
              placeholder="EPSG code, e.g. 2229"
              onChange={(e) => setManual(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && test()}
            />
            <button onClick={test} disabled={busy}>Test</button>
          </div>
        </div>

        {error && <div className="modal-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-primary" onClick={apply} disabled={!chosen || busy}>
            {busy ? 'Converting…' : chosen ? `Reproject from EPSG:${chosen.code}` : 'Choose a system'}
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>

        <button className="modal-close" onClick={onClose} title="Close">✕</button>
      </div>
    </div>,
    document.body
  );
}
