/**
 * Endpoint rotation policy for Overpass requests. When more than one
 * endpoint is configured, requests rotate through them round-robin so a
 * single endpoint is not hammered, and a failing endpoint's neighbours can
 * still make progress.
 */
export class OverpassEndpointRotation {
  private index = 0
  private readonly endpoints: string[]

  constructor(endpoints: string[]) {
    if (endpoints.length === 0) {
      throw new Error('At least one Overpass endpoint must be configured.')
    }
    this.endpoints = endpoints
  }

  next(): string {
    const endpoint = this.endpoints[this.index % this.endpoints.length]
    this.index += 1
    return endpoint
  }

  current(): string {
    return this.endpoints[this.index % this.endpoints.length]
  }
}
