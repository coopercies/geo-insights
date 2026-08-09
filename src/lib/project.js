// Projects are self-contained JSON: layout, card config, and the data itself.
// That keeps a saved file portable (no missing-source-file problem), at the
// cost of size — hence the warning threshold below.

const FORMAT = 'geo-insights/v1';
const WARN_BYTES = 60 * 1024 * 1024;

export function serialize({ datasets, cards, layout }) {
  return JSON.stringify({
    format: FORMAT,
    savedAt: new Date().toISOString(),
    datasets,
    cards,
    layout,
  });
}

export function downloadProject(state, filename = 'dashboard.geoinsights.json') {
  const text = serialize(state);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return blob.size;
}

export async function readProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (data.format !== FORMAT) {
    throw new Error(`Not a Geo Insights project file (found format "${data.format ?? 'none'}").`);
  }
  return data;
}

export function sizeWarning(bytes) {
  return bytes > WARN_BYTES
    ? `Saved ${(bytes / 1024 / 1024).toFixed(0)} MB — large projects reload slowly. Consider trimming columns before import.`
    : null;
}

export function isProjectFile(file) {
  return file.name.endsWith('.geoinsights.json');
}
