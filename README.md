# Geo Insights

A browser-based GIS dashboard: maps, charts, tables, statistics, and notes on one
canvas, all cross-filtered by selection. Built as a replacement for the workflow
ArcGIS Insights used to cover.

Everything runs client-side. Your data is parsed in the browser and never uploaded
anywhere, which is also why it deploys to GitHub Pages with no server.

## Using it

Drop a file anywhere on the page:

| Format | Notes |
|---|---|
| `.geojson` / `.json` | FeatureCollection, Feature, or bare geometry |
| `.csv` / `.tsv` | Mapped automatically when latitude/longitude columns are present |
| `.zip` | A zipped shapefile — include `.shp`, `.shx`, `.dbf`, and `.prj` |
| `.geoinsights.json` | A previously saved project |

A map and a count appear right away. Add more cards from the left sidebar, and
configure any card with its ⚙ button — which field colors the map, what a chart
plots, which statistic a KPI shows.

### Cross-filtering

This is the core behavior. One selection is active at a time, and every card bound
to the same dataset responds to it:

- **Shift-drag on the map** selects features inside the box
- **Click a map feature** selects just that one
- **Click a bar** in a bar chart, histogram, or box plot selects its members
- **Drag a box on a scatter plot** to brush-select points
- **Click a table row** to select it

Statistics recompute against the selection and show it as a share of the total
("273 — of 2,170 total · 12.6%"). Unselected map features dim rather than disappear,
so the selection keeps its geographic context. Press **Esc** to clear.

### Cards

- **Map** — choropleth or graduated points, quantile classes, adjustable opacity
- **Chart** — bar, histogram, scatter, time series, box plot
- **Statistic** — count, sum, mean, median, min, max, standard deviation
- **Table** — sortable, click to select
- **Text** — markdown notes; double-click to edit

Drag cards by their title bar, resize from the bottom-right corner.

### Saving

**Save** writes a `.geoinsights.json` file containing the layout, every card's
configuration, *and* the data itself — so the file opens anywhere with nothing
missing. Large layers make large project files; trim columns before importing if
that becomes awkward.

### Loading data from a URL

Append `?data=` to load a hosted layer at startup:

```
https://<your-site>/?data=https://example.com/tracts.geojson
```

The host must send permissive CORS headers. Useful for sharing a dashboard that
points at a layer you already publish somewhere.

## Running locally

```bash
npm install
npm run dev
```

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and publishes on every push
to `main`. Enable it once: **Settings → Pages → Source: GitHub Actions**. The
workflow sets the base path from the repository name automatically, so a project
site at `https://<user>.github.io/<repo>/` works without configuration.

## Notes and limits

- **GeoPackage isn't supported.** It's a SQLite database and needs a heavy parser;
  export to GeoJSON from QGIS instead.
- **Coordinates must be WGS84 (EPSG:4326).** Projected data won't line up —
  reproject before importing. CSV lat/lon values outside ±90/±180 are skipped for
  this reason.
- **Cross-filtering works within a dataset**, not across two datasets. Join your
  layers before importing if you need one selection to drive both.
- Very large layers (100k+ features) will feel slow; the whole dataset lives in
  browser memory.

## Built with

MapLibre GL (maps, no API key), CARTO basemaps, React, Vite, Zustand, Papa Parse,
shpjs. Charts are hand-rolled SVG so every mark can drive a selection.
