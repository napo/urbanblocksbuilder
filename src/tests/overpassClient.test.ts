import { describe, expect, it } from 'vitest'
import { OverpassClient, parseOverpassWays } from '../services/overpass/OverpassClient'

describe('OverpassClient', () => {
  it('builds an Overpass query around the requested bbox', () => {
    const client = new OverpassClient()
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).toContain('[out:json][timeout:40]')
    expect(query).toContain('way["highway"~')
    expect(query).toContain('41.9')
    expect(query).toContain('12.6')
  })

  it('parses ways returned by Overpass into OSMWay entries', () => {
    const ways = parseOverpassWays({
      elements: [
        {
          type: 'way',
          id: 7,
          tags: { highway: 'residential' },
          geometry: [
            { lat: 41.9, lon: 12.4 },
            { lat: 42.0, lon: 12.5 },
          ],
        },
      ],
    })

    expect(ways).toHaveLength(1)
    expect(ways[0].coordinates[0]).toEqual([12.4, 41.9])
    expect(ways[0].tags.highway).toBe('residential')
  })
})
