import { describe, expect, it } from 'vitest'
import { calculateLogicalLevel } from '../geometry/logicalLayer'

describe('logical level calculation', () => {
  it('treats tunnel roads as negative levels', () => {
    expect(calculateLogicalLevel({ tunnel: 'yes' })).toBe(-1)
  })

  it('treats bridge roads as positive levels', () => {
    expect(calculateLogicalLevel({ bridge: 'yes' })).toBe(1)
  })

  it('uses explicit layer values when present', () => {
    expect(calculateLogicalLevel({ layer: '2' })).toBe(2)
  })
})
