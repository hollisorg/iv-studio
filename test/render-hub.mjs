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
  const body = text.replace(/^import .*$/m, '').replace(/export default function FrameHunt[\s\S]*$/, '')
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
  assert.match(app, /<RenderHub openShot=\{openShot\} openImage=\{openImage\} \/>/)
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

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
