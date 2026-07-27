import { describe, expect, it } from 'vitest'
import { describeOverpassError, OverpassRequestError } from '../../services/overpass/OverpassErrors'

describe('describeOverpassError', () => {
  it('marks a fetch AbortError (client-side timeout) as retryable', () => {
    const result = describeOverpassError(new DOMException('aborted', 'AbortError'))
    expect(result).toBeInstanceOf(OverpassRequestError)
    expect(result.retryable).toBe(true)
  })

  it('marks an HTTP 5xx failure as retryable', () => {
    const result = describeOverpassError(new Error('Overpass request failed with HTTP 503'))
    expect(result.retryable).toBe(true)
  })

  it('marks a rate-limit failure as retryable', () => {
    const result = describeOverpassError(new Error('Overpass request failed with HTTP 429'))
    expect(result.retryable).toBe(true)
  })

  it('marks an unrecognised error as not retryable', () => {
    const result = describeOverpassError(new Error('Malformed Overpass query'))
    expect(result.retryable).toBe(false)
  })
})
