# UrbanBlocksBuilder

**UrbanBlocksBuilder — Generate and Analyse Urban Blocks from OpenStreetMap**

UrbanBlocksBuilder is a browser-first geospatial application that derives urban block polygons from the OpenStreetMap road network. Starting from a user-defined analysis area, it queries Overpass, reconstructs a topologically valid planar road network, recursively removes dead-end branches, polygonizes the remaining network into urban blocks, calculates geometric indicators, and optionally associates every block with a district for statistical reporting.

Everything runs in the browser: acquisition, caching, geometric processing (noding, graph construction, 2-core extraction, polygonization) and district statistics all execute client-side, with the heavy geometry running inside a Web Worker so the UI never blocks.

## Acknowledgements

The core idea behind this project - iteratively pruning dead-end streets from the OSM road network and polygonizing what remains to find block shapes - is directly inspired by Marcos Dione's article [**"Block sizes from OSM data"**](https://www.grulic.org.ar/~mdione/glob/posts/block-sizes-from-osm-data/), which describes deriving block sizes for Marseille using PostGIS and Shapely. If you want to understand where this approach comes from (and see it explained from a different angle, with a PostGIS-based implementation), **go read the original post** - it's a great, concise write-up. UrbanBlocksBuilder reimplements that same idea end-to-end in the browser, with JSTS for the topology, a Web Worker so it never blocks the UI, and an adaptive grid for acquiring larger areas from Overpass.

## Key features

- **Four ways to define an analysis area**: search a place name, draw a rectangle, draw a polygon, or upload a GeoJSON file.
- **Point-radius search**: when a geocoding result is only a point, pick a radius (500 m – 5 km or custom) and the app builds a real geodesic circle as the analysis area.
- **Adaptive acquisition grid**: large areas are split into a quadtree of Overpass requests with a context buffer, so no single request becomes too large; a global network is reassembled from all cells before any topology work happens.
- **Real topological processing**: JSTS-based noding (with a snapping tolerance and logical-level awareness for bridges/tunnels/layers), graph construction, recursive 2-core extraction, and JSTS Polygonizer-based block generation - not a placeholder pipeline.
- **Geometric indicators**: area, perimeter and Polsby-Popper compactness computed in a local metric (UTM) projection, never in raw longitude/latitude degrees.
- **Diagnostic flags**: tiny artifacts, unusually large polygons, and unrepaired invalid geometries are flagged and shown, never silently dropped.
- **Optional district analysis**: upload district boundaries and associate them with urban blocks using largest-overlap, point-on-surface, or proportional-intersection strategies, with full per-district statistics.
- **Local-first**: IndexedDB caching of Overpass responses and results, GeoJSON/report export, and an offline fixture mode for demos without any network access.
- **Privacy by design**: uploaded files never leave the browser; Overpass queries only ever cover the requested area; cache is local and can be cleared at any time.

## Technology stack

- React 19 + TypeScript + Vite
- MapLibre GL JS (style: `https://styles.maptoolkit.org/street-en.json`)
- Turf.js for lightweight GeoJSON operations (area, buffer, circle, boolean predicates)
- JSTS for topological operations (noding via snapping-precision union, polygonization, validity checking, buffer(0) repair)
- proj4 for WGS84 <-> local UTM projection
- A Web Worker for all heavy geometric processing, with a typed message protocol
- IndexedDB for caching (Overpass responses, grid state, results, reports)
- Zustand for application state
- Vitest for unit tests
- ESLint / oxlint + Prettier

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Enable **"Use offline fixture data"** in the Analysis controls panel to exercise the full pipeline (grid → noding → 2-core → polygonization → indicators) without contacting Overpass - useful for demos and for verifying a change without network access.

## Testing

```bash
npx vitest run
```

Tests cover GeoJSON normalization/validation, projection, logical-level classification, JSTS noding (T-junctions, same-level crossings, bridge/tunnel isolation), 2-core extraction (terminal branch removal, recursive chains, ring preservation), polygonization (single square, two adjacent squares), district assignment (largest-overlap, point-on-surface), the adaptive grid (quadtree subdivision, buffering), OSM way deduplication, Overpass query building, worker/grid-scheduler cancellation, and export/report metadata. See "Known limitations" below for what is not yet covered.

## Production build

```bash
npm run build
```

## Deployment (GitHub Pages)

The app is a static single-page bundle, so GitHub Pages is enough - no server needed. `vite.config.ts` sets the production `base` to `/urbanblocksbuilder/` (GitHub Pages project sites are served from `https://<user>.github.io/<repo>/`); update `githubPagesRepoName` there if the repo is renamed or moved to a different account.

**Option A - automatic (recommended):** a workflow at [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) lints, tests, builds, and deploys on every push to `main`. One-time setup: in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**. After that, every push to `main` redeploys automatically - no local build step, no `gh-pages` branch to manage.

**Option B - manual, one command:**

```bash
npm run deploy
```

This builds the app and pushes `dist/` to a `gh-pages` branch via the [`gh-pages`](https://www.npmjs.com/package/gh-pages) package (already a dev dependency). One-time setup: in **Settings → Pages**, set **Source** to **Deploy from a branch** and pick the `gh-pages` branch.

Either way, the published site ends up at `https://<user>.github.io/urbanblocksbuilder/`.

## Application architecture

The codebase is layered so that the geometric pipeline has no dependency on React, and every acquisition/caching/processing concern sits behind a narrow interface:

```text
src/
  app/, components/     UI: map, area selection, controls, panels
  map/ (in components/MapView)  MapLibre sources/layers/styling
  domain/               Plain data types (AnalysisArea, OSMWay, UrbanBlock, District, ...)
  services/
    geocoding/          Geocoder interface + NominatimGeocoder implementation
    overpass/           OverpassClient, OverpassQueryBuilder, endpoint rotation, error mapping, parsing/deduplication
    cache/              AnalysisCache interface + IndexedDbAnalysisCache implementation
    export/             GeoJSON + analysis-report export
  geometry/             projection, validation, spatialIndex, noding, graph, twoCore,
                        polygonize, indicators, clipping, districts, logicalLayer
  grid/                 adaptiveGrid (quadtree), gridComplexity, gridBuffer, gridScheduler
  workers/              analysisPipeline (pure orchestration), geometry.worker (postMessage glue),
                        workerClient (typed wrapper used by React), workerMessages (protocol types)
  state/                Zustand store
  config/               defaults, thresholds
  tests/                fixtures, geometry, grid, services, workers
```

`workers/analysisPipeline.ts` contains the entire pipeline as a plain async function with **no dependency on `self`/`postMessage`**, so it can be (and is) unit-tested directly in Node/Vitest. `workers/geometry.worker.ts` is a thin adapter that wires that function to the Worker's message protocol. `workers/workerClient.ts` is the only thing React talks to; replacing the in-browser worker with a remote API client in a future backend migration means reimplementing `workerClient.ts` alone.

See [`docs/architecture.md`](docs/architecture.md) for the full module diagram, data/state flow, caching model, and backend-migration points.

## Geospatial pipeline

```text
Analysis area (WGS84)
  -> adaptive acquisition grid (quadtree, buffered cells)
  -> Overpass queries per cell (bounded concurrency, retries, backoff)
  -> OSM way deduplication (across overlapping cells)
  -> projection to a local UTM zone
  -> clip to the actual analysis-area geometry (important for the point-radius circle case)
  -> JSTS noding (snapping tolerance, logical-level isolation for bridges/tunnels/layers)
  -> undirected graph construction
  -> recursive 2-core extraction (terminal-branch removal)
  -> JSTS polygonization
  -> clip faces to the analysis area, flag tiny/large/invalid results
  -> geometric indicators (area, perimeter, compactness) in metric space
  -> optional district assignment + statistics
  -> unproject results back to WGS84 for display/export
```

Full details, including the exact noding technique and its limitations, are in [`docs/algorithm.md`](docs/algorithm.md).

## Overpass usage

See [`docs/overpass.md`](docs/overpass.md) for the query structure, default/advanced highway filters, endpoint configuration and rotation, retry/backoff policy, caching, and responsible-use guidance. The exact Overpass query text used for an analysis is always recorded in the exported analysis report.

## Place search

Place search goes through a `Geocoder` interface (`services/geocoding/Geocoder.ts`), implemented by `NominatimGeocoder`. The UI (`PlaceSearch`) debounces input (400 ms), cancels in-flight requests with `AbortController`, and handles both polygon/multipolygon results (used directly as the analysis area) and point-only results (turned into a real geodesic circle via `turf.circle` once a radius is chosen).

## Drawing

Rectangle and polygon drawing use **Terra Draw** with its official MapLibre GL JS adapter (`terra-draw-maplibre-gl-adapter`) - the library explicitly preferred by the project brief, chosen because it is built and tested against MapLibre specifically. (An earlier version of this app used `@mapbox/mapbox-gl-draw`; that library's bundled default styles use a `line-dasharray` expression format MapLibre's stricter style-spec validator rejects, which silently broke its draw layers under this MapLibre version - a good example of why "it typechecks" isn't the same as "it works", caught only by driving the app in a real browser.)

Drawing is a real vertex-level interaction: click to place points (a rectangle needs two clicks, a polygon needs three or more plus a double-click to close), then drag any vertex to adjust the shape or use the small trash-icon control MapLibre adds in the map's top-left corner to clear it and start over. Live area/bbox/width/height/complexity feedback is shown in the sidebar while drawing.

## GeoJSON upload

Uploads are validated for JSON syntax, supported GeoJSON type, empty/invalid geometries, coordinate bounds, ring closure, vertex count, file size, and geographic extent, with self-intersections (via `turf.kinks`) reported as a warning. A FeatureCollection with multiple polygon features prompts the user to keep it as a MultiPolygon, merge it into one polygon, select a single feature, or cancel. Uploaded files never leave the browser.

## Adaptive grid

Large areas are covered by an initial regular tiling sized from `initialCellSizeMeters`, then recursively subdivided into quadrants wherever the estimated way/coordinate/response-size complexity exceeds the configured limits, down to `maxDepth`. Each accepted cell gets a configurable context buffer and is clipped to the analysis area before being queried. The grid is acquisition/progress bookkeeping only - it never defines block topology, which is always computed from the single, deduplicated, global road network.

## Coordinate projection

All input/output is WGS84 (EPSG:4326). Internally, the worker picks a UTM zone from the analysis area's centre longitude/latitude and reprojects everything metric-sensitive (noding tolerance, buffering, area, perimeter, compactness) into that projection before reprojecting results back to WGS84. The chosen projection is recorded on every block and in the analysis report.

## Bridges, tunnels, and logical levels

Each OSM way is assigned a logical level from `tunnel`, `bridge`, `layer`, and `covered` tags (`geometry/logicalLayer.ts`). Noding groups ways by logical level and only nodes (splits at intersections) ways within the same level - a bridge or tunnel crossing a surface road never becomes topologically connected to it, even though their 2D geometries cross.

## 2-core extraction

A queue-based, adjacency-indexed algorithm removes nodes of degree < 2 and their incident edges, re-checking only the directly affected neighbours, until no terminal nodes remain. This is O(edges) rather than repeatedly rescanning the whole graph.

## Polygonization

Uses the JSTS `Polygonizer` on the noded, 2-core-reduced network. Resulting faces are clipped to the actual analysis-area geometry, checked for validity (with `buffer(0)` repair attempted on failure), and flagged - never silently deleted - when they are smaller than the configured small-artifact threshold or larger than the configured large-block threshold (or far above the median).

## District analysis

Districts (from upload, geocoding, or future OSM-boundary sources) never influence road-network topology; blocks are always computed globally first. Three assignment strategies are implemented: largest area overlap (default), point-on-surface containment, and a proportional geometric-intersection allocation used specifically for district-level statistics (so a block that straddles a boundary contributes to both districts' totals proportionally, without ever splitting the block's own geometry or its reported area).

## Privacy

- Uploaded GeoJSON files are processed entirely client-side and are never uploaded to any application server.
- Overpass queries only ever request the bounding boxes needed for the selected analysis area.
- The analysis cache (Overpass responses, grid state, results, reports) is stored in the browser's IndexedDB and can be cleared at any time from the Analysis controls panel.

## Limitations

- **UTM zone selection is single-zone**: an area straddling a UTM zone boundary, or at extreme latitudes, uses one zone chosen from the area centre; distortion grows with distance from that zone. A polar/local-alternative projection is not yet implemented.
- **Complexity thresholds are heuristic defaults** (`config/thresholds.ts`), not calibrated against real Overpass traffic - they must be tuned with real-world testing before being treated as authoritative.
- **OSM node IDs are not currently preserved** through the Overpass parser, so logical-level grouping and geometric intersection are the noding heuristic rather than exact OSM-topology node matching; this is flagged in `docs/algorithm.md`.
- **Bundle size**: the production build's main and worker chunks exceed Vite's 500 kB warning threshold (JSTS + Turf + MapLibre are inherently large). Code-splitting is a follow-up, not yet implemented.
- District boundary upload currently supports GeoJSON only (no direct OSM-boundary download yet).

## OpenStreetMap attribution

© OpenStreetMap contributors, <https://www.openstreetmap.org/copyright>. Attribution is shown on the map, in the exported analysis report, and in this documentation.

## Future backend migration

The application is deliberately structured so that Overpass acquisition, geocoding, caching, heavy geometric processing, and district statistics can each move to a backend service later without rewriting the UI: `Geocoder`, `AnalysisCache`, and the worker's message protocol (`workerClient.ts`) are the seams to reimplement. See [`docs/architecture.md`](docs/architecture.md), "Backend replacement points".
