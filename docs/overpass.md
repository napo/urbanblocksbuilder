# Overpass usage

## Query structure

Queries are built by `services/overpass/OverpassQueryBuilder.ts`, the single source of truth for query text (both `OverpassClient` and the analysis report use it, so what's recorded in the report is exactly what was sent).

For a given cell bounding box `(minLon, minLat, maxLon, maxLat)`:

```
[out:json][timeout:25];
(
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|living_street|road|pedestrian)$"]["area"!="yes"]["access"!="no"]["access"!="private"](minLat,minLon,maxLat,maxLon);
);
out tags geom;
```

- The highway value list is the default set plus whichever advanced types (`service`, `track`, `footway`, `cycleway`, `path`, `motorway`, `trunk`) are enabled in Analysis controls; all are off by default.
- `["area"!="yes"]` excludes area-only ways (e.g. tagged pedestrian squares that aren't linear roads).
- One `["access"!="value"]` clause per configured access-exclusion value (default: `no`, `private`).
- `out tags geom` returns every tag on each matched way (a superset of the specifically required tags: `highway`, `bridge`, `tunnel`, `layer`, `access`, `service`, `area`, `covered`, `junction`, `name`, `oneway`) plus inline geometry, so no separate geometry request is needed and no ways without usable geometry are ever returned by Overpass in the first place.

## Endpoint configuration

`AnalysisConfig.endpoint` is the primary endpoint (default `https://overpass-api.de/api/interpreter`); `AnalysisConfig.endpoints` is the fallback/rotation list, defaulting to three public instances:

- `https://overpass-api.de/api/interpreter`
- `https://maps.mail.ru/osm/tools/overpass/api/interpreter`
- `https://overpass.private.coffee/api/interpreter`

`OverpassEndpointRotation` (`services/overpass/OverpassEndpoints.ts`) round-robins through this list. Rotation is enabled automatically whenever more than one endpoint is configured, so every call to `OverpassClient.query()` - including retries after a failure - advances to the next endpoint. In practice this means: if `overpass-api.de` times out or rate-limits a request, the retry for that same cell is sent to `maps.mail.ru` instead, without the user having to do anything.

## Concurrency and rate limiting

`grid/gridScheduler.ts` runs at most `config.concurrency` requests in flight at once (default **2**) - deliberately conservative, per Overpass's usage policy, rather than firing every grid cell in parallel.

## Retry policy

Each cell gets up to `config.maxRetries` additional attempts (default 2, so 3 attempts total) with exponential backoff: `min(500ms * 2^attempt, 8000ms)`. Only errors classified as transient are retried - timeouts, network failures, HTTP 5xx, and rate-limit responses (`services/overpass/OverpassErrors.ts::describeOverpassError`); a non-retryable failure (e.g. a malformed query) fails the cell immediately. A cell that exhausts its retries is marked `Failed` and skipped - the rest of the analysis (and the rest of the grid) still completes, with a warning surfaced to the user ("This grid cell ... failed after N attempt(s) ... continuing with the remaining cells.").

## Caching

Every cell request is looked up in `AnalysisCache` before hitting the network, keyed by a hash of the cell bounding box plus highway/access filters, query version, algorithm version, endpoint, and context-buffer configuration (`services/cache/AnalysisCache.ts`, `IndexedDbAnalysisCache.ts`). Changing any of those invalidates the cache key naturally - there is no manual cache-busting logic to maintain. Users can force a fresh download (by clearing the cache from Analysis controls) or clear everything at once, with a confirmation prompt before any destructive cache action.

## Responsible use

- Concurrency is capped and conservative by default (see above).
- The context buffer around cells is kept small (400 m default) - just enough to catch roads that continue past a cell edge, not enough to massively re-download overlapping data.
- Cached responses are reused whenever the configuration matches, so repeated analyses of the same area do not re-query Overpass.
- Offline **fixture mode** exists specifically so the whole pipeline (grid -> noding -> 2-core -> polygonization -> export) can be demonstrated and tested without making any Overpass requests at all.
- The exact query text used for every cell in an analysis is recorded in the exported analysis report, for transparency and reproducibility.

## Failure modes

| Failure | Handling |
|---|---|
| Timeout | Retried with backoff; cell marked `Failed` if retries are exhausted |
| Rate limiting (429 / "rate" in response) | Retried with backoff |
| Server error (5xx) | Retried with backoff |
| Network error | Retried with backoff |
| Malformed/unexpected response | Not retried; cell marked `Failed`, analysis continues with the remaining cells |
| User cancellation | The grid scheduler stops picking up new cells as soon as `isCancelled()` is observed between cells; in-flight requests are allowed to finish (or are abandoned by the worker being torn down) |

Overpass-specific errors are never shown as raw stack traces - `describeOverpassError` maps them to short, actionable messages before they reach the UI's warning/error panels.
