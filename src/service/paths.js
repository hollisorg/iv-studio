// Where IV Studio keeps its data and finds its bundled resources, for both the app and the MCP server.
import fs from 'node:fs'
import path from 'node:path'

export function dataDir() {
  if (process.env.IV_STUDIO_DATA) return process.env.IV_STUDIO_DATA
  const base = process.env.APPDATA || path.join(process.env.HOME || '.', '.config')
  return path.join(base, 'IV Studio')
}

// Packaged: <install>/resources/resources. Dev and the built MCP script: the repo's resources folder.
export function resourcesDir(hint) {
  // Built code sits in out/main or, when shared between entries, out/main/chunks.
  const candidates = [hint, process.resourcesPath && path.join(process.resourcesPath, 'resources'), path.resolve(__dirname, '../../resources'), path.resolve(__dirname, '../../../resources'), path.resolve('resources')]
  for (const c of candidates) if (c && fs.existsSync(path.join(c, 'workflows', 'iv_studio_api.json'))) return c
  throw new Error('IV Studio resources not found')
}

// comfyApiKey is stored encrypted by the app (Electron safeStorage); it is never sent to the window.
// target: 'local' (comfyUrl) or 'cloud' (cloud.url behind the gate, cloudToken; both set by the Cloud page).
const DEFAULT_SETTINGS = { comfyUrl: 'http://127.0.0.1:8188', window: null, promptEngine: 'local', ollamaModel: 'qwen3-vl:8b-instruct', comfyApiKey: null, target: 'local', cloud: null, cloudToken: null, models: {} }

export function readSettings(dir = dataDir()) {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8')) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function writeSettings(patch, dir = dataDir()) {
  const next = { ...readSettings(dir), ...Object.fromEntries(Object.entries(patch || {}).filter(([k]) => k in DEFAULT_SETTINGS)) }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(next, null, 2))
  return next
}
