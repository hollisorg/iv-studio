// Ready-made characters (resources/characters/catalog.json): a face picture shipped with IV Studio and a
// character LoRA downloaded on request into ComfyUI's loras folder, checked against its sha256, then saved
// as a character preset. Downloads resume from a .part file like the model downloads on Setup.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export class CharacterCatalog {
  constructor({ studio, resourcesDir, voices = null }) {
    this.studio = studio
    this.voices = voices
    this.dir = path.join(resourcesDir, 'characters')
    this.downloads = new Map() // id -> progress 0..1
  }

  entries() {
    return JSON.parse(fs.readFileSync(path.join(this.dir, 'catalog.json'), 'utf8')).characters
  }

  // Each ready-made character with its picture's path, whether its LoRA is on this PC and whether it's a preset.
  async list() {
    const loras = await this.studio.loraNames().catch(() => [])
    const presets = this.studio.characters()
    return this.entries().map((c) => {
      const rel = c.lora && `${c.lora.folder}/${c.lora.file}`
      const present = !!rel && loras.some((l) => l.replace(/\\/g, '/').toLowerCase() === rel.toLowerCase())
      return { ...c, picture: path.join(this.dir, c.picture), available: !!c.lora, installed: present && presets.some((p) => p.id === c.id), loraPresent: present, downloading: this.downloads.get(c.id) ?? null }
    })
  }

  async install(id, onProgress) {
    const c = this.entries().find((x) => x.id === id)
    if (!c) throw new Error(`No ready-made character ${id}.`)
    if (!c.lora) throw new Error(`${c.name} isn't ready to download yet.`)
    if (this.downloads.has(id)) throw new Error(`${c.name} is already downloading.`)
    const root = await this.studio.loraRoot()
    const dest = path.join(root, ...c.lora.folder.split('/'), c.lora.file)
    this.downloads.set(id, 0)
    try {
      if (!(fs.existsSync(dest) && fs.statSync(dest).size === c.lora.size)) await this.fetch(c, dest, (p) => (this.downloads.set(id, p), onProgress?.(id, p)))
      const hash = createHash('sha256').update(fs.readFileSync(dest)).digest('hex')
      if (hash !== c.lora.sha256) {
        fs.rmSync(dest, { force: true })
        throw new Error(`${c.name}'s download didn't match its published file; try again.`)
      }
    } finally {
      this.downloads.delete(id)
    }
    const preset = { id: c.id, name: c.name, lora: `${c.lora.folder.replace(/\//g, '\\')}\\${c.lora.file}`, strength: c.strength, trigger: c.trigger, picture: path.join(this.dir, c.picture), catalog: true }
    const list = this.studio.characters()
    const old = list.find((p) => p.id === c.id)
    // an existing preset keeps its own extras (RefMods, a tuned strength); the LoRA and picture are filled in
    this.studio.saveCharacters(old ? list.map((p) => (p.id === c.id ? { ...preset, ...p, lora: preset.lora, picture: p.picture || preset.picture } : p)) : [...list, preset])
    await this.attachVoices()
    return this.list()
  }

  // A ready-made character that is a preset gets its bundled voice on the Voices page, once.
  async attachVoices() {
    if (!this.voices) return
    const have = this.voices.list()
    let list = this.studio.characters()
    let changed = false
    for (const c of this.entries()) {
      const p = list.find((x) => x.id === c.id)
      if (!c.voice || !p || p.voiceId || p.voiceDeclined) continue
      let v = have.find((x) => x.catalogId === c.id)
      if (!v) {
        v = await this.voices.create({ name: c.name, file: path.join(this.dir, c.voice.file), text: c.voice.text, description: c.voice.description, seed: c.voice.seed, engine: c.voice.engine, kind: 'ready' }).catch(() => null)
        if (!v) continue
        v = this.voices.write({ ...v, catalogId: c.id })
      }
      list = list.map((x) => (x.id === c.id ? { ...x, voiceId: v.id } : x))
      changed = true
    }
    if (changed) this.studio.saveCharacters(list)
  }

  async fetch(c, dest, onProgress) {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const part = `${dest}.part`
    const have = fs.existsSync(part) ? fs.statSync(part).size : 0
    const res = await fetch(c.lora.url, { headers: have ? { Range: `bytes=${have}-` } : {} })
    if (!res.ok && res.status !== 206) throw new Error(`Couldn't download ${c.name} (${res.status}).`)
    const out = fs.createWriteStream(part, { flags: res.status === 206 ? 'a' : 'w' })
    let got = res.status === 206 ? have : 0
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r))
      got += chunk.length
      onProgress(Math.min(1, got / c.lora.size))
    }
    await new Promise((r) => out.end(r))
    fs.renameSync(part, dest)
  }
}
