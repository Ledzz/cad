import { describe, it, expect } from 'vitest'
import { validateProjectFile, CAD_FILE_VERSION } from '../projectFile'

// ─── Validation ─────────────────────────────────────────────

describe('validateProjectFile', () => {
  it('accepts a valid v1 project file', () => {
    const data = {
      version: 1,
      features: [
        {
          id: 'sketch-1',
          name: 'Sketch 1',
          type: 'sketch',
          suppressed: false,
          sketch: { plane: { name: 'XY', origin: [0,0,0], normal: [0,0,1], xDir: [1,0,0], yDir: [0,1,0] }, entities: [], constraints: [] },
        },
      ],
    }
    const result = validateProjectFile(data)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('sketch-1')
  })

  it('accepts an empty features array', () => {
    const data = { version: 1, features: [] }
    const result = validateProjectFile(data)
    expect(result).toHaveLength(0)
  })

  it('throws on non-object input', () => {
    expect(() => validateProjectFile('not an object')).toThrow('not an object')
    expect(() => validateProjectFile(null)).toThrow('not an object')
    expect(() => validateProjectFile(42)).toThrow('not an object')
  })

  it('throws when version is missing', () => {
    expect(() => validateProjectFile({ features: [] })).toThrow('missing version')
  })

  it('throws when version is newer than current', () => {
    expect(() =>
      validateProjectFile({ version: CAD_FILE_VERSION + 1, features: [] })
    ).toThrow('newer than this app')
  })

  it('throws when features is not an array', () => {
    expect(() =>
      validateProjectFile({ version: 1, features: 'not an array' })
    ).toThrow('features must be an array')
  })
})

// ─── Migration: extrude mode ────────────────────────────────

describe('validateProjectFile — extrude mode migration', () => {
  it('adds mode="blind" to old extrude features missing the field', () => {
    const data = {
      version: 1,
      features: [
        {
          id: 'extrude-1',
          name: 'Extrude',
          type: 'extrude',
          suppressed: false,
          sketchId: 'sketch-1',
          distance: 10,
          direction: 'normal',
          operation: 'boss',
          // Note: no 'mode' field — this simulates an old project file
        },
      ],
    }
    const result = validateProjectFile(data)
    expect((result[0] as any).mode).toBe('blind')
  })

  it('does not overwrite an existing mode field', () => {
    const data = {
      version: 1,
      features: [
        {
          id: 'extrude-1',
          name: 'Extrude',
          type: 'extrude',
          suppressed: false,
          sketchId: 'sketch-1',
          distance: 10,
          direction: 'normal',
          operation: 'boss',
          mode: 'throughAll',
        },
      ],
    }
    const result = validateProjectFile(data)
    expect((result[0] as any).mode).toBe('throughAll')
  })

  it('does not add mode to non-extrude features', () => {
    const data = {
      version: 1,
      features: [
        {
          id: 'fillet-1',
          name: 'Fillet',
          type: 'fillet',
          suppressed: false,
          radius: 2,
        },
      ],
    }
    const result = validateProjectFile(data)
    expect('mode' in result[0]).toBe(false)
  })
})
