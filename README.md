# Geo Insights

A browser-based GIS dashboard: maps, charts, tables, statistics, and notes on one
canvas, all cross-filtered by selection. Built as a replacement for the workflow
ArcGIS Insights used to cover.

Everything runs client-side. Your data is parsed in the browser and never uploaded
anywhere, which is also why it deploys as static files with no server.

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

- **Map** — see Symbology below
- **Chart** — bar (horizontal or vertical), stacked bar, grouped bar, donut,
  histogram, scatter, time series, box plot
- **Statistic** — count, sum, mean, median, min, max, standard deviation
- **Table** — sortable, click to select
- **Title** — headings in four sizes with an optional subtitle, for banners and
  section breaks
- **Text** — markdown notes; double-click to edit

### Symbology

Under ⚙ on a map card:

- **Single colour** — one hue from the palette, for layers with nothing to encode
- **Graduated** — a numeric field split into classes. Choose the break method
  (quantile, equal interval, natural breaks, standard deviation), 3–9 classes,
  one of eight sequential ramps or a blue↔red diverging ramp, and reverse it
- **Categories** — colour by a text field. The eight most common values take the
  categorical palette in fixed order; the rest fold into "Other" rather than
  inventing hues nobody can distinguish
- **Size by** — point layers can scale symbols by a measure, area-proportional
  so the areas compare honestly rather than the radii

Features with no value are painted a neutral grey rather than dropped into the
lowest class, where they would read as a real low value. Identifier and
coordinate columns are never chosen as a default measure — a choropleth of
longitude is just a picture of west-to-east.

Sequential ramps other than blue were generated in OKLCH from the categorical
anchors on a shared lightness band, so each is monotonic in lightness and clears
8:1 at its dark end against the light surface. Blue is the validated reference.

Drag cards by their title bar, resize from the bottom-right corner.

### Basemaps

Set per map card under ⚙ → Basemap. Every option is key-free — no account, no
token — which is what keeps the app deployable as static files.

| Option | Use it for |
|---|---|
| **Match theme** (default) | CARTO Positron in light mode, Dark Matter in dark — follows the theme toggle |
| **Positron** / **Dark Matter** | Pin one of those regardless of theme |
| **Voyager** | Streets and labels, when you need to read the street network |
| **OpenStreetMap** | Full detail; busy under a choropleth, but good for context |
| **Satellite** | Esri World Imagery — verifying features against what's on the ground |
| **None** | Solid background, data only; best for exporting figures |

Positron and Dark Matter are deliberately desaturated so the choropleth carries
the color. On Satellite, feature outlines switch to white automatically, since
theme ink disappears against imagery.

Attribution is required for OpenStreetMap and Esri and is displayed by the map
automatically — leave it visible.

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

## Deploying

The app is static, so any web server will do. `./deploy.sh` builds and ships it
over ssh:

```bash
cp .env.deploy.example .env.deploy   # set GEO_HOST and GEO_URL
./deploy.sh
```

`.env.deploy` is gitignored, so this repo carries no server address.

The server side is plain nginx: serve the build directory, gzip JSON and JS
(GeoJSON compresses 5–10×, which matters most for anyone loading a shared
dashboard), cache `/assets/` immutably since those filenames are content-hashed,
and fall back to `index.html` so client-side routes resolve.

Deployed from a subdirectory rather than a domain root, set `base` in
`vite.config.js` to that prefix — asset URLs are absolute.

## Notes and limits

- **GeoPackage isn't supported.** It's a SQLite database and needs a heavy parser;
  export to GeoJSON from QGIS instead.
- **Coordinates must be WGS84 (EPSG:4326).** Projected data is detected on load
  and reported per layer — attributes still drive charts, tables and statistics,
  but the map asks you to reproject. Web Mercator is converted automatically
  *only* when the file declares EPSG:3857: its extent overlaps State Plane and
  UTM, so guessing from the numbers would silently move data to the wrong place.
  CSV lat/lon values outside ±90/±180 are skipped for the same reason.
- **Cross-filtering works within a dataset**, not across two datasets. Join your
  layers before importing if you need one selection to drive both.
- Very large layers (100k+ features) will feel slow; the whole dataset lives in
  browser memory.

## Built with

MapLibre GL (maps, no API key), CARTO basemaps, React, Vite, Zustand, Papa Parse,
shpjs. Charts are hand-rolled SVG so every mark can drive a selection.

### Why MapLibre is pinned

`maplibre-gl` is pinned to an exact **5.24.0** — not a range.

On 6.2.0 the map initialised without any error and reported healthy state — style
parsed, camera transform valid, worker attached, animation frames running at
60fps — but never created a single tile for any source. Nothing drew: a black
canvas, no console errors, no failed requests. Switching to 5.24.0 fixed it.

One caveat on that diagnosis: the Vite dependency cache was also cleared in the
same step, so 6.x is not conclusively proven to be the cause. What is certain is
that 5.24.0 works. Version 6 did definitely remove the default export
(`import maplibregl from 'maplibre-gl'` no longer works — use named imports).

If you try 6.x again, verify that **tiles actually render**, not merely that the
app builds and reports no errors — that was exactly the failure mode. And don't
let a caret range pick up the major on its own; a caret is how it arrived
unnoticed the first time.
