// The render hub (renders.js, RenderHub.jsx, FrameHunt.jsx): a pop-up when a render starts, the ready drop and its
// reveal when it's done, and Frame Hunt, the little maze game for the wait.  node test/render-hub.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { imageState, revealMedia, videoState } from '../src/renderer/src/renders.js'

let n = 0
let failed = 0
const ok = async (name, fn) => {
  n++
  try {
    await fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

await ok('a hunt: queued, running with its percentage, done', () => {
  assert.equal(videoState({ id: 'a', status: 'queued', queuePosition: 2 }).position, 2)
  assert.deepEqual(videoState({ id: 'a', status: 'running', progress: { value: 3, max: 8 } }).pct, 38)
  assert.equal(videoState({ id: 'a', status: 'success' }).stage, 'done')
  assert.equal(videoState({ id: 'a', status: 'error', error: 'boom' }).stage, 'failed')
})

await ok('a One final is done only when its own finish is', () => {
  const take = { id: 't', status: 'success', plan: { autoFinish: { megapixels: 2 } }, autoFinishJob: 'f' }
  assert.equal(videoState({ ...take, autoFinishJob: undefined }).stage, 'finishing', 'before the finish starts')
  assert.equal(videoState(take, { f: { id: 'f', status: 'running', progress: { value: 1, max: 2 } } }).stage, 'finishing')
  assert.equal(videoState(take, { f: { id: 'f', status: 'running', progress: { value: 1, max: 2 } } }).pct, 50)
  const done = videoState(take, { f: { id: 'f', status: 'success', outputs: [{ kind: 'final', path: 'C:/x.mp4' }] } })
  assert.equal(done.stage, 'done')
  assert.equal(done.job.id, 'f', 'the reveal shows the finish')
  assert.equal(videoState({ ...take, autoFinishError: 'no ComfyUI' }).stage, 'failed')
})

await ok('pictures: queued, running, done, failed', () => {
  assert.equal(imageState({ status: 'queued' }).stage, 'queued')
  assert.equal(imageState({ status: 'running', progress: { value: 5, max: 10 } }).pct, 50)
  assert.equal(imageState({ status: 'success' }).stage, 'done')
  assert.equal(imageState({ status: 'error', error: 'x' }).error, 'x')
})

await ok('the reveal shows the finished version first, then a take, or the first picture', () => {
  const st = { job: { outputs: [{ kind: 'preview', path: 'p1' }, { kind: 'preview', path: 'p2' }, { kind: 'final', path: 'f.mp4' }] } }
  assert.equal(revealMedia({ kind: 'video' }, st).file, 'f.mp4')
  assert.equal(revealMedia({ kind: 'video' }, { job: { outputs: [{ kind: 'preview', path: 'p1' }] } }).file, 'p1')
  assert.deepEqual(revealMedia({ kind: 'image' }, null, { files: ['a.png', 'b.png'] }), { kind: 'image', file: 'a.png', more: 1 })
  assert.equal(revealMedia({ kind: 'image' }, null, { files: [] }), null)
})

await ok('Frame Hunt: every frame can be reached, the glitches can get out, and the rules hold', async () => {
  const text = src('../src/renderer/src/components/FrameHunt.jsx')
  const maze = eval(text.match(/const MAZE = (\[[\s\S]*?\])/)[1])
  assert.equal(new Set(maze.map((r) => r.length)).size, 1, 'every row the same width')
  let start
  maze.forEach((r, y) => [...r].forEach((c, x) => c === 'P' && (start = [x, y])))
  const seen = new Set([String(start)])
  const q = [start]
  while (q.length) {
    const [x, y] = q.shift()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = `${x + dx},${y + dy}`
      if (maze[y + dy]?.[x + dx] && maze[y + dy][x + dx] !== '#' && !seen.has(k)) seen.add(k), q.push([x + dx, y + dy])
    }
  }
  maze.forEach((r, y) => [...r].forEach((c, x) => (c === '.' || c === 'G') && assert.ok(seen.has(`${x},${y}`), `${c} at ${x},${y} reachable`)))
  // its own look: no names, characters or sounds of anyone else's game
  assert.ok(!/(pac-?man|ghosts?|pellets?|blinky|pinky|inky|clyde|waka)/i.test(text))
  // it only runs while it's on screen and the window is in front, at most 30 times a second
  assert.match(text, /document\.hidden \|\| !document\.hasFocus\(\)/)
  assert.match(text, /const FPS = 30/)
  assert.match(text, /cancelAnimationFrame\(raf\)/)
})

await ok('Frame Hunt steps: the eye moves and takes frames; a glitch on the eye catches it; all frames clears it', () => {
  const text = src('../src/renderer/src/components/FrameHunt.jsx')
  // the pure parts, run here without React or a canvas
  const body = text.replace(/^import .*$/gm, '').replace(/export default function FrameHunt[\s\S]*$/, '')
  const mod = new Function(`${body.replace(/export /g, '')}; return { newLevel, step, isWall }`)()
  const s = mod.newLevel(1)
  const before = s.frames.size
  s.player.want = 'left'
  for (let i = 0; i < 8; i++) mod.step(s, () => 0.99)
  assert.ok(s.frames.size < before, 'frames taken')
  s.glitches[0].x = s.player.x
  s.glitches[0].y = s.player.y
  s.glitches.forEach((g) => (g.home = { x: g.x, y: g.y }))
  assert.equal(mod.step(s, () => 0.99), 'caught')
  const t = mod.newLevel(2)
  t.frames.clear()
  t.glitches = []
  assert.equal(mod.step(t), 'cleared')
})

await ok('the wiring: Create and Create → Image hand renders to the hub; the game loads only on Play', () => {
  const create = src('../src/renderer/src/components/Create.jsx')
  assert.match(create, /openShot\(job\.projectId\)\s+\/\/ the render pop-up[^\n]*\n\s+startRender\(\{ kind: 'video', job/)
  const images = src('../src/renderer/src/components/Images.jsx')
  assert.match(images, /startRender\(\{ kind: 'image', set: rec, name: rec\.name \}\)/)
  assert.match(images, /iv:image-show/)
  const app = src('../src/renderer/src/App.jsx')
  assert.match(app, /<RenderHub openShot=\{openShot\} openImage=\{openImage\} openTarget=\{openTarget\} notify=\{notify\} \/>/)
  const hub = src('../src/renderer/src/components/RenderHub.jsx')
  assert.match(hub, /const FrameHunt = lazy\(\(\) => import\('\.\/FrameHunt'\)\)/)
  assert.match(hub, /You can close this and keep exploring/)
  assert.match(hub, /Don’t open this when a render starts/)
  assert.match(hub, /reducedMotion/)
})

await ok('reduce motion stops the drop, the reveal and the progress sheen', () => {
  const css = src('../src/renderer/src/studio.css')
  for (const sel of ['.rm .ready-drop', '.rm .loot-card', '.rm .render-popup-bar span::after']) assert.ok(css.includes(sel), sel)
})

// ---------- every tool, and the two accessibility settings ----------
const r2 = await import('../src/renderer/src/renders.js')

await ok('several jobs: done when all are, failed when one is, counted while running', () => {
  const jobs = { a: { id: 'a', status: 'success' }, b: { id: 'b', status: 'running', progress: { value: 1, max: 4 } } }
  const s = r2.jobsState(['a', 'b'], jobs)
  assert.equal(s.stage, 'running')
  assert.equal(s.done, 1)
  assert.equal(s.count, 2)
  assert.equal(r2.jobsState(['a'], jobs).stage, 'done')
  assert.equal(r2.jobsState(['a', 'c'], { ...jobs, c: { id: 'c', status: 'error', error: 'x' } }).stage, 'failed')
})

await ok('jobsOf reads every shape a tool returns, and track hands them over unchanged', async () => {
  assert.deepEqual(r2.jobsOf({ id: 'j', promptId: 'p' }).map((j) => j.id), ['j'])
  assert.deepEqual(r2.jobsOf([{ id: 'a', promptId: 1 }, { id: 'b', promptId: 2 }]).map((j) => j.id), ['a', 'b'])
  assert.deepEqual(r2.jobsOf({ started: [{ jobId: 'x' }, { jobId: 'y' }] }), ['x', 'y'])
  assert.deepEqual(r2.jobsOf({ session: {}, jobs: [{ id: 'z', promptId: 3 }] }).map((j) => j.id), ['z'])
  assert.deepEqual(r2.jobsOf({ name: 'not a job' }), [])
  const seen = []
  globalThis.window = { dispatchEvent: (e) => seen.push(e.detail) }
  globalThis.CustomEvent = class {
    constructor(type, o) {
      this.type = type
      this.detail = o.detail
    }
  }
  const back = await r2.track(Promise.resolve({ id: 'j', promptId: 'p' }), { open: { page: 'sequence', id: 's1' }, what: 'take' })
  assert.equal(back.id, 'j', 'the same result back')
  assert.equal(seen[0].kind, 'jobs')
  assert.deepEqual(seen[0].open, { page: 'sequence', id: 's1' })
  await r2.track(Promise.resolve({ name: 'x' }), {})
  assert.equal(seen.length, 1, 'no jobs, nothing handed over')
})

await ok('a job’s file name reads as words', () => {
  assert.equal(r2.jobTitle('kitchen_letter_back_and_forth_ac82a1a9_v1'), 'Kitchen letter back and forth')
  assert.equal(r2.jobTitle('studio_shoot_keyframes_8b431f28_r1'), 'Studio shoot keyframes')
  assert.equal(r2.jobTitle(''), '')
})

await ok('the reveal plays a song as sound, and a task or a tool shows what it made', () => {
  assert.equal(r2.revealMedia({ kind: 'jobs' }, { job: { outputs: [{ kind: 'audio', path: 'C:/s.mp3' }] } }).kind, 'audio')
  assert.deepEqual(r2.revealMedia({ kind: 'task' }, { media: { kind: 'video', file: 'f.mp4' } }), { kind: 'video', file: 'f.mp4' })
  assert.equal(r2.mediaKind('a.png'), 'image')
  assert.equal(r2.mediaKind('a.flac'), 'audio')
  assert.equal(r2.mediaKind('a.mp4'), 'video')
})

await ok('Accessibility settings: the pop-up and how a ready render is announced', () => {
  r2.setRenderPrefs({})
  assert.equal(r2.renderPopupOn(), true)
  assert.equal(r2.readyFx(), 'full')
  r2.setRenderPrefs({ renderPopup: false, readyFx: 'off' })
  assert.equal(r2.renderPopupOn(), false)
  assert.equal(r2.readyFx(), 'off')
  r2.setRenderPrefs({ readyFx: 'fireworks' })
  assert.equal(r2.readyFx(), 'full', 'an unknown value is the default')
  assert.deepEqual(r2.READY_FX.map(([id]) => id), ['full', 'simple', 'off'])
  const settings = src('../src/renderer/src/components/Settings.jsx')
  assert.match(settings, /label="Render pop-up"/)
  assert.match(settings, /label="When a render is ready"/)
  const welcome = src('../src/renderer/src/components/Welcome.jsx')
  assert.match(welcome, /title="When a render is ready"/)
  assert.equal((welcome.match(/readyFx: fx/g) || []).length, 2, 'both ways out of the welcome setup save it')
  const main = src('../src/main/index.js')
  assert.match(main, /if \('readyFx' in safe && !\['full', 'simple', 'off'\]\.includes\(safe\.readyFx\)\) delete safe\.readyFx/)
  assert.match(main, /if \(\['full', 'simple', 'off'\]\.includes\(readyFx\)\) patch\.readyFx = readyFx/)
  const hub = src('../src/renderer/src/components/RenderHub.jsx')
  assert.match(hub, /readyFx\(\) === 'off'\) notify/)
  assert.match(hub, /const calm = reduced\(\) \|\| readyFx\(\) === 'simple'/)
  assert.ok(src('../src/renderer/src/studio.css').includes('.loot.calm'))
})

await ok('every tool hands its renders to the hub, and Open it goes back to it', () => {
  const uses = {
    'Sequences.jsx': [/track\(window\.ivstudio\.sequences\.take\(/, /track\(window\.ivstudio\.sequences\.retake\(/, /track\(window\.ivstudio\.sequences\.renderOut\(/, /track\(window\.ivstudio\.sequences\.huntShot\(/, /track\(window\.ivstudio\.sequences\.finishShot\(/],
    'Keyframes.jsx': [/track\(api\(\)\.huntAll\(/, /track\(api\(\)\.hunt\(id, m\.index/, /track\(api\(\)\.finish\(id, 0/, /iv:open-item/],
    'MusicVideo.jsx': [/track\(api\(\)\.huntAll\(/, /track\(api\(\)\.hunt\(id, i/, /track\(api\(\)\.finish\(id, i/, /iv:open-item/],
    'AnimalCam.jsx': [/track\(api\(\)\.hunt\(id, \{\}\)/, /track\(api\(\)\.finish\(/, /iv:open-item/],
    'Projects.jsx': [/track\(P\(\)\.renderScene\(v\.id, null/, /track\(P\(\)\.renderScene\(v\.id, sc\.id/, /track\(P\(\)\.render\(/, /track\(P\(\)\.finish\(/],
    'Shot.jsx': [/track\(window\.ivstudio\.render\.enhance\(/],
    'Replace.jsx': [/track\(R\.run\(/],
    'RemakeFlow.jsx': [/track\(X\.render\(/],
    'Music.jsx': [/what: 'song'/],
    'Sounds.jsx': [/what: 'sound'/],
    'Effects.jsx': [/kind: 'task'/],
    'Rebuild.jsx': [/poll: \(\) => rebuildProgress\(r\.id\)/],
    'Sizzle.jsx': [/poll: \(\) => sizzleProgress\(s\.id\)/],
    'edit/Editor.jsx': [/poll: \(\) => editGenProgress\(edit\.id, g\.id\)/, /id: `reframe:/, /id: `clipfx:/, /id: `cutout:/]
  }
  for (const [file, res] of Object.entries(uses)) {
    const text = src(`../src/renderer/src/components/${file}`)
    for (const re of res) assert.match(text, re, `${file}: ${re}`)
  }
  assert.equal((src('../src/renderer/src/components/Shot.jsx').match(/track\(window\.ivstudio\.render\.finish\(/g) || []).length, 3, 'the three Finish panels')
  const app = src('../src/renderer/src/App.jsx')
  assert.match(app, /const openTarget = \(t = \{\}\) =>/)
  for (const page of ['shot', 'image', 'sequence', 'project', 'sizzle', 'rebuild', 'edit']) assert.ok(app.includes(`t.page === '${page}'`), page)
  assert.match(app, /iv:open-item/)
})

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
