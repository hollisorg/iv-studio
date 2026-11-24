// Cloud setup progress (src/service/setupprogress.js): Modal's lines and the RunPod pod's health move the right
// steps, model downloads count by bytes, and the overall bar and time left make sense, on a made-up clock.
import assert from 'node:assert/strict'
import { SetupProgress, clock, about, SLOW_ETA, SLOW_FOR } from '../src/service/setupprogress.js'
import fs from 'node:fs'

let n = 0
const ok = (name, fn) => (fn(), n++, console.log('ok ', name))

ok('a Modal setup, from its own output', () => {
  let t = 0
  const models = [
    { id: 'a', label: 'Model A', size: 30 },
    { id: 'b', label: 'Model B', size: 10 },
    { id: 'c', label: 'Model C', size: 60 }
  ]
  const p = new SetupProgress('modal', { now: () => t, models })
  const step = (id) => p.snapshot().steps.find((s) => s.id === id)
  p.fromLine('Saving the access token in your Modal workspace…')
  assert.equal(step('token').status, 'running')
  t = 5000
  p.fromLine('Building the cloud image and publishing ComfyUI (the first time takes 10–15 minutes)…')
  assert.equal(step('token').status, 'done')
  assert.equal(step('image').status, 'running')
  p.fromLine('=> Step 2: RUN pip install torch')
  assert.equal(step('image').detail, '=> Step 2: RUN pip install torch')
  p.fromLine('│ some boxed error text │')
  assert.equal(step('image').detail, '=> Step 2: RUN pip install torch', 'box-drawing lines are not news')
  t = 365000 // six minutes into the build: the bar moves by the step's typical time, and never claims done
  assert.ok(p.overall() > 0.2 && p.overall() < 0.6)
  p.start('models')
  p.fromLine('have Model A')
  assert.equal(step('models').percent, 30)
  p.fromLine('downloading Model C')
  p.fromLine('progress c 50% of 60')
  assert.equal(step('models').percent, 60, '30 + half of 60, out of 100')
  assert.equal(step('models').detail, 'Downloading Model C, 50%')
  p.fromLine('done Model C (checksum verified)')
  assert.equal(step('models').percent, 90)
  p.fromLine('models ready: 3/3 in 600 s')
  assert.equal(step('models').status, 'done')
  p.start('characters')
  p.fromLine('Uploading tess.safetensors…')
  assert.equal(step('characters').detail, 'Uploading tess.safetensors')
  p.finish()
  const s = p.snapshot()
  assert.equal(s.ok, true)
  assert.equal(s.overall, 100)
  assert.equal(s.remaining, 0)
  assert.ok(s.steps.every((x) => x.status === 'done'))
})

ok('a RunPod setup, from the pod’s boot health; storage that exists is skipped', () => {
  let t = 0
  const p = new SetupProgress('runpod', { now: () => t })
  const step = (id) => p.snapshot().steps.find((s) => s.id === id)
  p.skip('storage', 'Already made, in EU-RO-1')
  p.start('pod')
  p.fromHealth(null)
  assert.equal(step('pod').detail, 'Waiting for the pod to boot')
  p.fromHealth({ stage: 'installing', detail: 'node pack 5 of 20: ComfyUI-KJNodes' })
  assert.equal(step('pod').status, 'done')
  assert.equal(step('install').percent, 58, 'torch and ComfyUI done (48%), then 4 of 20 packs')
  p.fromHealth({ stage: 'models', detail: 'MiniMax H3 (2 of 7), 50%', done: 3, total: 7, percent: 50 })
  assert.equal(step('install').status, 'done')
  assert.equal(step('models').percent, 50, '3.5 of 7 models')
  p.fromHealth({ stage: 'starting', detail: 'ComfyUI is loading' })
  p.fromHealth({ stage: 'ready' })
  assert.equal(step('start').status, 'done')
  assert.equal(step('storage').status, 'skipped')
  // a skipped step doesn't count toward the bar
  p.start('characters')
  assert.ok(p.overall() > 0.95)
})

ok('a setup that stops says where and why', () => {
  let t = 0
  const p = new SetupProgress('modal', { now: () => t })
  p.start('models')
  t = 1000
  p.fail(new Error('Model B: the host answered 503\nmore'))
  const s = p.snapshot()
  assert.equal(s.ok, false)
  assert.equal(s.steps.find((x) => x.id === 'models').status, 'failed')
  assert.match(s.error, /503/)
  assert.ok(s.finishedAt)
})

ok('time left: from a step’s own percentage once it has one', () => {
  let t = 0
  const p = new SetupProgress('modal', { now: () => t })
  p.start('models')
  t = 100000
  p.update('models', { percent: 25 })
  // 100 s for 25%: about 300 s more for this step, plus the characters step's 30 s
  assert.equal(p.remaining(), 330)
})

ok('RunPod models: by bytes, with the pod’s own time left', () => {
  let t = 0
  const p = new SetupProgress('runpod', { now: () => t })
  p.start('models')
  t = 30000
  // one 21 GB file half done is about a third of 60 GB, not "1 of 8 files"
  p.fromHealth({ stage: 'models', detail: 'MiniMax H3 fl2va int8 (1 of 8), 50% · 120 MB/s', done: 0, total: 8, percent: 50, bytesDone: 10.5e9, bytesTotal: 60e9, speed: 120e6, eta: 412 })
  const s = p.snapshot().steps.find((x) => x.id === 'models')
  assert.equal(s.percent, 18)
  // the time left is the pod's estimate for the download, plus the steps after it (ComfyUI 300 s, characters 30 s)
  assert.equal(p.remaining(), 412 + 300 + 30)
  p.done('models')
  assert.equal(p.snapshot().steps.find((x) => x.id === 'models').percent, 100)
})

ok('RunPod models: slow for a few minutes brings the warning (with the GPU price), fast again takes it away', () => {
  let t = 0
  const p = new SetupProgress('runpod', { now: () => t })
  p.perHour = 1.95
  p.start('models')
  const slow = { stage: 'models', detail: 'MiniMax H3 fl2va int8 (1 of 8), 30% · 4 MB/s', bytesDone: 6e9, bytesTotal: 60e9, speed: 4e6, eta: 13500 }
  t = 20000
  p.fromHealth(slow)
  assert.equal(p.snapshot().slow, null, 'not in the first minute, while the connections get going')
  t = 70000
  p.fromHealth(slow)
  t = 70000 + (SLOW_FOR - 10) * 1000
  p.fromHealth(slow)
  assert.equal(p.snapshot().slow, null, 'not before it has been slow for SLOW_FOR')
  t = 70000 + SLOW_FOR * 1000
  p.fromHealth(slow)
  const w = p.snapshot()
  assert.deepEqual([w.slow?.speed, w.slow?.eta, w.perHour], [4e6, 13500, 1.95])
  t += 5000
  p.fromHealth({ ...slow, speed: 150e6, eta: SLOW_ETA - 60 })
  assert.equal(p.snapshot().slow, null, 'gone once it speeds up')
  t += 5000
  p.fromHealth(slow)
  assert.equal(p.snapshot().slow, null, 'and it has to stay slow for SLOW_FOR again')
  t += SLOW_FOR * 1000
  p.fromHealth(slow)
  assert.ok(p.snapshot().slow)
  p.fail(new Error('Stopped'))
  assert.equal(p.snapshot().slow, null, 'a finished setup shows no warning')
})

ok('the warning, its button, the pause and the token prompt are wired', () => {
  const src = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8')
  const ui = src('../src/renderer/src/components/SetupProgress.jsx')
  assert.match(ui, /p\.slow && !p\.finishedAt && p\.provider === 'runpod' && <SlowDownload p=\{p\} \/>/)
  assert.match(ui, /window\.ivstudio\.cloud\.runpodPause\(\)/)
  assert.match(ui, /Stop the GPU, keep the download/)
  const main = src('../src/main/index.js')
  assert.match(main, /handle\('cloud:runpodPause'/)
  assert.match(main, /runpod\.paused = true/)
  assert.match(main, /t\.perHour = RUNPOD_GPUS\.find/)
  assert.match(src('../src/preload/index.js'), /runpodPause: call\('cloud:runpodPause'\)/)
  const rp = src('../src/service/runpod.js')
  assert.match(rp, /if \(this\.paused\) \{\s*this\.paused = false\s*throw new Error\(RunPod\.PAUSED\)/)
  const wiz = src('../src/renderer/src/components/CloudWizard.jsx')
  assert.match(wiz, /p === 'runpod' && !ready && !busy && \(\s*<HfLogin/)
  const boot = src('../resources/cloud/runpod_boot.py')
  assert.match(boot, /eta=int\(left \/ speed\) if speed else None/)
  assert.ok(!/—/.test(ui + wiz), 'no em dashes')
})

ok('the real RunPod setup of 2026-11-23, replayed: the bar never goes back, and the time left stays sensible', () => {
  // the health the pod reported, second by second from the start (install 913 s, models 209 s, start 290 s)
  const timeline = [
    [0, null],
    [26, { stage: 'installing', detail: 'Python and torch (first time only, about 5 minutes)' }],
    [226, { stage: 'installing', detail: 'ComfyUI v0.44.1' }],
    [466, { stage: 'installing', detail: 'node pack 1 of 15: ComfyUI-MiniMaxH3Mod' }],
    [481, { stage: 'installing', detail: 'node pack 4 of 15: ComfyUI-VideoHelperSuite' }],
    [496, { stage: 'installing', detail: 'node pack 6 of 15: comfyui-impact-pack' }],
    [800, { stage: 'installing', detail: 'node pack 7 of 15: ComfyUI-Pixaroma' }],
    [900, { stage: 'installing', detail: 'node pack 13 of 15: seedvr2_videoupscaler' }],
    [939, { stage: 'models', detail: 'MiniMax H3 fl2va (int8) (1 of 8), 6% · 353 MB/s', bytesDone: 1.2e9, bytesTotal: 60e9, speed: 353e6, eta: 167 }],
    [1030, { stage: 'models', detail: 'MiniMax H3 ref2va (int8) (2 of 8), 44% · 388 MB/s', bytesDone: 30e9, bytesTotal: 60e9, speed: 388e6, eta: 77 }],
    [1148, { stage: 'starting', detail: 'ComfyUI is loading' }],
    [1300, { stage: 'starting', detail: 'ComfyUI is loading' }],
    [1438, { stage: 'ready' }]
  ]
  let t = 0
  const p = new SetupProgress('runpod', { now: () => t * 1000 })
  p.start('storage')
  let last = 0
  for (let s = 0; s <= 1438; s += 5) {
    t = s
    const due = timeline.filter(([at]) => at <= s).pop()
    if (due) p.fromHealth(due[1])
    const now = p.overall()
    assert.ok(now >= last, `the bar went back at ${s} s: ${last} to ${now}`)
    last = now
    assert.ok(p.remaining() < 1800, `time left jumped to ${p.remaining()} s at ${s} s`)
  }
  // halfway through the packs (about 11 minutes in) the bar is well past the start, not stuck at a fifth
  t = 700
  assert.ok(p.overall() > 0.5 || last > 0.5)
})

ok('clocks and words', () => {
  assert.equal(clock(65), '1:05')
  assert.equal(clock(3725), '1:02:05')
  assert.equal(about(20), 'less than a minute')
  assert.equal(about(70), 'about a minute')
  assert.equal(about(25 * 60), 'about 25 minutes')
  assert.equal(about(2 * 3600), 'about 2 hours')
})

console.log(`\n${n} passed`)
