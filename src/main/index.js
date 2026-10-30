import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { comfyFolders, dataDir, incognitoDir, readSettings, resourcesDir, writeSettings } from '../service/paths'
import { pasteMessage, skillMarkdown, readGuide } from '../service/agent'
import { Cloud, GPUS } from '../service/cloud'
import { Edits, FORMATS } from '../service/edits'
import { DEFAULT_TRACKS } from '../service/timeline'
import { SCENE_KINDS, SIZZLE_FORMATS, Sizzles } from '../service/sizzle'
import { initUpdater, updateState } from './updater'
import { MediaTools } from '../service/media'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ModelInstaller } from '../service/models'
import { CONTEXT_IR_PRICE, ollamaStatus, pullModel } from '../service/prompter'
import { Studio } from '../service/studio'
import { SCENES, TALKS, TRAIN_GPUS, Trainings } from '../service/training'
import { Shinobi } from '../service/shinobi'
import { CharacterCatalog } from '../service/characters'
import { Replace, RESOLUTIONS, MAX_CHARACTERS, DEFAULT_TONE, OPENJUTSU } from '../service/replace'
import { Voices } from '../service/voices'
import { ACE_KEYS, Music, MUSIC_DEFAULTS, MUSIC_ENGINES } from '../service/music'
import { Images } from '../service/images'
import { Civitai, CIVITAI_SITES, LORA_SORTS, LORA_TAGS } from '../service/civitai'
import { Comfy } from '../service/comfy'

if (process.env.IV_STUDIO_USER_DATA) app.setPath('userData', process.env.IV_STUDIO_USER_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
// ComfyUI refuses cross-site browser requests, so the window loads outputs through ivmedia://view?...,
// which the main process fetches from ComfyUI's /view (Range passed through so videos can seek).
// The editor plays local media through ivfile://local/?p=<path> (seekable, any media file on this PC).
protocol.registerSchemesAsPrivileged([
  { scheme: 'ivmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  { scheme: 'ivfile', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])
const MEDIA_FILE = /\.(mp4|mov|webm|mkv|m4v|wav|mp3|m4a|flac|ogg|aac|png|jpe?g|webp|bmp)$/i
const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska', wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', flac: 'audio/flac', ogg: 'audio/ogg', aac: 'audio/aac', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp' }
function serveFile(req) {
  const file = new URL(req.url).searchParams.get('p')
  if (!file || !MEDIA_FILE.test(file) || !fs.existsSync(file)) return new Response('Not found', { status: 404 })
  const size = fs.statSync(file).size
  const type = MIME[file.split('.').pop().toLowerCase()] || 'application/octet-stream'
  // The window's page is another origin; it reads files with fetch() too (the media editor's waveform).
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '')
  if (!range) return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { ...cors, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' } })
  const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]))
  const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
    status: 206,
    headers: { ...cors, 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes' }
  })
}

const BG = '#100c0e'
// A copy started with its own user data (testing beside the installed app) says so everywhere.
const TEST_COPY = !!process.env.IV_STUDIO_USER_DATA
// Settings and keys live in BASE. Everything made lives in DATA: BASE itself, or BASE\incognito while
// Incognito is on (see incognitoDir). The switch takes a restart, so one run never mixes the two.
const BASE = process.env.IV_STUDIO_DATA || dataDir()
const INCOGNITO = !!readSettings(BASE).incognito
const DATA = INCOGNITO ? incognitoDir(BASE) : BASE
// Downloads and exports: Videos\IV Studio, or a folder inside the Incognito data
const videosDir = () => (INCOGNITO ? path.join(DATA, 'videos') : path.join(app.getPath('videos'), 'IV Studio'))
let win = null
let studio = null
let stopWatch = null
let installer = null
let trainings = null
let replace = null
let catalog = null
let voices = null
let music = null
let images = null
let civitai = null
const pending = new Set() // job ids the window is waiting on

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

// Secrets at rest (the Comfy.org key, the cloud token) are encrypted with Windows' per-user key.
const seal = (text) => (text ? safeStorage.encryptString(text).toString('base64') : null)
const unseal = (enc) => {
  if (!enc) return null
  try {
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return null
  }
}

function makeStudio() {
  stopWatch?.()
  const s = readSettings(BASE)
  const cloud = s.target === 'cloud' && s.cloud?.url ? { comfyUrl: s.cloud.url, comfyToken: unseal(s.cloudToken) } : { comfyUrl: s.comfyUrl }
  studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), models: s.models, ...cloud })
  studio.comfy.folders = comfyFolders(s, INCOGNITO)
  if (trainings) trainings.studio = studio
  if (replace) replace.studio = studio
  if (catalog) catalog.studio = studio
  if (music) music.studio = studio
  if (images) images.studio = studio
  // LoRAs live on this PC's ComfyUI, also when renders go to the cloud
  if (civitai) civitai.comfy = new Comfy(s.comfyUrl)
  // nothing of IV Studio's own holds the GPU while ComfyUI renders (see Studio.makeRoom)
  studio.beforeRender = () => voices?.release()
  if (!installer?.running) installer = new ModelInstaller({ comfy: studio.comfy, manifest: studio.manifest, onUpdate: (u) => send('models:update', u) })
  stopWatch = studio.watch((msg) => {
    if (msg.type === 'progress' || msg.type === 'executing' || msg.type === 'execution_success' || msg.type === 'execution_error') pump()
  })
}

// Refresh every job the window is watching and push the new state; finished jobs stop being watched.
let pumping = false
async function pump() {
  if (pumping) return
  pumping = true
  try {
    for (const id of [...pending]) {
      try {
        const job = await studio.refreshJob(id)
        send('jobs:update', job)
        if (['success', 'error', 'cancelled'].includes(job.status)) pending.delete(id)
      } catch (err) {
        send('jobs:update', { id, status: 'unknown', note: err.message })
      }
    }
  } finally {
    pumping = false
  }
}
setInterval(pump, 4000)

function savedBounds() {
  const b = readSettings(BASE).window
  if (!b) return { width: 1380, height: 900 }
  const visible = screen.getAllDisplays().some((d) => b.x < d.workArea.x + d.workArea.width - 100 && b.x + b.width > d.workArea.x + 100)
  return visible ? b : { width: b.width, height: b.height }
}

function createWindow() {
  win = new BrowserWindow({
    ...savedBounds(),
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: BG,
    title: TEST_COPY ? 'IV Studio (TEST COPY)' : 'IV Studio',
    icon: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: '#f1ede5', height: 40 },
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) e.preventDefault()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.once('ready-to-show', () => win.show())
  if (TEST_COPY) win.on('page-title-updated', (e) => e.preventDefault())
  win.on('close', () => writeSettings({ window: win.getBounds() }, BASE))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const localCopy = (file) => studio.localCopy(file, videosDir())

// Errors cross IPC as plain messages so the window can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      return { ok: false, error: err.message, errors: err.errors }
    }
  })
}

function mcpCommand() {
  const exe = process.execPath
  const script = app.isPackaged ? path.join(process.resourcesPath, 'app.asar', 'out', 'main', 'mcp.js') : path.join(app.getAppPath(), 'out', 'main', 'mcp.js')
  return { command: exe, args: [script], env: { ELECTRON_RUN_AS_NODE: '1' } }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  makeStudio()
  protocol.handle('ivfile', serveFile)
  protocol.handle('ivmedia', (req) => {
    const u = new URL(req.url)
    if (u.hostname !== 'view') return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
    return fetch(`${studio.comfy.url}/view${u.search}`, { headers: studio.comfy.headers(range ? { Range: range } : {}) })
  })

  const links = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'links.json'), 'utf8'))
    } catch {
      return { website: 'https://infinitevariance.ai', modalSignup: null }
    }
  })()
  handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA, mcp: mcpCommand(), testCopy: TEST_COPY, incognito: INCOGNITO, links }))
  // The window never sees the Comfy.org or Civitai key, only whether one is saved.
  const publicSettings = (s) => {
    const { comfyApiKey, cloudToken, civitaiKey, ...rest } = s
    return { ...rest, hasComfyKey: !!comfyApiKey, hasCloudToken: !!cloudToken, hasCivitaiKey: !!civitaiKey }
  }
  const comfyKey = () => unseal(readSettings(BASE).comfyApiKey)
  handle('settings:get', () => publicSettings(readSettings(BASE)))
  handle('settings:setComfyKey', (key) => {
    const k = String(key || '').trim()
    if (k && !safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the key cannot be stored safely.')
    return publicSettings(writeSettings({ comfyApiKey: seal(k) }, BASE))
  })
  handle('settings:setCivitaiKey', (key) => {
    const k = String(key || '').trim()
    if (k && !safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the key cannot be stored safely.')
    return publicSettings(writeSettings({ civitaiKey: seal(k) }, BASE))
  })
  // ---------- edits (the timeline editor) ----------
  const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
  const edits = new Edits({
    dataDir: DATA,
    ffmpeg: unpacked(ffmpegStatic.ffmpegPath),
    ffprobe: unpacked(ffmpegStatic.ffprobePath),
    fontFile: path.join(resourcesDir(path.join(app.getAppPath(), 'resources')), 'fonts', 'BarlowCondensed-SemiBold.ttf')
  })
  // Crop and trim references before they go to H3 (Create's media editor).
  const mediaTools = new MediaTools({ dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
  // ---------- Audio: voices (IV Studio's own engine speaks: VoxCPM2 and Whisper in its data folder) ----------
  voices = new Voices({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), ffmpeg: edits.ffmpeg, onLog: (line) => send('voices:log', line), comfy: () => (readSettings(BASE).target === 'cloud' ? null : studio.comfy) })
  handle('voices:status', () => voices.status())
  handle('voices:setup', () => voices.setup())
  handle('voices:list', async () => (await catalog?.attachVoices().catch(() => {}), voices.list()))
  handle('voices:design', (opts) => voices.design(opts))
  handle('voices:create', (opts) => voices.create(opts))
  handle('voices:update', (id, patch) => voices.update(id, patch))
  handle('voices:delete', (id) => {
    const r = voices.delete(id)
    studio.saveCharacters(studio.characters().map((c) => (c.voiceId === id ? { ...c, voiceId: null } : c)))
    return r
  })
  handle('voices:speak', (opts) => voices.speak(opts))
  handle('voices:lines', (voiceId) => voices.lines(voiceId))
  handle('voices:deleteLine', (id) => voices.deleteLine(id))
  handle('voices:transcribe', (file) => voices.transcribe(file))
  // ---------- Audio: music (MiniMax Music 3 and ACE-Step 1.5 on this PC's ComfyUI) ----------
  music = new Music({ studio, dataDir: DATA, probe: (f) => edits.probe(f) })
  handle('music:meta', () => ({ engines: MUSIC_ENGINES, defaults: MUSIC_DEFAULTS, keys: ACE_KEYS }))
  handle('music:status', () => music.status())
  handle('music:create', async (opts) => {
    await voices.release()
    return music.create(opts)
  })
  handle('music:list', () => music.list())
  handle('music:get', (id) => music.get(id))
  handle('music:rename', (id, name) => music.rename(id, name))
  handle('music:cancel', (id) => music.cancel(id))
  handle('music:delete', (id) => music.delete(id))
  // A file onto the end of a track of an edit (A1 for sound, V1 for video); no edit id makes a new edit.
  const putOnEdit = async (file, name, editId, type) => {
    const e = editId ? edits.get(editId) : edits.create(name)
    const m = await edits.addMedia(file, { type, label: name })
    const track = m.kind === 'audio' ? 'A1' : 'V1'
    const start = Math.max(0, ...e.clips.filter((c) => c.track === track).map((c) => c.start + (c.out - c.in)))
    const clip = { id: `c${m.id}`, track, media: m.id, start, in: 0, out: m.duration || 4, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }
    return edits.save(e.id, { media: { ...e.media, [m.id]: m }, clips: [...e.clips, clip] })
  }
  handle('music:toEdit', async (id, editId = null) => {
    const song = await music.get(id)
    if (!song.file) throw new Error('That song has not finished yet.')
    return putOnEdit(song.file, song.name, editId, 'music')
  })
  // ---------- Create -> Image: pictures from the person's own image models ----------
  images = new Images({ studio, dataDir: DATA })
  handle('images:status', () => images.status())
  handle('images:create', async (opts) => {
    await voices.release()
    return images.create(opts)
  })
  handle('images:list', () => images.list())
  handle('images:get', (id) => images.get(id))
  handle('images:cancel', (id) => images.cancel(id))
  handle('images:delete', (id) => images.delete(id))
  handle('images:toEdit', async (file, name, editId = null) => putOnEdit(file, name, editId, 'iv'))
  // ---------- LoRAs: Civitai's H3 LoRAs and the ones on this PC ----------
  civitai = new Civitai({ dataDir: DATA, comfy: new Comfy(readSettings(BASE).comfyUrl), key: () => unseal(readSettings(BASE).civitaiKey), mature: () => !!readSettings(BASE).civitaiMature, onProgress: (u) => send('loras:progress', u) })
  handle('loras:meta', () => ({ tags: LORA_TAGS, sorts: LORA_SORTS, sites: CIVITAI_SITES, mature: !!readSettings(BASE).civitaiMature, hasKey: !!readSettings(BASE).civitaiKey }))
  handle('loras:search', (opts) => civitai.search(opts))
  handle('loras:model', (id) => civitai.model(id))
  handle('loras:download', (opts) => civitai.download(opts))
  handle('loras:downloads', () => civitai.downloadState())
  handle('loras:yours', () => civitai.yours())
  handle('loras:identify', (name) => civitai.identify(name))
  handle('loras:prefs', (name, patch) => civitai.setPrefs(name, patch))
  // ---------- Library: everything made in IV Studio, in one place ----------
  handle('library:all', () => {
    const items = studio.library().map((i) => ({ ...i, type: 'video' }))
    for (const e of edits.list()) {
      for (const x of edits.get(e.id).exports || []) if (x.file && fs.existsSync(x.file)) items.push({ key: `export:${x.file}`, type: 'video', group: 'Edit exports', label: `${e.name} · ${x.format || ''} ${x.fps || ''} fps`.trim(), at: x.at, file: { path: x.file }, set: `edit:${e.id}`, setName: e.name, variant: `${x.format || 'Export'} · ${x.fps || ''} fps`, rank: 0, editId: e.id })
    }
    for (const s of music.all()) if (s.file && fs.existsSync(s.file)) items.push({ key: `music:${s.id}`, type: 'music', group: 'Music', label: s.name, detail: `${s.engine === 'minimax' ? 'MiniMax Music 3' : 'ACE-Step 1.5'}${s.instrumental ? ' · instrumental' : ''}`, duration: s.duration, at: s.finishedAt || s.createdAt, file: { path: s.file }, set: `music:${s.id}`, setName: s.name, variant: 'Song', rank: 0 })
    for (const r of images.all()) (r.files || []).forEach((f, i) => fs.existsSync(f) && items.push({ key: `image:${r.id}:${i}`, type: 'image', group: 'Images', label: r.name, detail: `${r.familyLabel} · ${r.mode === 'edit' ? 'edit' : 'generate'}`, at: r.finishedAt || r.createdAt, file: { path: f }, set: `image:${r.id}`, setName: r.name, variant: `Picture ${i + 1}`, rank: i, imageId: r.id }))
    for (const l of voices.lines()) if (fs.existsSync(l.file)) items.push({ key: `line:${l.id}`, type: 'voice', group: 'Voice lines', label: l.text, detail: l.voice, duration: l.duration, at: l.createdAt, file: { path: l.file }, set: `line:${l.id}`, setName: l.text, variant: `Seed ${l.seed}`, rank: 0 })
    return items.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  })
  handle('library:toEdit', async (item, editId = null) => putOnEdit(await localCopy(item.file), item.label.slice(0, 60), editId, item.type === 'video' ? 'iv' : item.type))
  // ---------- characters: design, clips, training on Modal, pick ----------
  // ---------- Shinobi: the agent-driven editor (OpenKatana engine), and face likeness ----------
  const shinobi = new Shinobi({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), ffmpegDir: path.dirname(edits.ffmpeg), onLog: (line) => send('shinobi:log', line) })
  const briefFile = (id) => path.join(shinobi.projectDir(id), 'iv-brief.md')
  handle('shinobi:status', () => shinobi.status())
  handle('shinobi:install', () => shinobi.install())
  handle('shinobi:faceModels', () => shinobi.installFaceModels((p) => send('shinobi:faceProgress', p)))
  handle('shinobi:projects', () => shinobi.projects())
  handle('shinobi:delete', (id) => shinobi.deleteProject(id))
  handle('shinobi:project', (id) => ({ ...shinobi.project(id), brief: fs.existsSync(briefFile(id)) ? fs.readFileSync(briefFile(id), 'utf8') : '' }))
  handle('shinobi:create', (name) => shinobi.call('create_project', { name: name || 'Untitled film' }))
  handle('shinobi:saveBrief', (id, text) => fs.writeFileSync(briefFile(id), String(text)))
  // Files from a dialog, or IV Studio renders (library items); clips over 64 MB import fine through the engine.
  handle('shinobi:importFiles', async (id) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    for (const f of r.canceled ? [] : r.filePaths) await shinobi.call('import_media', { project_id: id, source: f, audio_only: false })
    return shinobi.project(id)
  })
  handle('shinobi:importRender', async (id, item) => {
    await shinobi.call('import_media', { project_id: id, source: await localCopy(item.file) })
    return shinobi.project(id)
  })
  handle('shinobi:importAudioOf', async (id, file) => {
    await shinobi.call('import_media', { project_id: id, source: file, audio_only: true })
    return shinobi.project(id)
  })
  handle('shinobi:presets', async () => (await shinobi.call('get_capabilities')).presets)
  handle('shinobi:call', (tool, args) => shinobi.call(tool, args))
  handle('shinobi:tools', () => shinobi.tools())
  // A new edit holding one video on V1 (a Shinobi or Replace result).
  const editWith = async (video, name, type) => {
    const e = edits.create(name || 'Untitled edit')
    const m = await edits.addMedia(video, { type, label: name })
    return edits.save(e.id, { media: { [m.id]: m }, clips: [{ id: 'c1', track: 'V1', media: m.id, start: 0, in: 0, out: m.duration || 4, fadeIn: 0, fadeOut: 0, volume: 1, muted: false }] })
  }
  handle('shinobi:addToEdit', (video, name) => editWith(video, name || 'Shinobi cut', 'shinobi'))

  // ---------- Replace: swap people or objects in a video (OpenJutsu's workflows) ----------
  replace = new Replace({ studio, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), dataDir: DATA, ffmpeg: edits.ffmpeg, ffprobe: edits.ffprobe })
  handle('replace:meta', () => ({ resolutions: RESOLUTIONS, maxCharacters: MAX_CHARACTERS, tone: DEFAULT_TONE, openjutsu: OPENJUTSU }))
  handle('replace:check', (mode) => replace.check(mode))
  handle('replace:run', (input) => replace.run({ ...input, character: input.characterId ? studio.characters().find((c) => c.id === input.characterId) : null }))
  handle('replace:history', () => replace.history())
  handle('replace:toEdit', async (file, name) => editWith(await localCopy(file), name, 'replace'))
  // Trained characters' picked faces, as pictures for Replace.
  handle('replace:characterFaces', async () => {
    const out = []
    for (const t of trainings.list()) {
      if (!t.cover) continue
      try {
        out.push({ id: t.id, name: t.name, characterId: t.characterId, picture: await studio.localCopy(t.cover, path.join(DATA, 'trainings', t.id, 'stills')) })
      } catch {}
    }
    return out
  })

  trainings = new Trainings({
    shinobi,
    dataDir: DATA,
    resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')),
    studio,
    ffmpeg: edits.ffmpeg,
    ffprobe: edits.ffprobe,
    onLog: (line, id) => send('training:log', { id, line }),
    onChange: (id) => send('training:changed', { id }),
    voices
  })
  handle('training:meta', () => ({ gpus: TRAIN_GPUS, scenes: SCENES, talks: TALKS }))

  // ---------- Website sizzle: a web address in, a promo film out (captured site, storyboard, pieces, Shinobi) ----------
  const sizzles = new Sizzles({ dataDir: DATA, studio, music, voices, trainings, shinobi, onLog: (line) => send('sizzle:log', line) })
  handle('sizzle:meta', () => ({ formats: SIZZLE_FORMATS, kinds: SCENE_KINDS }))
  handle('sizzle:list', () => sizzles.list())
  handle('sizzle:create', (input) => sizzles.create(input))
  handle('sizzle:get', (id) => sizzles.refresh(id))
  handle('sizzle:savePlan', (id, plan) => sizzles.savePlan(id, plan))
  handle('sizzle:approve', (id) => sizzles.approve(id))
  handle('sizzle:makeAssets', (id) => sizzles.makeAssets(id))
  handle('sizzle:toShinobi', (id) => sizzles.toShinobi(id))
  handle('sizzle:firstCut', (id, opts) => sizzles.firstCut(id, opts))
  handle('sizzle:delete', (id) => sizzles.remove(id))
  handle('training:list', () => trainings.list())
  handle('training:create', (init) => trainings.create(init))
  handle('training:get', (id) => trainings.refresh(id))
  handle('training:save', (id, patch) => trainings.save(id, patch))
  handle('training:delete', (id) => trainings.remove(id))
  handle('training:designFaces', (id, opts) => trainings.designFaces(id, opts))
  handle('training:pickFace', (id, pick) => trainings.pickFace(id, pick))
  handle('training:designScenes', (id) => trainings.designScenes(id))
  handle('training:rerollStill', (id, stillId) => trainings.rerollStill(id, stillId))
  handle('training:pickStill', (id, stillId, pick) => trainings.pickStill(id, stillId, pick))
  handle('training:addStills', async (id, caption) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    return r.canceled ? trainings.get(id) : trainings.addStills(id, r.filePaths, caption)
  })
  handle('training:addClips', async (id, caption) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v'] }] })
    return r.canceled ? trainings.get(id) : trainings.addClips(id, r.filePaths, caption)
  })
  handle('training:setCaption', (id, kind, itemId, text) => trainings.setCaption(id, kind, itemId, text))
  handle('training:removeItem', (id, kind, itemId) => trainings.removeItem(id, kind, itemId))
  handle('training:makeClips', (id, opts) => trainings.makeClips(id, opts))
  handle('training:remakeClips', (id, clipIds) => trainings.remakeClips(id, clipIds))
  handle('training:rank', (id, opts) => trainings.rank(id, opts))
  handle('training:keepClip', (id, clipId, keep) => trainings.keepClip(id, clipId, keep))
  handle('training:estimate', (id, opts) => trainings.estimateFor(trainings.get(id), opts))
  handle('training:buildDataset', (id) => trainings.buildDataset(id))
  handle('training:openDataset', async (id) => shell.openPath((await trainings.buildDataset(id)).dir))
  handle('training:start', (id, opts) => trainings.startTraining(id, opts))
  handle('training:check', (id) => trainings.checkTraining(id))
  handle('training:stop', (id) => trainings.stopTraining(id))
  handle('training:checkpoints', (id) => trainings.listCheckpoints(id))
  handle('training:fetch', (id, epochs) => trainings.fetchCheckpoints(id, epochs))
  handle('training:test', (id, opts) => trainings.testCheckpoints(id, opts))
  handle('training:adopt', (id, epoch) => trainings.adopt(id, epoch))

  handle('media:probe', (file) => mediaTools.probe(file))
  handle('media:prepare', (opts) => mediaTools.prepare(opts))
  handle('edits:meta', () => ({ tracks: DEFAULT_TRACKS, formats: FORMATS }))
  handle('edits:list', () => edits.list())
  handle('edits:get', (id) => edits.get(id))
  handle('edits:create', (name) => edits.create(name))
  // An agent (the MCP server) can change edits and Settings -> Models too: an open edit reloads in the
  // window, and renders pick up the models. Saves from the window itself are not echoed back.
  const ownWrites = new Map() // edit id -> updatedAt of the window's last save
  handle('edits:save', (id, patch) => {
    const e = edits.save(id, patch)
    ownWrites.set(id, e.updatedAt)
    return e
  })
  const settle = new Map()
  const later = (key, fn) => {
    clearTimeout(settle.get(key))
    settle.set(key, setTimeout(fn, 200))
  }
  fs.mkdirSync(edits.dir, { recursive: true })
  fs.watch(edits.dir, (_, name) => {
    if (!name?.endsWith('.json')) return
    const id = name.slice(0, -5)
    later(id, () => {
      let e
      try {
        e = edits.get(id)
      } catch {
        return
      }
      if (e.updatedAt === ownWrites.get(id)) return
      ownWrites.set(id, e.updatedAt)
      send('edits:changed', { id, updatedAt: e.updatedAt })
    })
  })
  fs.watch(BASE, (_, name) => name === 'settings.json' && later('settings', () => (studio.models = readSettings(BASE).models || {})))
  handle('edits:delete', (id) => edits.remove(id))
  handle('edits:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    return Promise.all((r.canceled ? [] : r.filePaths).map((f) => edits.addMedia(f)))
  })
  handle('edits:library', () => studio.library())
  handle('edits:addOutput', async (item) => edits.addMedia(await localCopy(item.file), { type: 'iv', label: item.label }))
  handle('edits:export', (id) => edits.export(id, path.join(videosDir(), 'Edits'), (p) => send('edits:progress', { id, progress: p })))
  handle('edits:cancelExport', (id) => edits.cancelExport(id))
  handle('edits:filmstrip', (file, duration) => edits.filmstrip(file, duration))
  handle('edits:peaks', (file) => edits.peaks(file))
  // The editor's full-screen workspace: the window itself goes full screen too.
  handle('window:fullScreen', (on) => {
    win.setFullScreen(!!on)
    return win.isFullScreen()
  })

  // ---------- cloud (Modal, the user's own account) ----------
  const cloud = new Cloud({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), onLog: (line) => send('cloud:log', line) })
  let cloudBusy = null
  const cloudTask = async (label, fn) => {
    if (cloudBusy) throw new Error(`Still busy: ${cloudBusy}.`)
    cloudBusy = label
    try {
      return await fn()
    } finally {
      cloudBusy = null
    }
  }
  const saveCloud = (patch) => writeSettings({ cloud: { ...(readSettings(BASE).cloud || {}), ...patch } }, BASE)
  handle('cloud:status', async () => {
    const s = readSettings(BASE)
    return { toolkit: cloud.toolkitReady(), workspace: await cloud.workspace(), cloud: s.cloud, target: s.target, gpus: GPUS, busy: cloudBusy, hasToken: !!s.cloudToken }
  })
  handle('cloud:install', () => cloudTask('installing the cloud tools', () => cloud.installToolkit()))
  handle('cloud:signIn', () => cloudTask('signing in to Modal', async () => (await cloud.signIn(), cloud.workspace())))
  handle('cloud:deploy', ({ gpu, idleSeconds }) =>
    cloudTask('setting up the cloud', async () => {
      const { url, token } = await cloud.deploy({ gpu, idleSeconds })
      writeSettings({ cloudToken: seal(token) }, BASE)
      saveCloud({ url, gpu, idleSeconds, workspace: await cloud.workspace(), deployedAt: new Date().toISOString() })
      return readSettings(BASE).cloud
    })
  )
  handle('cloud:fetchModels', () =>
    cloudTask('downloading the models', async () => {
      await cloud.fetchModels()
      return saveCloud({ modelsAt: new Date().toISOString() }).cloud
    })
  )
  // Each character's LoRA and the RefMods it uses, found through the local ComfyUI's model folders.
  handle('cloud:uploadCharacters', () =>
    cloudTask('uploading characters', async () => {
      const local = await fetch(`${readSettings(BASE).comfyUrl}/experiment/models`).then((r) => r.json())
      const roots = (name) => local.find((f) => f.name === name)?.folders || []
      const find = (kind, rel) => roots(kind).map((d) => path.join(d, rel)).find((p) => fs.existsSync(p))
      const done = []
      for (const c of studio.characters()) {
        const lora = find('loras', c.lora)
        if (lora) await cloud.uploadModel(lora, `loras/${c.lora.replace(/\\/g, '/')}`), done.push(c.lora)
        for (const r of [c.voiceRefmod, c.visualRefmod].filter(Boolean)) {
          const file = find('refmods', `${r}.safetensors`)
          if (file) await cloud.uploadModel(file, `refmods/${r}.safetensors`), done.push(r)
        }
      }
      saveCloud({ charactersAt: new Date().toISOString() })
      return done
    })
  )
  handle('cloud:use', (target) => {
    const s = readSettings(BASE)
    if (target === 'cloud' && !(s.cloud?.url && s.cloudToken)) throw new Error('Set up the cloud first.')
    writeSettings({ target: target === 'cloud' ? 'cloud' : 'local' }, BASE)
    makeStudio()
    return target
  })
  // What the cloud GPU is doing, for the title-bar meter: the running containers and the chosen GPU's rate.
  handle('cloud:usage', async () => {
    const s = readSettings(BASE)
    const gpu = GPUS.find((g) => g.id === s.cloud?.gpu) || GPUS[0]
    const running = cloud.toolkitReady() ? await cloud.containers() : []
    return { gpu: gpu.id, perHour: gpu.perHour, running: running.map((c) => ({ id: c.id, startedAt: Date.parse(String(c.startedAt).replace(' ', 'T')) })) }
  })
  // Stops the cloud GPU now (the "Shut down GPU" button). A render running there is lost.
  handle('cloud:stop', () => {
    if (!cloud.toolkitReady()) throw new Error('The cloud tools are not installed.')
    if (cloudBusy) throw new Error(`Still busy: ${cloudBusy}.`)
    return cloud.stopGpu()
  })
  // Wakes the cloud GPU (a cold start loads ComfyUI; Modal holds the request until it is up).
  handle('cloud:wake', async () => {
    const t0 = Date.now()
    for (;;) {
      try {
        const stats = await studio.comfy.req('/system_stats', { timeout: 600000 })
        return { seconds: Math.round((Date.now() - t0) / 1000), gpu: stats.devices?.[0]?.name }
      } catch (err) {
        if (!err.starting || Date.now() - t0 > 900000) throw err
        await new Promise((r) => setTimeout(r, 5000))
      }
    }
  })
  handle('prompts:status', async () => ({ ...(await ollamaStatus()), engine: readSettings(BASE).promptEngine, model: readSettings(BASE).ollamaModel, hasComfyKey: !!readSettings(BASE).comfyApiKey, contextIrPrice: CONTEXT_IR_PRICE }))
  handle('prompts:write', (request) => {
    const s = readSettings(BASE)
    const engine = request?.engine || s.promptEngine
    return studio.writePrompt(request, { engine, apiKey: engine === 'contextir' ? comfyKey() : null, model: s.ollamaModel })
  })
  handle('prompts:story', (request) => studio.writeStory(request, { model: readSettings(BASE).ollamaModel }))
  handle('prompts:pull', (model) => pullModel(model, (ev) => send('prompts:pull', { model, ...ev })))
  handle('settings:set', (patch) => {
    const { comfyApiKey, cloudToken, civitaiKey, cloud, target, ...safe } = patch || {}
    const s = publicSettings(writeSettings(safe, BASE))
    if ('comfyUrl' in (patch || {})) makeStudio()
    if ('models' in (patch || {})) studio.models = s.models || {}
    // the render folders apply to the next render
    studio.comfy.folders = comfyFolders(readSettings(BASE), INCOGNITO)
    return s
  })
  handle('setup:check', () => studio.checkSetup())
  // Settings -> Agents: what to paste into an agent, and the Claude Code skill (with this install's command).
  const skillFile = path.join(app.getPath('home'), '.claude', 'skills', 'iv-studio', 'SKILL.md')
  const skillText = () => skillMarkdown(readGuide(resourcesDir(path.join(app.getAppPath(), 'resources'))), mcpCommand())
  handle('agents:info', () => {
    const installed = fs.existsSync(skillFile)
    return { paste: pasteMessage(mcpCommand()), skillFile, skillInstalled: installed, skillCurrent: installed && fs.readFileSync(skillFile, 'utf8') === skillText() }
  })
  handle('agents:installSkill', () => {
    fs.mkdirSync(path.dirname(skillFile), { recursive: true })
    fs.writeFileSync(skillFile, skillText())
    return skillFile
  })
  handle('models:h3', () => studio.h3Models())
  handle('models:status', () => installer.status())
  handle('models:download', (ids) => installer.enqueue(ids))
  handle('models:cancel', (id) => installer.cancel(id))
  handle('characters:list', async () => (await catalog?.attachVoices().catch(() => {}), studio.characters()))
  // Ready-made characters: bundled picture, LoRA downloaded on request (resources/characters/catalog.json).
  catalog = new CharacterCatalog({ studio, voices, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')) })
  handle('characters:catalog', () => catalog.list())
  handle('characters:install', (id) => catalog.install(id, (cid, p) => send('characters:progress', { id: cid, progress: p })))
  handle('characters:loras', () => studio.loraNames())
  handle('characters:save', (list) => studio.saveCharacters(list))
  handle('projects:list', () =>
    studio.listProjects().filter((p) => !p.sequenceId && !p.trainingId && !p.tool).map((p) => {
      const jobs = studio.listJobs(p.id)
      const finals = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'final'))
      const previews = jobs.flatMap((j) => j.outputs.filter((o) => o.kind === 'preview'))
      return { ...p, jobCount: jobs.length, cover: (finals.at(-1) || previews.at(-1))?.url || null, finals: finals.length, running: jobs.some((j) => !['success', 'error', 'cancelled'].includes(j.status)) }
    })
  )
  handle('sequences:list', () => studio.listSequences())
  handle('sequences:get', (id) => studio.refreshSequence(id))
  handle('sequences:create', (init) => studio.createSequence(init))
  handle('sequences:save', (id, patch) => studio.saveSequence(id, patch))
  handle('sequences:delete', (id) => studio.deleteSequence(id))
  const track = async (p) => {
    const job = await p
    pending.add(job.id)
    return job
  }
  handle('sequences:take', (id) => track(studio.renderTake(id)))
  handle('sequences:retake', (id, opts) => track(studio.retakeSequence(id, opts)))
  handle('sequences:renderOut', (id, opts) => track(studio.renderOutSequence(id, opts)))
  handle('sequences:huntShot', (id, index, opts) => track(studio.huntShot(id, index, opts)))
  handle('sequences:finishShot', (id, index, opts) => track(studio.finishShot(id, index, opts)))
  handle('projects:get', (id) => ({ project: studio.getProject(id), jobs: studio.listJobs(id) }))
  handle('projects:rename', (id, name) => studio.renameProject(id, name))
  handle('projects:delete', (id) => studio.deleteProject(id))
  handle('render:plan', (request, finish) => studio.planRender(request, finish))
  handle('render:planFinish', (jobId, finish) => studio.planFinishJob(jobId, finish))
  // A voice engine still holding the GPU would slow H3 down: let it go before a render on this PC.
  const freeVoices = () => (readSettings(BASE).target === 'cloud' ? null : voices.release())
  handle('render:previews', async (request) => {
    await freeVoices()
    const job = await studio.generatePreviews(request)
    pending.add(job.id)
    return job
  })
  handle('render:finish', async (opts) => {
    await freeVoices()
    const job = await studio.finishCandidate(opts)
    pending.add(job.id)
    return job
  })
  handle('jobs:watch', (ids) => {
    for (const id of ids || []) pending.add(id)
    pump()
    return true
  })
  handle('jobs:cancel', (id) => studio.cancelJob(id))
  handle('files:pick', async (kind) => {
    const filters = {
      picture: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      video: [{ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv'] }],
      audio: [{ name: 'Audio', extensions: ['wav', 'mp3', 'flac', 'm4a', 'ogg'] }]
    }[kind]
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', ...(kind === 'picture' ? ['multiSelections'] : [])], filters })
    return r.canceled ? [] : r.filePaths
  })
  // A path on this PC opens in Explorer. An output that lives in the cloud is downloaded to
  // Videos\IV Studio first (same file name), then shown.
  handle('files:reveal', async (file) => {
    const p = await localCopy(file)
    shell.showItemInFolder(p)
    return p
  })
  handle('links:open', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url)
    return true
  })

  // ---------- updates ----------
  // Restarting stops work this process is doing itself, so the update waits for it. Renders keep going in
  // ComfyUI either way.
  const busy = () =>
    [
      edits.exports.size && 'an edit is exporting',
      installer?.running && 'models are downloading',
      Object.values(civitai.downloadState()).some((d) => d.status === 'downloading') && 'a LoRA is downloading'
    ].filter(Boolean)
  const updater = initUpdater((state) => send('update:changed', state))
  handle('update:state', () => updateState())
  handle('update:check', () => updater.check())
  handle('update:install', () => {
    const waits = busy()
    if (waits.length) throw new Error(`Restart when it's done: ${waits.join(' and ')}.`)
    return updater.install()
  })

  // ---------- Incognito ----------
  // Switching restarts the app into the other set of data (see BASE / DATA). Leaving Incognito also takes
  // its renders out of ComfyUI's history, whose queue panel would show them; the files stay in IV Private.
  handle('incognito:set', async (on) => {
    if (!!on === INCOGNITO) return { on: INCOGNITO }
    const waits = [...busy(), pending.size && 'a render is running'].filter(Boolean)
    if (waits.length) throw new Error(`Switch when it's done: ${waits.join(' and ')}.`)
    if (INCOGNITO && !studio.comfy.remote) {
      const dir = path.join(DATA, 'jobs')
      const promptOf = (f) => {
        try {
          return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).promptId || []
        } catch {
          return []
        }
      }
      await studio.comfy.deleteHistory(fs.existsSync(dir) ? fs.readdirSync(dir).flatMap(promptOf) : []).catch(() => {})
    }
    writeSettings({ incognito: !!on }, BASE)
    setTimeout(() => (app.relaunch(), app.exit(0)), 200)
    return { on: !!on, restarting: true }
  })
  createWindow()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})
app.on('window-all-closed', () => app.quit())
// the voice engine is a Python process of ours: stop it with the app
app.on('will-quit', () => voices?.release())
