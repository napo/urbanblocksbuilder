# Algorithm notes

This document describes the exact sequence implemented in `workers/analysisPipeline.ts`, the reasoning behind each step, and its known limitations. The canonical global sequence is:

```
adaptive acquisition grid
  -> Overpass queries
  -> OSM way deduplication
  -> global road network
  -> metric projection
  -> global noding
  -> global graph
  -> global 2-core
  -> global polygonization
  -> indicators -> district association -> diagnostic flags
```

Final urban blocks are **never** computed per grid cell - the grid only governs acquisition and progress reporting.

## 1. Acquisition

`grid/adaptiveGrid.ts` builds an initial regular tiling of the analysis-area bounding box sized from `initialCellSizeMeters` (default 4 km), converting metres to degrees using a local metres-per-degree approximation at the area's centre latitude. Each cell's complexity is estimated (`grid/gridComplexity.ts`) from its area alone (`waysPerKm2Estimate` x area, then x `coordinatesPerWayEstimate` for a coordinate estimate, then x `bytesPerCoordinateEstimate` for a response-size estimate). If any of the three estimates exceeds the configured per-cell limit, the cell is split into four quadrants (quadtree) and re-evaluated, down to `maxDepth`. This produces three user-facing complexity levels for the *whole area* (`estimateAreaComplexity`): **Simple analysis**, **Demanding analysis**, **Area requires subdivision** - all thresholds live in `config/thresholds.ts` and are explicitly documented there as conservative defaults requiring real-world calibration.

Each accepted leaf cell is buffered by `contextBufferMeters` (default 400 m, using `turf.buffer` - a real geodesic buffer, not a naive degree offset) and clipped to the analysis area (`grid/gridBuffer.ts`) before being queried.

`grid/gridScheduler.ts` runs the leaf cells through a bounded-concurrency pool (`config.concurrency`, default 2). Each cell: checks the `AnalysisCache` first; on a miss, calls `OverpassClient.query`, retrying failed requests up to `config.maxRetries` times with exponential backoff (500 ms x 2^attempt, capped at 8 s), but only for errors classified as retryable (timeout/network/5xx/rate-limit, via `OverpassErrors.describeOverpassError`). A cell that exhausts its retries is marked `Failed` and skipped (partial recovery) - the rest of the analysis still proceeds, with a warning surfaced to the UI.

## 2. Deduplication

`services/overpass/OverpassParser.ts::deduplicateOsmWays` merges ways downloaded from multiple (overlapping, buffered) cells by OSM way ID, keeping whichever copy has the most coordinates (the more complete geometry) and merging the `sourceCellIds` so provenance is preserved.

## 3. Projection

`geometry/projection.ts` selects a UTM zone from the analysis area's bbox centre longitude/latitude (`getProjectionForBbox`) and projects every geometry that needs metric operations - the analysis area, all road-network coordinates, district geometries - into it via proj4. Results are projected back to WGS84 only at the very end, right before being handed to the UI. **Limitation**: a single UTM zone is chosen for the whole area; an area straddling a zone boundary, or very near the poles, will see increasing distortion away from that zone. A local/alternative projection for such cases is not implemented.

Immediately after projection, each way is clipped to the (also-projected) analysis-area geometry using `turf.lineSplit` + `turf.booleanPointInPolygon` (`analysisPipeline.ts::clipLineToArea`). This is what makes the point-radius workflow correct: Overpass is queried using the circle's bounding box, but everything downstream only sees the parts of roads that actually fall inside the real circle.

## 4. Logical levels

`geometry/logicalLayer.ts::calculateLogicalLevel` maps OSM tags to an integer logical level:

- `tunnel=yes` -> `-1`
- `bridge=yes` -> `1`
- `covered=yes` (and no bridge/tunnel) -> `0`
- a numeric `layer` tag -> that value
- otherwise -> `0`

**Limitation**: this is a heuristic based purely on tags, not on OSM node identity. The Overpass response parser does not currently retain OSM node IDs, so the pipeline cannot distinguish "these two ways share an actual OSM node" from "these two ways happen to have the same coordinates after snapping." In practice, snapping-tolerance-based noding plus logical-level isolation (below) produces correct results for the overwhelmingly common cases (bridges/tunnels crossing surface roads, differing `layer` values), but a way that changes logical level mid-way without a real shared node at the transition point could, in principle, be treated as unconnected where OSM intended a connection. This is flagged as a follow-up: preserving node IDs through the parser and using them as the primary connectivity signal (falling back to geometric snapping only where node IDs are unavailable, e.g. for synthetic/uploaded data).

## 5. Noding

`geometry/noding.ts::nodeRoadNetwork` is the core topological step. Ways are grouped by logical level; **ways in different groups are never noded against each other**, so a bridge crossing a surface road stays disconnected even though their 2D geometry crosses (verified in `tests/geometry/noding.test.ts`).

Within a logical-level group:

1. A JSTS `GeometryFactory` is built with a `PrecisionModel` whose scale is `1 / snappingToleranceMeters` - this is what makes coordinates within the tolerance snap to the same grid point during every subsequent JSTS operation.
2. Every way becomes a JSTS `LineString` (using real `Coordinate` instances - see "Implementation pitfalls" below).
3. All lines in the group are combined into a `MultiLineString` and passed through `UnaryUnionOp.union(...)`. Unioning a set of linestrings is a standard, robust JTS/JSTS idiom for noding: the overlay algorithm used internally splits every line at every proper intersection and dissolves duplicate segments, all in one call, without a hand-written sweep-line/intersection algorithm.
4. The result's component linestrings are extracted, deduplicated (direction-independent coordinate-sequence key), and validated (`IsValidOp`, with `buffer(0)` repair attempted on failure).
5. Each resulting edge is attributed back to its original way ID(s) by proximity (nearest original way to the edge's midpoint, within 4x the snapping tolerance) - this is an approximation, since a single union can merge multiple original ways into one edge; exact provenance is a nice-to-have, not required for correctness.

Statistics collected: input ways/coordinates/segments, detected same-level intersections and cross-level ("incompatible") crossings (both computed via a uniform-grid spatial index, `geometry/spatialIndex.ts`, to prune candidate pairs before an exact segment-intersection test - never O(n²) over every pair), segments after noding, generated nodes, invalid/repaired geometry counts, and removed duplicate segments. All of this is surfaced in the analysis report.

## 6. Graph construction

`geometry/graph.ts::buildGraphFromNodedEdges` turns noded edges into an undirected graph: each edge's first/last coordinate becomes (or reuses) a node, keyed by coordinates rounded to the snapping tolerance. Since noding has already split every same-level intersection, this is a direct 1:1 mapping from noded edges to graph edges - no further splitting is needed here.

## 7. 2-core extraction

`geometry/twoCore.ts::extractTwoCore` recursively removes nodes of degree < 2: an adjacency map (`node id -> incident edge ids`) means each removal only touches the edges actually incident to the node being processed, not the whole edge list, so the algorithm is proportional to the number of edges removed, not `nodes x edges`. Terminal nodes are seeded into a queue; removing a node's incident edges decrements its neighbours' degree, and any neighbour that drops below degree 2 is enqueued in turn, until the queue empties. The removed edges (the "terminal branches") and the surviving core are both kept and exposed separately (as required for the "removed branches" map layer/export).

## 8. Polygonization

`geometry/polygonize.ts::polygonizeGraph` feeds the 2-core's edges into the JSTS `Polygonizer`. Dangle, cut-edge, and invalid-ring counts are read back as diagnostics. Every resulting polygon is validity-checked (repairing with `buffer(0)` where needed) before being converted back to GeoJSON.

## 9. Clipping and flagging

Each polygonized face is clipped to the real analysis-area geometry (`geometry/clipping.ts::clipPolygonToArea`, a JSTS `intersection`) - this removes the parts of faces that extend past the requested boundary (a natural consequence of roads dangling out of the analysis area) without ever assuming the *external* face needs separate handling, since the Polygonizer only returns bounded faces to begin with. Degenerate (zero/negative-area) results are dropped. Every surviving polygon is **flagged, not deleted**, when:

- its area is below `config.minAreaM2` (`flaggedSmallArtifact`)
- its area is above `config.largeBlockAreaThresholdM2`, **or** more than 8x the median block area for this analysis (`flaggedLargeArea`)
- it failed validity and could not be repaired (`flaggedInvalidGeometry`)

## 10. Indicators

`geometry/indicators.ts` computes area and perimeter with plain planar (shoelace) formulas on the already-metric coordinates - explicitly **not** `turf.area`/`turf.length`, which assume WGS84 degrees and would silently produce wrong numbers on projected coordinates. Compactness is the Polsby-Popper index: `4 * pi * area / perimeter^2`.

## 11. District association

See `geometry/districts.ts`. Districts are projected into the same metric CRS as the blocks. Three strategies:

- **Largest area overlap** (default): for each block, compute the intersection area with every district (JSTS `intersection().getArea()`) and keep the best match; `overlapRatio = intersectionArea / block.areaM2`.
- **Point-on-surface containment**: JSTS's `InteriorPointArea.getInteriorPoint()` (the same technique behind PostGIS `ST_PointOnSurface`) gives a point guaranteed to be inside the block even for concave/multi-part polygons; the first district whose geometry contains that point wins.
- **Geometric intersection (statistical allocation)**: used specifically for **district statistics**, not for the block's own `districtId` property (which is always single-valued). Each block's area is distributed across every district it overlaps, proportional to the overlap area, so a block straddling a boundary contributes fractionally to both districts' totals - without ever altering the block's own reported geometry or area.

A block's own `areaM2` is always the whole-block planar area computed in step 10; it is never recomputed from a district intersection.

## 12. Diagnostic flags

Summarized above (step 9); always exposed on `UrbanBlockProperties` and visible in the map popup, the Results panel, and the export - never silently dropped from the output.

## Implementation pitfalls found during development (kept here so they are not reintroduced)

- **JSTS's convenience instance methods** (`.buffer()`, `.intersection()`, `.union()`, `.contains()`, `.intersects()`, ...) are not on `Geometry.prototype` by default - they are added by importing `jsts/org/locationtech/jts/monkey.js` for its side effects. This import lives once, at the top of `geometry/validation.ts`, which every JSTS-touching module already depends on.
- **`GeometryFactory.createLineString`/`createPoint` require real `Coordinate` instances**, not plain `{x, y}` objects - `IsValidOp` (and other operations) call methods like `.copy()` on each coordinate that plain objects don't have. See `geometry/validation.ts::toJstsCoordinates`.
- **Never detach a JSTS instance method from its receiver** (e.g. `const f = geometry.getGeometryN; f(0)`) - JSTS methods rely on `this`, so a detached call throws inside the method body instead of at the call site, which is a confusing failure mode.

These were all caught by an end-to-end pipeline test run against the fixture data (`tests/workers/analysisPipeline.fixture.test.ts`) and a live-browser smoke test, not by type-checking alone - a reminder that geometric correctness needs to be exercised, not just compiled.
