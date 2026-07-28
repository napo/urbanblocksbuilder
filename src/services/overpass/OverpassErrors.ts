/**
 * A classified Overpass failure: carries the user-facing message alongside
 * whether the failure is worth retrying, so callers never need to re-derive
 * retryability by pattern-matching an already-translated message (that
 * indirection previously let most real failures silently skip retries - see
 * gridScheduler's use of this).
 */
export class OverpassRequestError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable: boolean) {
    super(message)
    this.name = 'OverpassRequestError'
    this.retryable = retryable
  }
}

/**
 * Thrown by OverpassClient.query for a non-2xx HTTP response, carrying the
 * real numeric status instead of leaving describeOverpassError to re-parse
 * it out of a message string (the same class of bug that made most
 * "retryable" errors silently non-retryable before - see gridScheduler.ts).
 */
export class HttpStatusError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`Overpass request failed with HTTP ${status}`)
    this.name = 'HttpStatusError'
    this.status = status
  }
}

/** Maps a low-level fetch/HTTP failure to an actionable, user-facing, classified error. */
export function describeOverpassError(error: unknown): OverpassRequestError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new OverpassRequestError('The Overpass server did not respond in time and the request was aborted. This cell will be retried automatically.', true)
  }

  if (error instanceof HttpStatusError) {
    if (error.status === 429) {
      return new OverpassRequestError('The Overpass server is rate-limiting requests. Retrying with a longer delay.', true)
    }
    if (error.status === 400) {
      // A malformed query is a bug in query generation, not a transient
      // server issue - retrying it would just fail the same way every time.
      return new OverpassRequestError('The Overpass server rejected the query as malformed (HTTP 400).', false)
    }
    // Every other status observed from the public Overpass mirrors under
    // load - 406, 502, 503, 504, and more - has turned out to be transient:
    // the exact same well-formed, static query can return 200 a few seconds
    // later (confirmed by hand against overpass-api.de). Treat them all as
    // worth retrying rather than trying to enumerate every flavour of
    // "the server had a bad moment" a reverse proxy in front of Overpass
    // can produce.
    return new OverpassRequestError(`The Overpass server returned HTTP ${error.status}. Retrying automatically.`, true)
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) {
      return new OverpassRequestError('The Overpass server did not respond in time. This cell will be retried automatically.', true)
    }
    if (/network|fetch/i.test(error.message)) {
      return new OverpassRequestError('The Overpass request failed due to a network issue. Check your connection and retry.', true)
    }
    return new OverpassRequestError(error.message, false)
  }

  return new OverpassRequestError('An unknown error occurred while contacting the Overpass API.', false)
}
