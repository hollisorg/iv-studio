// LoRAs from Civitai, and the LoRAs already on this PC, shown as pictures rather than file names.
// Civitai's public API (civitai.com/api/v1) needs no account to search; downloading a file needs the
// person's own Civitai API key (made on civitai.com: profile menu > Account settings > API keys). Mature
// LoRAs come from civitai.red, Civitai's unrestricted address, and only when the person has turned
// "Show mature LoRAs" on in Settings. Models and previews Civitai flags as a real person (poi) or a minor
// are never shown, in any mode.
// Installed LoRAs are identified by the SHA-256 of the file (Civitai's by-hash lookup), the way
// Pixaroma's LoRA Loader does it; the results, a small preview clip and the person's own settings for each
// LoRA (favourite, strength, trigger words) are kept in the data folder's loras/.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { comboOptions } from './setup.js'

export const CIVITAI_SITES = { safe: 'https://civitai.com', mature: 'https://civitai.red' }
export const LORA_BASE = 'MiniMax H3'
// Filter chips: Civitai tags the H3 LoRAs most often carry (checked 2026-10-29).
export const LORA_TAGS = [
  ['', 'All'],
  ['style', 'Style'],
  ['concept', 'Concept'],
  ['cinematic', 'Cinematic'],
  ['motion', 'Motion'],
  ['camera', 'Camera'],
  ['effect', 'Effect'],
  ['turbo', 'Speed'],
  ['tool', 'Tool']
]
export const LORA_SORTS = ['Most Downloaded', 'Highest Rated', 'Newest']
const PREVIEW_WIDTH = 450
// Civitai's content levels are bit flags: 1 PG, 2 PG-13, 4 R, 8 X, 16 XXX. Safe mode shows PG and PG-13.
const SAFE_LEVEL = 2

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
const slug = (s) => String(s || 'lora').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_|_$/g, '').slice(0, 60) || 'lora'
const now = () => new Date().toISOString()
// Civitai descriptions are HTML; the app shows plain text.
const plain = (html) =>
  String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()

// A small version of a Civitai picture or clip: 450 px wide, clips transcoded to MP4.
export function previewUrl(img) {
  try {
    const u = new URL(img.url)
    const [key, id, ...rest] = u.pathname.split('/').filter(Boolean)
    const last = rest.at(-1)
    const video = img.type === 'video'
    const name = last && last.includes('.') ? last.replace(/\.\w+$/, video ? '.mp4' : '.jpeg') : video ? 'preview.mp4' : 'preview.jpeg'
    return `${u.origin}/${key}/${id}/${video ? `transcode=true,width=${PREVIEW_WIDTH},optimized=true` : `width=${PREVIEW_WIDTH},optimized=true`}/${name}`
  } catch {
    return null
  }
}

export class Civitai {
  // key(): the person's Civitai API key or null. mature(): whether "Show mature LoRAs" is on.
  constructor({ dataDir, comfy, key = () => null, mature = () => false, onProgress }) {
    this.dir = path.join(dataDir, 'loras')
    this.comfy = comfy
    this.key = key
    this.mature = mature
    this.onProgress = onProgress || (() => {})
    this.downloads = new Map() // versionId -> {status, received, total, error, name}
  }

  site = () => (this.mature() ? CIVITAI_SITES.mature : CIVITAI_SITES.safe)
  libraryFile = () => path.join(this.dir, 'library.json')
  library = () => readJson(this.libraryFile(), { files: {}, prefs: {} })
  saveLibrary = (lib) => writeJson(this.libraryFile(), lib)

  async api(route, { timeout = 30000 } = {}) {
    const key = this.key()
    let res
    try {
      res = await fetch(`${this.site()}/api/v1${route}`, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeout) })
    } catch (err) {
      throw new Error(`Couldn't reach Civitai (${err.name === 'TimeoutError' ? 'it took too long' : err.message}).`)
    }
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) throw new Error('Civitai refused the request. Check your Civitai API key in Settings.')
    if (!res.ok) throw new Error(`Civitai answered ${res.status}.`)
    return res.json()
  }

  // Whether a model, version or picture may be shown in the current mode.
  allowed(item) {
    if (!item || item.poi || item.minor) return false
    return this.mature() || (item.nsfwLevel ?? 1) <= SAFE_LEVEL || item.nsfw === false
  }
  previews(images, max = 6) {
    return (images || [])
      .filter((i) => !i.poi && !i.minor && (this.mature() || (i.nsfwLevel ?? 1) <= SAFE_LEVEL))
      .slice(0, max)
      .map((i) => ({ url: previewUrl(i), type: i.type === 'video' ? 'video' : 'image', width: i.width, height: i.height, mature: (i.nsfwLevel ?? 1) > SAFE_LEVEL }))
      .filter((p) => p.url)
  }
  // The file a version downloads: its primary SafeTensors model file.
  pickFile(version) {
    const files = (version?.files || []).filter((f) => f.type === 'Model' || /\.safetensors$/i.test(f.name))
    return files.find((f) => f.primary) || files.find((f) => /\.safetensors$/i.test(f.name)) || files[0] || null
  }
  summary(m) {
    const v = m.modelVersions?.[0]
    const file = this.pickFile(v)
    const installed = this.installedShas()
    return {
      id: m.id,
      name: m.name,
      creator: m.creator?.username || null,
      tags: (m.tags || []).slice(0, 6),
      downloads: m.stats?.downloadCount || 0,
      likes: m.stats?.thumbsUpCount || 0,
      mature: !!m.nsfw,
      version: v ? { id: v.id, name: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords || [] } : null,
      file: file ? { id: file.id, name: file.name, size: Math.round(file.sizeKB * 1024), sha256: file.hashes?.SHA256?.toLowerCase() || null } : null,
      // the newest version's clips, or an earlier version's when it has none to show
      previews: this.previews((m.modelVersions || []).find((x) => this.previews(x.images, 1).length)?.images, 2),
      installed: !!(file?.hashes?.SHA256 && installed.has(file.hashes.SHA256.toLowerCase()))
    }
  }

  // One page of H3 LoRAs. cursor: from the previous page's next.
  async search({ query = '', tag = '', sort = LORA_SORTS[0], cursor = null, limit = 24 } = {}) {
    const q = new URLSearchParams({ types: 'LORA', baseModels: LORA_BASE, limit: String(Math.min(Math.max(limit, 1), 100)), sort, nsfw: this.mature() ? 'true' : 'false' })
    if (query.trim()) q.set('query', query.trim())
    if (tag) q.set('tag', tag)
    if (cursor) q.set('cursor', String(cursor))
    const page = await this.api(`/models?${q}`)
    const items = (page?.items || []).filter((m) => this.allowed(m)).map((m) => this.summary(m))
    return { items, next: page?.metadata?.nextCursor || null, mature: this.mature() }
  }

  // Everything about one model: its versions, example clips, trigger words, licence and description.
  async model(id) {
    const m = await this.api(`/models/${Number(id)}`)
    if (!m || !this.allowed(m)) throw new Error('That LoRA isn’t available here.')
    const installed = this.installedShas()
    return {
      ...this.summary(m),
      description: plain(m.description).slice(0, 4000),
      url: `${this.site()}/models/${m.id}`,
      licence: { commercial: (m.allowCommercialUse || []).length > 0, commercialUses: m.allowCommercialUse || [], derivatives: !!m.allowDerivatives, creditNeeded: !m.allowNoCredit },
      versions: (m.modelVersions || [])
        .filter((v) => v.baseModel === LORA_BASE)
        .map((v) => {
          const f = this.pickFile(v)
          return { id: v.id, name: v.name, baseModel: v.baseModel, publishedAt: v.publishedAt, trainedWords: v.trainedWords || [], notes: plain(v.description).slice(0, 1500), file: f ? { id: f.id, name: f.name, size: Math.round(f.sizeKB * 1024), sha256: f.hashes?.SHA256?.toLowerCase() || null } : null, previews: this.previews(v.images, 8), installed: !!(f?.hashes?.SHA256 && installed.has(f.hashes.SHA256.toLowerCase())) }
        })
    }
  }

  // ---------- this PC's LoRAs ----------
  async loraFolders() {
    const folders = await this.comfy.req('/experiment/models')
    return folders.find((f) => f.name === 'loras')?.folders || []
  }
  installedShas() {
    return new Set(Object.values(this.library().files).map((f) => f.sha256).filter(Boolean))
  }

  // Every LoRA ComfyUI can load, with what's known about it.
  async yours() {
    const info = await this.comfy.objectInfo('LoraLoaderModelOnly')
    const names = comboOptions(info, 'LoraLoaderModelOnly', 'lora_name') || []
    const folders = await this.loraFolders()
    const lib = this.library()
    const items = []
    for (const name of names) {
      const file = folders.map((d) => path.join(d, ...name.split(/[\\/]/))).find((p) => fs.existsSync(p))
      const st = file ? fs.statSync(file) : null
      const known = lib.files[name]
      const fresh = known && st && known.size === st.size && known.mtime === st.mtimeMs
      const civitai = fresh ? known.civitai : null
      // made for H3: Civitai says so, or the file sits in or is named for MiniMax H3
      const h3 = civitai ? civitai.baseModel === LORA_BASE : /minimax[ _-]?h3|(^|[\\/_ -])h3([\\/_ -]|$)|mmh3/i.test(name)
      items.push({ name, file: file || null, size: st?.size || null, sha256: fresh ? known.sha256 : null, civitai, checked: fresh ? known.checkedAt : null, h3, prefs: lib.prefs[name] || {} })
    }
    return items
  }

  // Hashes one installed LoRA and looks it up on Civitai; keeps the answer and a preview clip.
  async identify(name) {
    const items = await this.yours()
    const it = items.find((x) => x.name === name)
    if (!it?.file) throw new Error(`ComfyUI has no LoRA called ${name}.`)
    const st = fs.statSync(it.file)
    const hash = createHash('sha256')
    await pipeline(fs.createReadStream(it.file), new Transform({ transform: (c, _e, cb) => (hash.update(c), cb()) }))
    const sha256 = hash.digest('hex')
    const v = await this.api(`/model-versions/by-hash/${sha256}`)
    let civitai = null
    if (v && !v.poi && !v.minor && !v.model?.poi && !v.model?.minor) {
      const shown = this.previews(v.images, 1)[0] || null
      civitai = { modelId: v.modelId, versionId: v.id, name: v.model?.name || v.name, version: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords || [], mature: !!v.model?.nsfw, preview: shown ? await this.cachePreview(v.id, shown).catch(() => null) : null }
    }
    const lib = this.library()
    lib.files[name] = { size: st.size, mtime: st.mtimeMs, sha256, civitai, checkedAt: now() }
    this.saveLibrary(lib)
    return { ...it, sha256, civitai, checked: lib.files[name].checkedAt }
  }

  // The person's own settings for a LoRA: favourite, strength, trigger words, whether they go in the prompt.
  setPrefs(name, patch) {
    const lib = this.library()
    const cur = lib.prefs[name] || {}
    for (const k of ['favourite', 'strength', 'triggers', 'autoTrigger', 'picture']) if (patch[k] !== undefined) cur[k] = patch[k]
    lib.prefs[name] = cur
    this.saveLibrary(lib)
    return cur
  }

  async cachePreview(versionId, preview) {
    const ext = preview.type === 'video' ? '.mp4' : '.jpeg'
    const file = path.join(this.dir, 'previews', `${versionId}${ext}`)
    if (fs.existsSync(file)) return { file, type: preview.type, mature: preview.mature }
    const res = await fetch(preview.url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) throw new Error(`preview ${res.status}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
    return { file, type: preview.type, mature: preview.mature }
  }

  // ---------- downloads ----------
  downloadState = () => Object.fromEntries(this.downloads)
  set(versionId, patch) {
    const s = { ...this.downloads.get(versionId), ...patch }
    this.downloads.set(versionId, s)
    this.onProgress({ versionId, ...s })
    return s
  }

  // Downloads a version's file into ComfyUI's loras folder (Civitai/<model>/), checked against the SHA-256
  // Civitai publishes. Returns the LoRA name ComfyUI loads it by.
  async download({ modelId, versionId }) {
    const key = this.key()
    if (!key) throw new Error('Downloading from Civitai needs your own Civitai API key: add it in Settings → Civitai. It’s free, from civitai.com → profile menu → Account settings → API keys.')
    const m = await this.model(modelId)
    const v = m.versions.find((x) => x.id === Number(versionId)) || m.versions[0]
    if (!v?.file) throw new Error('That version has no file to download.')
    if (this.downloads.get(v.id)?.status === 'downloading') throw new Error('That LoRA is already downloading.')
    const [root] = await this.loraFolders()
    if (!root) throw new Error('ComfyUI has no loras folder.')
    const rel = path.join('Civitai', slug(m.name), v.file.name)
    const target = path.join(root, rel)
    if (fs.existsSync(target)) return this.finish(m, v, target, rel)
    const part = `${target}.part`
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const free = fs.statfsSync(path.dirname(target))
    if (free.bavail * free.bsize < v.file.size + 1024 ** 3) throw new Error(`Not enough free space for ${(v.file.size / 1024 ** 3).toFixed(1)} GB.`)
    this.set(v.id, { status: 'downloading', name: m.name, received: 0, total: v.file.size, error: null })
    try {
      // the key goes in the query: Civitai redirects to a signed storage URL, and a redirect drops headers
      const url = `${this.site()}/api/download/models/${v.id}?type=Model&format=SafeTensor&token=${encodeURIComponent(key)}`
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(6 * 60 * 60 * 1000) })
      if (res.status === 401 || res.status === 403) throw new Error('Civitai refused the download. Check your API key, and that this LoRA isn’t limited to early-access buyers.')
      if (!res.ok) throw new Error(`Civitai answered ${res.status}.`)
      const hash = createHash('sha256')
      let received = 0
      let last = 0
      const counter = new Transform({
        transform: (chunk, _e, cb) => {
          hash.update(chunk)
          received += chunk.length
          if (Date.now() - last > 500) {
            last = Date.now()
            this.set(v.id, { received })
          }
          cb(null, chunk)
        }
      })
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(part))
      this.set(v.id, { status: 'verifying', received })
      const digest = hash.digest('hex')
      if (v.file.sha256 && digest !== v.file.sha256) {
        fs.rmSync(part, { force: true })
        throw new Error('The download didn’t match the checksum Civitai publishes, so it was removed. Try again.')
      }
      fs.renameSync(part, target)
      return await this.finish(m, v, target, rel, digest)
    } catch (err) {
      this.set(v.id, { status: 'error', error: err.message })
      throw err
    }
  }

  async finish(m, v, target, rel, sha256 = v.file.sha256) {
    const st = fs.statSync(target)
    const lib = this.library()
    const shown = v.previews[0] || m.previews[0] || null
    lib.files[rel] = { size: st.size, mtime: st.mtimeMs, sha256, civitai: { modelId: m.id, versionId: v.id, name: m.name, version: v.name, baseModel: v.baseModel, trainedWords: v.trainedWords, mature: m.mature, preview: shown ? await this.cachePreview(v.id, shown).catch(() => null) : null }, checkedAt: now() }
    this.saveLibrary(lib)
    this.set(v.id, { status: 'done', received: st.size, path: target, lora: rel })
    return { lora: rel, path: target, sha256, name: m.name, trainedWords: v.trainedWords }
  }
}
