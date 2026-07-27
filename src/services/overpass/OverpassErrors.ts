/** Maps a low-level fetch/HTTP failure to an actionable, user-facing message. */
export function describeOverpassError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'The Overpass request was cancelled.'
  }

  if (error instanceof Error) {
    if (/timeout/i.test(error.message)) {
      return 'The Overpass server did not respond in time. This cell will be retried automatically.'
    }
    if (/429/.test(error.message) || /rate/i.test(error.message)) {
      return 'The Overpass server is rate-limiting requests. Retrying with a longer delay.'
    }
    if (/5\d\d/.test(error.message)) {
      return 'The Overpass server returned a server error. Retrying automatically.'
    }
    if (/network/i.test(error.message) || /fetch/i.test(error.message)) {
      return 'The Overpass request failed due to a network issue. Check your connection and retry.'
    }
    return error.message
  }

  return 'An unknown error occurred while contacting the Overpass API.'
}
