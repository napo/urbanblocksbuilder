import { describe, expect, it } from 'vitest'
import { OverpassClient, parseOverpassWays, parseOverpassBuildingCenters } from '../services/overpass/OverpassClient'
import { defaultAnalysisConfig } from '../config/defaults'

describe('OverpassClient', () => {
  it('builds an Overpass query around the requested bbox', () => {
    const client = new OverpassClient()
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).toContain('[out:json][timeout:40]')
    expect(query).toContain('way["highway"~')
    expect(query).toContain('41.9')
    expect(query).toContain('12.6')
  })

  it('requests surface waterways and railways alongside roads by default, as extra block separators', () => {
    const client = new OverpassClient()
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).toContain('way["waterway"~"^(river|stream|canal)$"]["tunnel"!="culvert"]')
    expect(query).toContain('way["railway"~"^(rail|light_rail|tram|narrow_gauge)$"]')
  })

  it('omits the waterway/railway clauses when their include toggles are off', () => {
    const client = new OverpassClient({ ...defaultAnalysisConfig, includeWaterway: false, includeRailway: false })
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).not.toContain('waterway')
    expect(query).not.toContain('railway')
  })

  it('requests building centres (not full footprints) in the same query by default', () => {
    const client = new OverpassClient()
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).toContain('way["building"]["building"!="no"]')
    expect(query).toContain('.buildings out center;')
  })

  it('omits the buildings clause when no-buildings merging is disabled', () => {
    const client = new OverpassClient({ ...defaultAnalysisConfig, mergeBuildinglessBlocks: false })
    const query = client.buildRoadQuery([12.4, 41.9, 12.6, 42.1])

    expect(query).not.toContain('building')
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

  it('parses waterway and railway ways the same way as roads (untagged for special-casing downstream)', () => {
    const ways = parseOverpassWays({
      elements: [
        { type: 'way', id: 1, tags: { waterway: 'river', name: 'Adige' }, geometry: [{ lat: 46.06, lon: 11.12 }, { lat: 46.07, lon: 11.13 }] },
        { type: 'way', id: 2, tags: { railway: 'rail' }, geometry: [{ lat: 46.06, lon: 11.12 }, { lat: 46.07, lon: 11.13 }] },
      ],
    })

    expect(ways).toHaveLength(2)
    expect(ways[0].tags.waterway).toBe('river')
    expect(ways[1].tags.railway).toBe('rail')
  })

  it('parses building centres from the .buildings out center result set', () => {
    const points = parseOverpassBuildingCenters({
      elements: [
        { type: 'way', id: 1, center: { lat: 46.06, lon: 11.12 } },
        { type: 'way', id: 2, tags: { highway: 'residential' }, geometry: [{ lat: 46.06, lon: 11.12 }, { lat: 46.07, lon: 11.13 }] },
      ],
    })

    expect(points).toEqual([[11.12, 46.06]])
  })
})
