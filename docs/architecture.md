# Architecture

## Module diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│ components/ (React)                                                 │
│  MapView  AreaSelector(PlaceSearch,GeoJsonUpload,DrawingTools)       │
│  AnalysisControls  AnalysisProgress  LayerControl  ResultsPanel      │
│  DistrictPanel  ExportPanel  ErrorPanel                              │
└───────────────┬───────────────────────────────────────────────────--┘
                │ reads/writes
┌───────────────▼───────────────────────────────────────────────────--┐
│ state/analysisStore.ts  (Zustand)                                    │
│  area/preview, config, progress, blocks, road layers, grid,          │
│  districts, warnings/errors, layer visibility, selection             │
└───────────────┬────────────────────────────────────────────────────-┘
                │ start()/cancel()/on(handlers)
┌───────────────▼────────────────────────────────────────────────────-┐
│ workers/workerClient.ts   <-- the ONE seam to the processing engine  │
└───────────────┬────────────────────────────────────────────────────-┘
                │ postMessage (typed, workerMessages.ts)
┌───────────────▼────────────────────────────────────────────────────-┐
│ workers/geometry.worker.ts (postMessage glue only)                   │
│   -> workers/analysisPipeline.ts (pure async function, no `self`)    │
│        uses: grid/*, services/overpass/*, services/cache/*,          │
│              geometry/*, services/export/exportReport.ts             │
└───────────────────────────────────────────────────────────────────--┘
```

Supporting, independently-testable layers:

- **domain/** - plain data types only (`AnalysisArea`, `OSMWay`, `GridCell`, `UrbanBlock`, `District`, `AnalysisConfig`, `AnalysisReport`) plus pure normalization/validation functions (`domain/analysisArea.ts`). No React, no JSTS, no fetch.
- **services/geocoding/** - `Geocoder` interface + `NominatimGeocoder`. The UI never calls Nominatim directly.
- **services/overpass/** - `OverpassClient` (fetch + timeout + endpoint rotation + retries), `OverpassQueryBuilder` (single source of truth for query text), `OverpassEndpoints` (rotation policy), `OverpassErrors` (readable error mapping), `OverpassParser` (response parsing + cross-cell deduplication).
- **services/cache/** - `AnalysisCache` interface + `IndexedDbAnalysisCache`. Cell query results, grid state, final blocks, and reports are all cached through this one interface.
- **services/export/** - `exportGeoJson.ts` (generic FeatureCollection/JSON download), `exportReport.ts` (builds the full `AnalysisReport` object and downloads it).
- **geometry/** - projection, validation (JSTS `IsValidOp`/repair), spatial index, noding, graph, 2-core, polygonization, indicators, clipping, districts, logical levels. Pure functions and classes; no browser globals.
- **grid/** - adaptive quadtree generation, complexity estimation, cell buffering, and the acquisition scheduler (concurrency + retry/backoff + cancellation).

## Data flow

1. The user picks an analysis area (search, upload, or drawing). Every path normalizes to the same `AnalysisArea` domain object (`domain/analysisArea.ts::createAnalysisArea`).
2. `App.tsx` calls `GeometryWorkerClient.start({ area, config, fixtureMode, districts, districtStrategy })`.
3. The worker runs `runAnalysisPipeline` (see `docs/algorithm.md` for the full sequence), emitting `progress`/`warning` messages as it goes.
4. On completion, the worker posts one `completed-result` message containing: the urban blocks (WGS84, with full `UrbanBlockProperties`), the original/noded/removed-branch/2-core road layers (WGS84), the acquisition grid (with per-cell state, WGS84), district statistics, and the full `AnalysisReport`.
5. `App.tsx`'s `GeometryWorkerClient` handlers write all of that into the Zustand store in one pass; `MapView` and the panels re-render from the store.

## State flow (Zustand slices)

All state lives in one store (`state/analysisStore.ts`) but is organized into logical slices: selected/preview area, analysis config, grid & acquisition progress (`progress`), worker/processing flag (`isProcessing`), the four road-network layers + grid (as ready-to-render `FeatureCollection`s produced by the worker, not recomputed in the UI), districts + district statistics + assignment strategy, map layer visibility + block styling/classification, selection (`selectedBlockId`/`selectedDistrictId`), and warnings/errors. Large per-analysis GeoJSON (roads, grid, blocks) is stored as the FeatureCollections the worker already produced - the UI never re-serializes or deep-copies them for MapLibre, it just calls `source.setData(...)`.

## Worker communication

Typed messages (`workers/workerMessages.ts`):

- `start` - `{ area, config, fixtureMode, districts, districtStrategy }`
- `progress` - one of the 15 named phases (`Area validation` ... `Completed`) with percent, cell counts, way/coordinate/segment counts, elapsed time, and cache status
- `warning` - a single actionable message (never a raw stack trace)
- `completed-result` - blocks + all road layers + grid + district statistics + the full report
- `processing-error` - a single readable message
- `cancellation-request` (UI -> worker) / `cancellation-confirmed` (worker -> UI)

`GeometryWorkerClient` (`workers/workerClient.ts`) is the only object that constructs the `Worker` and listens to `message` events; everything else in the UI deals with plain callbacks (`onProgress`, `onWarning`, `onCompleted`, `onError`, `onCancelled`).

## Service interfaces (backend replacement points)

| Interface | Current implementation | Backend replacement |
|---|---|---|
| `Geocoder` | `NominatimGeocoder` (direct fetch to Nominatim) | A backend geocoding proxy behind the same interface |
| `AnalysisCache` | `IndexedDbAnalysisCache` | A remote cache/database behind the same interface |
| `GeometryWorkerClient` | Wraps a local Web Worker | A client that calls a remote processing API but exposes the same `start/cancel/on` surface |
| Overpass acquisition | `OverpassClient` + `grid/gridScheduler.ts`, run inside the worker | A backend acquisition service; the worker would call it instead of Overpass directly |
| District statistics | `geometry/districts.ts`, run inside the worker | A backend statistics service, given the same block/district inputs |

None of these require touching a single React component - only the implementation behind the interface changes.

## Caching model

`IndexedDbAnalysisCache` uses one IndexedDB database (`urban-blocks-builder-cache`) with separate object stores for cell query results (`cellWays`), grid state, final blocks, reports, and last-updated metadata. The cache key for a cell (`buildCellCacheKey`) is a SHA-256 hash (via `crypto.subtle`, falling back to a deterministic non-cryptographic hash if unavailable) of the cell bbox plus the highway/access filters, query version, algorithm version, endpoint, and context-buffer configuration - so any configuration change naturally invalidates stale cache entries instead of silently reusing them.

## Important architectural decisions

- **The pipeline is a plain async function, not tied to `self`/`postMessage`.** `analysisPipeline.ts` takes plain inputs and a small callback object (`onProgress`, `onWarning`, `isCancelled`) and returns a plain result. This is what makes it directly unit-testable (see `tests/workers/analysisPipeline.fixture.test.ts`) and is also what makes a future move to a backend API straightforward - the same function's logic (grid, Overpass, noding, etc.) could run server-side with the same shape of inputs/outputs.
- **Noding uses JSTS's union-based technique**, not a hand-rolled sweep-line: unioning a `MultiLineString` through a snapping-precision `GeometryFactory` produces a fully noded, duplicate-free arrangement. This is a standard, robust JTS/JSTS idiom rather than a custom (and much easier to get subtly wrong) intersection algorithm.
- **The adaptive grid is acquisition-only.** It never appears in the topology pipeline past the point where all cells' ways have been merged and deduplicated - this was a hard requirement and is enforced structurally: `grid/` has no dependency on `geometry/noding.ts`, `graph.ts`, `twoCore.ts`, or `polygonize.ts`.
- **Districts never split the road network.** `geometry/districts.ts` only ever consumes already-built block polygons; it has no dependency on `geometry/graph.ts` or `noding.ts`.
