import { describe, expect, it } from 'vitest'
import { describeOverpassError, HttpStatusError, OverpassRequestError } from '../../services/overpass/OverpassErrors'

describe('describeOverpassError', () => {
  it('marks a fetch AbortError (client-side timeout) as retryable', () => {
    const result = describeOverpassError(new DOMException('aborted', 'AbortError'))
    expect(result).toBeInstanceOf(OverpassRequestError)
    expect(result.retryable).toBe(true)
  })

  it('marks an HTTP 5xx failure as retryable', () => {
    const result = describeOverpassError(new HttpStatusError(503))
    expect(result.retryable).toBe(true)
  })

  it('marks a rate-limit (429) failure as retryable', () => {
    const result = describeOverpassError(new HttpStatusError(429))
    expect(result.retryable).toBe(true)
  })

  it('marks other unexpected HTTP statuses (406, 504...) as retryable, since the public Overpass mirrors return them transiently under load', () => {
    expect(describeOverpassError(new HttpStatusError(406)).retryable).toBe(true)
    expect(describeOverpassError(new HttpStatusError(504)).retryable).toBe(true)
    expect(describeOverpassError(new HttpStatusError(502)).retryable).toBe(true)
  })

  it('marks a malformed-query (400) failure as not retryable, since retrying it would fail identically every time', () => {
    const result = describeOverpassError(new HttpStatusError(400))
    expect(result.retryable).toBe(false)
  })

  it('marks an unrecognised error as not retryable', () => {
    const result = describeOverpassError(new Error('Malformed Overpass query'))
    expect(result.retryable).toBe(false)
  })
})
