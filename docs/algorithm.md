# Algorithm notes

This document describes the exact sequence implemented in `workers/analysisPipeline.ts`, the reasoning behind each step, and its known limitations. The canonical global sequence is:

```
adaptive acquisition grid
  -> Overpass queries (roads + surface waterways/railways as separators, building locations)
  -> OSM way deduplication
  -> global road network
  -> metric projection + clip to the analysis area
  -> feed the analysis-area boundary itself into the network as a closing edge
  -> global noding
  -> global graph
  -> global 2-core
  -> global polygonization
  -> correct nested/overlapping faces
  -> clip to area, flag diagnostics
  -> merge any block with no building into its longest-bordering neighbour
  -> indicators -> district association -> diagnostic flags
```

Final urban blocks are **never** computed per grid cell - the grid only governs acquisition and progress reporting.

## 1. Acquisition

`grid/adaptiveGrid.ts` builds an initial regular tiling of the analysis-area bounding box sized from `initialCellSizeMeters` (default 4 km), converting metres to degrees using a local metres-per-degree approximation at the area's centre latitude. Each cell's complexity is estimated (`grid/gridComplexity.ts`) from its area alone (`waysPerKm2Estimate` x area, then x `coordinatesPerWayEstimate` for a coordinate estimate, then x `bytesPerCoordinateEstimate` for a response-size estimate). If any of the three estimates exceeds the configured per-cell limit, the cell is split into four quadrants (quadtree) and re-evaluated, down to `maxDepth`. This produces three user-facing complexity levels for the *whole area* (`estimateAreaComplexity`): **Simple analysis**, **Demanding analysis**, **Area requires subdivision** - all thresholds live in `config/thresholds.ts` and are explicitly documented there as conservative defaults requiring real-world calibration.

Each accepted leaf cell is buffered by `contextBufferMeters` (default 400 m, using `turf.buffer` - a real geodesic buffer, not a naive degree offset) and clipped to the analysis area (`grid/gridBuffer.ts`) before being queried.

Each cell's single Overpass call fetches three things (see `docs/overpass.md` for the exact query text): the road network plus, as extra block **separators**, surface waterways and at-grade railways (`config.includeWaterway`/`includeRailway`, on by default - a stream or rail line can divide two blocks with no parallel road anywhere nearby); and, in a second named result set output with `out center` (a point per building, not its footprint), **building locations** (`config.mergeBuildinglessBlocks`, on by default), used in step 12 below.

`grid/gridScheduler.ts` runs the leaf cells through a bounded-concurrency pool (`config.concurrency`, default 2). Each cell: checks the `AnalysisCache` first (keyed on the exact query text, so any toggle above that changes the query invalidates stale entries automatically); on a miss, calls `OverpassClient.query`, retrying failed requests up to `config.maxRetries` times (default 3, so 4 attempts total) with exponential backoff (1000 ms x 2^attempt, capped at 15 s). Retryability is based on the actual HTTP status (`OverpassErrors.HttpStatusError`): every non-2xx status is retried except 400 (malformed query - retrying would fail identically every time). A **successful but empty** response (zero roads) is also retried rather than accepted outright, since the public Overpass mirrors have been observed to return `200 OK` with an empty body under load instead of a proper error - only once retries are exhausted is an empty result accepted and cached. A cell that exhausts its retries on a real error is marked `Failed` and skipped (partial recovery) - the rest of the analysis still proceeds, with a warning surfaced to the UI. See `docs/overpass.md` for the full retry/cache policy.

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

**A related, concretely observed edge case**: a road's ground-level approach can end very close (within `snappingToleranceMeters`, 3 m by default) to the exact point where it - or an unrelated feature, such as a river - changes logical level, simply because that is where a real bridge or tunnel physically begins. Snapping has no way to tell "these two points are close because they are meant to connect" apart from "these two points are close because a bridge starts here by coincidence of geography", so the ground-level stub can end up welded onto the unrelated feature instead of being correctly pruned as a dead end in step 8. This was reproduced on a real bridge-over-river crossing (a road's pre-bridge approach snapping onto the river's own centreline) and is narrow in practice - it needs a very small analysis area centred almost exactly on such a crossing - but it is a real artifact, not just a hypothetical. No fix is implemented; the practical workaround is to draw a larger area, or one not centred exactly on the crossing.

## 5. Boundary-ring closure

`geometry/boundaryClosure.ts` feeds the analysis-area boundary itself into the same noding pass as the road network, as one more ground-level (logical-level 0) line per ring (exterior and, for a `MultiPolygon` area, every hole). Roads are already hard-clipped to this same boundary (step 3), so without this step, any road that would have closed a block just outside the selection becomes a dangling stub once clipped, and 2-core extraction (step 8) removes it - leaving that part of the area with no detected block at all, right where the user's own analysis boundary crosses genuine street topology. Feeding the boundary in as a real edge means such a stub instead closes against the boundary, so blocks tile the entire selected area edge to edge, with no unexplained holes near the edge of the selection.

A face bounded in part by this synthetic edge is flagged `flaggedBoundaryClosure` (step 11) so it is visually and programmatically distinguishable from a block bounded entirely by real streets - it is not deleted or hidden, since it still represents a real, if partially-artificial-boundaried, area.

Boundary-only edges (attributable to no real OSM way) are excluded from the "original/noded/2-core roads" map layers and exports, since they are not streets - see `AOI_BOUNDARY_WAY_ID` in `analysisPipeline.ts`.

**Failure mode this creates and corrects**: when a real closed road loop sits entirely inside the selection without ever reaching the boundary (directly or indirectly through other roads), it ends up in its own disconnected graph component, separate from the boundary ring's component. JSTS's `Polygonizer` resolves faces per component, so it returns *both* as separate, overlapping filled polygons instead of the boundary's leftover face correctly having the inner loop's shape punched out of it as a hole. Step 10 (face-nesting correction) exists specifically to detect and fix this.

## 6. Noding

`geometry/noding.ts::nodeRoadNetwork` is the core topological step. Ways are grouped by logical level; **ways in different groups are never noded against each other**, so a bridge crossing a surface road stays disconnected even though their 2D geometry crosses (verified in `tests/geometry/noding.test.ts`).

Within a logical-level group:

1. A JSTS `GeometryFactory` is built with a `PrecisionModel` whose scale is `1 / snappingToleranceMeters` - this is what makes coordinates within the tolerance snap to the same grid point during every subsequent JSTS operation.
2. Every way becomes a JSTS `LineString` (using real `Coordinate` instances - see "Implementation pitfalls" below).
3. All lines in the group are combined into a `MultiLineString` and passed through `UnaryUnionOp.union(...)`. Unioning a set of linestrings is a standard, robust JTS/JSTS idiom for noding: the overlay algorithm used internally splits every line at every proper intersection and dissolves duplicate segments, all in one call, without a hand-written sweep-line/intersection algorithm.
4. The result's component linestrings are extracted, deduplicated (direction-independent coordinate-sequence key), and validated (`IsValidOp`, with `buffer(0)` repair attempted on failure).
5. Each resulting edge is attributed back to its original way ID(s) by proximity (nearest original way to the edge's midpoint, within 4x the snapping tolerance) - this is an approximation, since a single union can merge multiple original ways into one edge; exact provenance is a nice-to-have, not required for correctness.

Statistics collected: input ways/coordinates/segments, detected same-level intersections and cross-level ("incompatible") crossings (both computed via a uniform-grid spatial index, `geometry/spatialIndex.ts`, to prune candidate pairs before an exact segment-intersection test - never O(n²) over every pair), segments after noding, generated nodes, invalid/repaired geometry counts, and removed duplicate segments. All of this is surfaced in the analysis report.

## 7. Graph construction

`geometry/graph.ts::buildGraphFromNodedEdges` turns noded edges into an undirected graph: each edge's first/last coordinate becomes (or reuses) a node, keyed by coordinates rounded to the snapping tolerance. Since noding has already split every same-level intersection, this is a direct 1:1 mapping from noded edges to graph edges - no further splitting is needed here.

## 8. 2-core extraction

`geometry/twoCore.ts::extractTwoCore` recursively removes nodes of degree < 2: an adjacency map (`node id -> incident edge ids`) means each removal only touches the edges actually incident to the node being processed, not the whole edge list, so the algorithm is proportional to the number of edges removed, not `nodes x edges`. Terminal nodes are seeded into a queue; removing a node's incident edges decrements its neighbours' degree, and any neighbour that drops below degree 2 is enqueued in turn, until the queue empties. The removed edges (the "terminal branches") and the surviving core are both kept and exposed separately (as required for the "removed branches" map layer/export).

Note that a roundabout island or a divided road's central reservation are, topologically, entirely ordinary closed loops - a roundabout ring with real approach roads survives 2-core extraction and polygonizes (next step) into its own small, real face exactly like any other block, and a divided road's two parallel one-way ways bound their own thin sliver between them the same way. Neither is special-cased anywhere in this pipeline; see step 12 for why they still come out reasonably.

## 9. Polygonization

`geometry/polygonize.ts::polygonizeGraph` feeds the 2-core's edges into the JSTS `Polygonizer`. Dangle, cut-edge, and invalid-ring counts are read back as diagnostics. Every resulting polygon is validity-checked (repairing with `buffer(0)` where needed) before being converted back to GeoJSON.

## 10. Face-nesting correction

`geometry/polygonize.ts::resolveFaceNesting` runs immediately after polygonization, over the whole set of faces. For every pair of faces (cheaply pre-filtered by bounding-box containment before the real, more expensive JSTS `covers()` check - see `geometry/bbox.ts`), if one geometrically covers another, the covered face is subtracted from the covering one (`difference()` of the union of everything it covers), turning what the Polygonizer returned as two separate, overlapping filled polygons into the topologically correct outer-face-with-a-hole. This is what makes the boundary-ring-closure failure mode described in step 5 actually safe to rely on.

## 11. Clipping and flagging

Each polygonized face is clipped to the real analysis-area geometry (`geometry/clipping.ts::clipPolygonToArea`, a JSTS `intersection`) - this removes the parts of faces that extend past the requested boundary (a natural consequence of roads dangling out of the analysis area) without ever assuming the *external* face needs separate handling, since the Polygonizer only returns bounded faces to begin with. Degenerate (zero/negative-area) results are dropped. Every surviving polygon is **flagged, not deleted**, when:

- its area is below `config.minAreaM2` (`flaggedSmallArtifact`)
- its area is above `config.largeBlockAreaThresholdM2`, **or** more than 8x the median block area for this analysis (`flaggedLargeArea`)
- it failed validity and could not be repaired (`flaggedInvalidGeometry`)
- a non-trivial part of its edge coincides with the analysis-area boundary rather than a real street (`flaggedBoundaryClosure` - see step 5)
- it still has no building inside it after step 12 below, because no reachable neighbour was found to absorb it into (`flaggedNoBuildings`)

## 12. Building-based merging

`geometry/blockMerging.ts::absorbBuildinglessBlocks` runs after clipping, using the building locations fetched in step 1. Every candidate face is tested for whether at least one building point falls inside it (`turf.booleanPointInPolygon`); a face with none is folded into whichever touching neighbour it shares the longest border with (measured as the length of the intersection of the two faces' boundaries), repeating so a run of adjacent buildingless faces (e.g. a park spanning several street-grid cells) consolidates into the one real block it eventually borders. A buildingless face with no neighbour at all is left as its own block and flagged `flaggedNoBuildings`.

This is not a targeted fix for any specific artifact - it is a general "a block with no building isn't a meaningful urban block on its own" rule - but it is, in practice, what keeps three unrelated failure modes from surfacing as visible problems: the boundary-ring-closure leftover face (step 5) when it has no building of its own, a roundabout's central island (step 8's note), and a divided road's thin median sliver (also step 8's note). None of those three are detected or handled explicitly anywhere in the code; they are simply buildingless faces like any other, and this step absorbs them the same way. `tests/geometry/knownArtifacts.test.ts` documents the roundabout/divided-road behaviour directly, including the fact that the merge target among several equally-plausible neighbours is picked deterministically (longest shared border, ties broken by iteration order) rather than by any semantic judgement.

## 13. Indicators

`geometry/indicators.ts` computes area and perimeter with plain planar (shoelace) formulas on the already-metric, post-merge coordinates - explicitly **not** `turf.area`/`turf.length`, which assume WGS84 degrees and would silently produce wrong numbers on projected coordinates. Compactness is the Polsby-Popper index: `4 * pi * area / perimeter^2`. A very low compactness value (well under, say, 0.1) is a strong signal that a face is a sliver artifact (a divided-road median, in particular) rather than a real block, but nothing in the pipeline currently flags on compactness directly - only on area (step 11).

## 14. District association

See `geometry/districts.ts`. Districts are projected into the same metric CRS as the blocks. Every block/district pair is first cheaply ruled out by a bounding-box overlap check (`geometry/bbox.ts::bboxesOverlap`) before the real JSTS predicate runs - without it, cost is `blocks x districts` unconditionally, which is the actual bottleneck for a city-sized analysis with many districts (see `docs/architecture.md` for the measured numbers). Three strategies:

- **Largest area overlap** (default): for each block, compute the intersection area with every (bbox-candidate) district (JSTS `intersection().getArea()`) and keep the best match; `overlapRatio = intersectionArea / block.areaM2`.
- **Point-on-surface containment**: JSTS's `InteriorPointArea.getInteriorPoint()` (the same technique behind PostGIS `ST_PointOnSurface`) gives a point guaranteed to be inside the block even for concave/multi-part polygons; the first (bbox-candidate) district whose geometry contains that point wins.
- **Geometric intersection (statistical allocation)**: used specifically for **district statistics**, not for the block's own `districtId` property (which is always single-valued). Each block's area is distributed across every district it overlaps, proportional to the overlap area, so a block straddling a boundary contributes fractionally to both districts' totals - without ever altering the block's own reported geometry or area.

A block's own `areaM2` is always the whole-block planar area computed in step 13; it is never recomputed from a district intersection.

## 15. Diagnostic flags

Summarized above (step 11); always exposed on `UrbanBlockProperties` and visible in the map popup, the Results panel, and the export - never silently dropped from the output.

## Implementation pitfalls found during development (kept here so they are not reintroduced)

- **JSTS's convenience instance methods** (`.buffer()`, `.intersection()`, `.union()`, `.contains()`, `.intersects()`, ...) are not on `Geometry.prototype` by default - they are added by importing `jsts/org/locationtech/jts/monkey.js` for its side effects. This import lives once, at the top of `geometry/validation.ts`, which every JSTS-touching module already depends on.
- **`GeometryFactory.createLineString`/`createPoint` require real `Coordinate` instances**, not plain `{x, y}` objects - `IsValidOp` (and other operations) call methods like `.copy()` on each coordinate that plain objects don't have. See `geometry/validation.ts::toJstsCoordinates`.
- **Never detach a JSTS instance method from its receiver** (e.g. `const f = geometry.getGeometryN; f(0)`) - JSTS methods rely on `this`, so a detached call throws inside the method body instead of at the call site, which is a confusing failure mode. This bug shipped once for real: `boundaryClosure.ts::computeBoundaryContactLength` destructured `factory.createPoint` into a local variable and called it detached, so every call threw internally, was swallowed by a surrounding `try/catch`, and silently returned 0 - meaning `flaggedBoundaryClosure` was `false` for every block, always, with no error anywhere. It was only caught because a test asserted the flag should be `true` for a specific fixture block and it wasn't.
- **A cache key must be derived from everything that can change the cached value, not from an enumerated list of "the fields we remember affect it."** The per-cell Overpass cache key used to list `highwayFilters`/`accessFilters` explicitly; when waterway/railway/building-merge toggles were added later, none of them were added to the key, so toggling one and re-running the same area could silently serve pre-toggle cached data with no error or warning. The fix was to key on the actual generated query text (`OverpassClient.buildRoadQuery`'s output) instead of re-listing filters - any future toggle that changes the query is then covered automatically.

These (and the retry-classification and empty-response-caching issues described in `docs/overpass.md`) were caught by an end-to-end pipeline test run against the fixture data (`tests/workers/analysisPipeline.fixture.test.ts`), targeted unit tests, and live-browser smoke testing - not by type-checking alone. Geometric and network-facing correctness both need to be exercised, not just compiled.
