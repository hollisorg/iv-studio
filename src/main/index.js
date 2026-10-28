import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, screen, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { dataDir, readSettings, resourcesDir, writeSettings } from '../service/paths'
import { ModelInstaller } from '../service/models'
import { Studio } from '../service/studio'

if (process.env.IV_STUDIO_USER_DATA) app.setPath('userData', process.env.IV_STUDIO_USER_DATA)
if (!app.requestSingleInstanceLock()) app.quit()
// ComfyUI refuses cross-site browser requests, so the window loads outputs through ivmedia://view?...,
// which the main process fetches from ComfyUI's /view (Range passed through so videos can seek).
protocol.registerSchemesAsPrivileged([{ scheme: 'ivmedia', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }])

const BG = '#100c0e'
const DATA = process.env.IV_STUDIO_DATA || dataDir()
let win = null
let studio = null
let stopWatch = null
let installer = null
const pending = new Set() // job ids the window is waiting on

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function makeStudio() {
  stopWatch?.()
  const s = readSettings(DATA)
  studio = new Studio({ dataDir: DATA, resourcesDir: resourcesDir(path.join(app.getAppPath(), 'resources')), comfyUrl: s.comfyUrl })
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
    title: 'IV Studio',
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
  win.on('close', () => writeSettings({ window: win.getBounds() }, DATA))
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

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
  protocol.handle('ivmedia', (req) => {
    const u = new URL(req.url)
    if (u.hostname !== 'view') return new Response('Not found', { status: 404 })
    const range = req.headers.get('range')
    return fetch(`${studio.comfy.url}/view${u.search}`, { headers: range ? { Range: range } : {} })
  })

  handle('app:info', () => ({ version: app.getVersion(), dataDir: DATA, mcp: mcpCommand() }))
  handle('settings:get', () => readSettings(DATA))
  handle('settings:set', (patch) => {
    const s = writeSettings(patch, DATA)
    if ('comfyUrl' in (patch || {})) makeStudio()
    return s
  })
  handle('setup:check', () => studio.checkSetup())
  handle('models:status', () => installer.status())
  handle('models:download', (ids) => installer.enqueue(ids))
  handle('models:cancel', (id) => installer.cancel(id))
  handle('characters:list', () => studio.characters())
  handle('characters:save', (list) => studio.saveCharacters(list))
  handle('projects:list', () =>
    studio.listProjects().filter((p) => !p.sequenceId).map((p) => {
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
  handle('files:reveal', (p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p)
    return true
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
