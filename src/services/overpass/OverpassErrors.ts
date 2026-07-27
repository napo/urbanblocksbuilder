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

/** Maps a low-level fetch/HTTP failure to an actionable, user-facing, classified error. */
export function describeOverpassError(error: unknown): OverpassRequestError {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return new OverpassRequestError('The Overpass server did not respond in time and the request was aborted. This cell will be retried automatically.', true)
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) {
      return new OverpassRequestError('The Overpass server did not respond in time. This cell will be retried automatically.', true)
    }
    if (/429/.test(error.message) || /rate/i.test(error.message)) {
      return new OverpassRequestError('The Overpass server is rate-limiting requests. Retrying with a longer delay.', true)
    }
    if (/5\d\d/.test(error.message)) {
      return new OverpassRequestError('The Overpass server returned a server error. Retrying automatically.', true)
    }
    if (/network|fetch/i.test(error.message)) {
      return new OverpassRequestError('The Overpass request failed due to a network issue. Check your connection and retry.', true)
    }
    return new OverpassRequestError(error.message, false)
  }

  return new OverpassRequestError('An unknown error occurred while contacting the Overpass API.', false)
}
