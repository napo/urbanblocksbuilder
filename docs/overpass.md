# Overpass usage

## Query structure

Queries are built by `services/overpass/OverpassQueryBuilder.ts`, the single source of truth for query text (both `OverpassClient` and the analysis report use it, so what's recorded in the report is exactly what was sent).

For a given cell bounding box `(minLon, minLat, maxLon, maxLat)`, with every toggle at its default:

```
[out:json][timeout:40];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|road|pedestrian)$"]["area"!="yes"]["access"!="no"]["access"!="private"](minLat,minLon,maxLat,maxLon);
  way["waterway"~"^(river|stream|canal)$"]["tunnel"!="culvert"](minLat,minLon,maxLat,maxLon);
  way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"](minLat,minLon,maxLat,maxLon);
)->.separators;
.separators out tags geom;
way["building"]["building"!="no"](minLat,minLon,maxLat,maxLon)->.buildings;
.buildings out center;
```

- The highway value list is the default set plus whichever advanced types (`service`, `track`, `footway`, `cycleway`, `path`, `motorway`, `trunk`) are enabled in Analysis controls; all are off by default.
- `["area"!="yes"]` excludes area-only ways (e.g. tagged pedestrian squares that aren't linear roads).
- One `["access"!="value"]` clause per configured access-exclusion value (default: `no`, `private`).
- **Surface waterways and at-grade railways** (`includeWaterway`/`includeRailway`, both on by default) are requested as extra block separators, in the same call as the roads - a stream or rail line can divide two blocks with no parallel road nearby. `waterway` excludes culverts (`tunnel!=culvert`) so only genuinely surface watercourses count; `railway` naturally excludes subway (underground) and the `abandoned`/`disused`/`construction` lifecycle tags by only matching `rail|light_rail|tram|narrow_gauge`.
- **Building footprints** (`mergeBuildinglessBlocks`, on by default) are fetched as a second named result set, output with `out center` - only a point per building, not its outline - and used to fold any resulting block with no building inside it into a neighbour (see `docs/algorithm.md`, "Building-based merging"). Turning this toggle off removes the `.buildings` clause entirely, so no building data is downloaded at all.
- `out tags geom` (for the roads/waterway/railway set) returns every tag on each matched way plus inline geometry, so no separate geometry request is needed and no ways without usable geometry are ever returned by Overpass in the first place.

## Endpoint configuration

`AnalysisConfig.endpoint` is the primary endpoint (default `https://overpass-api.de/api/interpreter`); `AnalysisConfig.endpoints` is the fallback/rotation list, defaulting to three public instances:

- `https://overpass-api.de/api/interpreter`
- `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
- `https://overpass.private.coffee/api/interpreter`

`OverpassEndpointRotation` (`services/overpass/OverpassEndpoints.ts`) round-robins through this list. Rotation is enabled automatically whenever more than one endpoint is configured, so every call to `OverpassClient.query()` - including retries after a failure - advances to the next endpoint. In practice this means: if `overpass-api.de` times out or rate-limits a request, the retry for that same cell is sent to `maps.mail.ru` instead, without the user having to do anything.

## Concurrency and rate limiting

`grid/gridScheduler.ts` runs at most `config.concurrency` requests in flight at once (default **2**) - deliberately conservative, per Overpass's usage policy, rather than firing every grid cell in parallel.

## Retry policy

Each cell gets up to `config.maxRetries` additional attempts (default **3**, so **4 attempts total**) with exponential backoff: `min(1000ms * 2^attempt, 15000ms)`. The client-side request timeout is 45s (the query itself carries a server-side `[timeout:40]`, giving the server a chance to respond cleanly before the client gives up).

Retryability is decided by the actual HTTP status (`services/overpass/OverpassErrors.ts::HttpStatusError` + `describeOverpassError`), not by pattern-matching a translated message string (an earlier version did that, and it silently made almost every failure non-retryable - see the module comment for why). The policy: **HTTP 400 is the only non-retryable status**, on the reasoning that a malformed query fails the same way every time a retry won't fix; every other non-2xx status observed from the public Overpass mirrors under load - 406, 429, 502, 503, 504, and more - is treated as transient and retried. This was deliberately widened after observing the *same* well-formed, static query return 200, then 406, then 429, then 406 again across a handful of consecutive requests to `overpass-api.de` a few seconds apart.

A cell that exhausts its retries is marked `Failed` and skipped - the rest of the analysis (and the rest of the grid) still completes, with a warning surfaced to the user ("This grid cell ... failed after N attempt(s) ... continuing with the remaining cells.").

**A successful-but-empty response is also retried**, not accepted outright: a cell returning zero roads is treated as suspicious (real OSM road coverage is near-universal wherever this tool is useful) rather than as "genuinely nothing here", because the public mirrors have been observed to return `200 OK` with an empty body instead of a proper error code when under load. Only once retries are exhausted is an empty result accepted (and cached), with its own warning ("Grid cell ... returned no roads after N attempt(s)..."). Before this, an unlucky empty response could get cached as if it were the real answer and then silently keep being served - with no error ever shown - for every future run over the same area, until the cache was cleared by hand.

## Caching

Every cell request is looked up in `AnalysisCache` before hitting the network, keyed by a hash of the cell bounding box, **the exact Overpass query text for that cell**, query version, algorithm version, and endpoint (`services/cache/AnalysisCache.ts`, `IndexedDbAnalysisCache.ts`). Keying on the query text itself - rather than listing every individual filter/toggle that can affect it - means any future toggle that changes the query (a new highway type, a new separator kind, and so on) invalidates stale cache entries automatically, with nothing to remember to add to the key. (An earlier version of the key *did* enumerate individual fields and missed several - including whether waterways/railways/buildings were requested at all - so toggling those and re-running the same area could silently serve pre-toggle cached data; this is what the query-text key fixes.) Users can force a fresh download (by clearing the cache from Analysis controls) or clear everything at once, with a confirmation prompt before any destructive cache action.

## Responsible use

- Concurrency is capped and conservative by default (see above).
- The context buffer around cells is kept small (400 m default) - just enough to catch roads that continue past a cell edge, not enough to massively re-download overlapping data.
- Cached responses are reused whenever the configuration matches, so repeated analyses of the same area do not re-query Overpass.
- Offline **fixture mode** exists specifically so the whole pipeline (grid -> noding -> 2-core -> polygonization -> export) can be demonstrated and tested without making any Overpass requests at all.
- The exact query text used for every cell in an analysis is recorded in the exported analysis report, for transparency and reproducibility.

## Failure modes

| Failure | Handling |
|---|---|
| Timeout (client abort) | Retried with backoff; cell marked `Failed` if retries are exhausted |
| Any non-2xx HTTP status except 400 (429, 406, 5xx, ...) | Retried with backoff |
| HTTP 400 (malformed query) | Not retried; cell marked `Failed`, analysis continues with the remaining cells |
| Network error | Retried with backoff |
| Successful response with zero ways | Retried (see "Retry policy" above); accepted and cached only once retries are exhausted, with its own warning |
| User cancellation | The grid scheduler stops picking up new cells as soon as `isCancelled()` is observed between cells; in-flight requests are allowed to finish (or are abandoned by the worker being torn down) |

Overpass-specific errors are never shown as raw stack traces - `describeOverpassError` maps them to short, actionable messages before they reach the UI's warning/error panels.
