/**
 * Project file format utilities.
 *
 * The project file is a plain JSON file with a `.cad.json` extension.
 * All data is serializable — features are plain objects.
 */

import type { Feature } from './featureTypes'

export const CAD_FILE_VERSION = 1

export interface ProjectFile {
  version: number
  features: Feature[]
}

/** Serialize the feature list to a downloadable JSON file. */
export function saveProject(features: Feature[], filename = 'project.cad.json'): void {
  const data: ProjectFile = { version: CAD_FILE_VERSION, features }
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Load and parse a project file from user input. Returns features on success. */
export function loadProjectFile(file: File): Promise<Feature[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string
        const parsed: unknown = JSON.parse(text)
        const validated = validateProjectFile(parsed)
        resolve(validated)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function validateProjectFile(data: unknown): Feature[] {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid project file: not an object')
  }
  const obj = data as Record<string, unknown>

  if (typeof obj.version !== 'number') {
    throw new Error('Invalid project file: missing version')
  }
  if (obj.version > CAD_FILE_VERSION) {
    throw new Error(`Project file version ${obj.version} is newer than this app (${CAD_FILE_VERSION})`)
  }
  if (!Array.isArray(obj.features)) {
    throw new Error('Invalid project file: features must be an array')
  }

  // Migrate old features that may be missing newer fields
  const features = obj.features as Feature[]
  for (const f of features) {
    if (f.type === 'extrude') {
      // Extrude mode was added later — default to 'blind' for backward compatibility
      if (!('mode' in f) || !(f as any).mode) {
        (f as any).mode = 'blind'
      }
    }
  }

  return features
}
