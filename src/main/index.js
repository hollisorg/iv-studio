import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { dataDir, readSettings, resourcesDir, writeSettings } from '../service/paths'
import { pasteMessage, skillMarkdown, readGuide } from '../service/agent'
import { Cloud, GPUS } from '../service/cloud'
import { Edits, FORMATS, TRACKS } from '../service/edits'
import { MediaTools } from '../service/media'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { ModelInstaller } from '../service/models'
import { CONTEXT_IR_PRICE, ollamaStatus, pullModel } from '../service/prompter'
import { Studio } from '../service/studio'
import { SCENES, TALKS, TRAIN_GPUS, Trainings } from '../service/training'

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
const DATA = process.env.IV_STUDIO_DATA || dataDir()
let win = null
let studio = null
let stopWatch = null
let installer = null
let trainings = null
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
  const s = readSettings(DATA)
  const cloud = s.target === 'cloud' && s.cloud?.url ? { comfyUrl: s.cloud.url, comfyToken: unseal(s.cloudToken) } : { comfyUrl: s.comfyUrl }
  studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), models: s.models, ...cloud })
  if (trainings) trainings.studio = studio
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
  const b = readSettings(DATA).window
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
  win.on('close', () => writeSettings({ window: win.getBounds() }, DATA))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

const localCopy = (file) => studio.localCopy(file, path.join(app.getPath('videos'), 'IV Studio'))

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
  handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA, mcp: mcpCommand(), testCopy: TEST_COPY, links }))
  // The window never sees the Comfy.org key, only whether one is saved.
  const publicSettings = (s) => {
    const { comfyApiKey, cloudToken, ...rest } = s
    return { ...rest, hasComfyKey: !!comfyApiKey, hasCloudToken: !!cloudToken }
  }
  const comfyKey = () => unseal(readSettings(DATA).comfyApiKey)
  handle('settings:get', () => publicSettings(readSettings(DATA)))
  handle('settings:setComfyKey', (key) => {
    const k = String(key || '').trim()
    if (k && !safeStorage.isEncryptionAvailable()) throw new Error('Windows encryption is not available, so the key cannot be stored safely.')
    return publicSettings(writeSettings({ comfyApiKey: seal(k) }, DATA))
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
  // ---------- characters: design, clips, training on Modal, pick ----------
  trainings = new Trainings({
    dataDir: DATA,
    resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')),
    studio,
    ffmpeg: edits.ffmpeg,
    ffprobe: edits.ffprobe,
    onLog: (line, id) => send('training:log', { id, line }),
    onChange: (id) => send('training:changed', { id })
  })
  handle('training:meta', () => ({ gpus: TRAIN_GPUS, scenes: SCENES, talks: TALKS }))
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
  handle('edits:meta', () => ({ tracks: TRACKS, formats: FORMATS }))
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
  fs.watch(DATA, (_, name) => name === 'settings.json' && later('settings', () => (studio.models = readSettings(DATA).models || {})))
  handle('edits:delete', (id) => edits.remove(id))
  handle('edits:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Media', extensions: ['mp4', 'mov', 'webm', 'mkv', 'm4v', 'wav', 'mp3', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp'] }] })
    return Promise.all((r.canceled ? [] : r.filePaths).map((f) => edits.addMedia(f)))
  })
  handle('edits:library', () => studio.library())
  handle('edits:addOutput', async (item) => edits.addMedia(await localCopy(item.file), { type: 'iv', label: item.label }))
  handle('edits:export', (id) => edits.export(id, path.join(app.getPath('videos'), 'IV Studio', 'Edits'), (p) => send('edits:progress', { id, progress: p })))
  handle('edits:cancelExport', (id) => edits.cancelExport(id))

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
  const saveCloud = (patch) => writeSettings({ cloud: { ...(readSettings(DATA).cloud || {}), ...patch } }, DATA)
  handle('cloud:status', async () => {
    const s = readSettings(DATA)
    return { toolkit: cloud.toolkitReady(), workspace: await cloud.workspace(), cloud: s.cloud, target: s.target, gpus: GPUS, busy: cloudBusy, hasToken: !!s.cloudToken }
  })
  handle('cloud:install', () => cloudTask('installing the cloud tools', () => cloud.installToolkit()))
  handle('cloud:signIn', () => cloudTask('signing in to Modal', async () => (await cloud.signIn(), cloud.workspace())))
  handle('cloud:deploy', ({ gpu, idleSeconds }) =>
    cloudTask('setting up the cloud', async () => {
      const { url, token } = await cloud.deploy({ gpu, idleSeconds })
      writeSettings({ cloudToken: seal(token) }, DATA)
      saveCloud({ url, gpu, idleSeconds, workspace: await cloud.workspace(), deployedAt: new Date().toISOString() })
      return readSettings(DATA).cloud
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
      const local = await fetch(`${readSettings(DATA).comfyUrl}/experiment/models`).then((r) => r.json())
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
    const s = readSettings(DATA)
    if (target === 'cloud' && !(s.cloud?.url && s.cloudToken)) throw new Error('Set up the cloud first.')
    writeSettings({ target: target === 'cloud' ? 'cloud' : 'local' }, DATA)
    makeStudio()
    return target
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
  handle('prompts:status', async () => ({ ...(await ollamaStatus()), engine: readSettings(DATA).promptEngine, model: readSettings(DATA).ollamaModel, hasComfyKey: !!readSettings(DATA).comfyApiKey, contextIrPrice: CONTEXT_IR_PRICE }))
  handle('prompts:write', (request) => {
    const s = readSettings(DATA)
    const engine = request?.engine || s.promptEngine
    return studio.writePrompt(request, { engine, apiKey: engine === 'contextir' ? comfyKey() : null, model: s.ollamaModel })
  })
  handle('prompts:story', (request) => studio.writeStory(request, { model: readSettings(DATA).ollamaModel }))
  handle('prompts:pull', (model) => pullModel(model, (ev) => send('prompts:pull', { model, ...ev })))
  handle('settings:set', (patch) => {
    const { comfyApiKey, cloudToken, cloud, target, ...safe } = patch || {}
    const s = publicSettings(writeSettings(safe, DATA))
    if ('comfyUrl' in (patch || {})) makeStudio()
    if ('models' in (patch || {})) studio.models = s.models || {}
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
  handle('characters:list', () => studio.characters())
  handle('characters:save', (list) => studio.saveCharacters(list))
  handle('projects:list', () =>
    studio.listProjects().filter((p) => !p.sequenceId && !p.trainingId).map((p) => {
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
  handle('render:plan', (request, finish) => studio.planRender(request, finish))
  handle('render:planFinish', (jobId, finish) => studio.planFinishJob(jobId, finish))
  handle('render:previews', async (request) => {
    const job = await studio.generatePreviews(request)
    pending.add(job.id)
    return job
  })
  handle('render:finish', async (opts) => {
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
  createWindow()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})
app.on('window-all-closed', () => app.quit())
