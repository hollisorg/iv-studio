// The 1.1.26 streamlining (Matthew, 2026-11-23): the render tray, Again and Finish this one from the reveal, quick finals
// on Create, each tool's own writer (and who wrote a prompt), quiet hours, and Frame Hunt's best on the Dashboard.
//   node test/streamline.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'

// renders.js keeps the best in localStorage: a small stand-in
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) }
const r = await import('../src/renderer/src/renders.js')

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

const take = {
  id: 'j1',
  kind: 'previews',
  projectId: 'p1',
  promptId: 'x',
  status: 'success',
  outputs: [{ kind: 'preview', candidate: 2, path: 'C:/t2.mp4' }],
  plan: {
    request: { mode: 'reference', character: 'none', prompt: 'resolved words', aspect: '9:16', megapixels: 0.4, seconds: 5, previews: 3, steps: 8, seed: 4242, photoSize: null, media: [{ kind: 'picture', file: 'minimax_h3/x.png [input]' }] },
    asked: { prompt: 'Tess @kitchen', mode: 'frames', character: 'tess', media: [{ kind: 'picture', file: 'C:/first.png' }], voiceLine: null }
  }
}

await ok('Again: the run as it was asked (words, mode, character, media), with a new seed, into the same shot', () => {
  const q = r.againRequest(take, 777)
  assert.equal(q.prompt, 'Tess @kitchen')
  assert.equal(q.mode, 'frames')
  assert.equal(q.character, 'tess')
  assert.deepEqual(q.media, [{ kind: 'picture', file: 'C:/first.png' }])
  assert.equal(q.seed, 777)
  assert.equal(q.projectId, 'p1')
  assert.equal(q.aspect, '9:16')
  assert.equal(q.autoFinish, undefined)
  const one = r.againRequest({ ...take, plan: { ...take.plan, autoFinish: { megapixels: 2, enhancer: 'none', candidate: 1 } } })
  assert.deepEqual(one.autoFinish, { megapixels: 2, enhancer: 'none' }, 'a One final finishes itself again')
})

await ok('the reveal offers Again for an H3 shot or pictures, and Finish for a hunt’s take; never for Seedance', () => {
  const state = { stage: 'done', job: take }
  const media = r.revealMedia({ kind: 'video' }, state)
  assert.equal(media.candidate, 2)
  assert.deepEqual(r.nextSteps({ kind: 'video' }, state, media), { again: true, finish: true })
  const sd = { stage: 'done', job: { ...take, plan: { ...take.plan, engine: 'seedance' } } }
  assert.deepEqual(r.nextSteps({ kind: 'video' }, sd, media), { again: false, finish: false })
  const one = { stage: 'done', job: { ...take, kind: 'finish', outputs: [{ kind: 'final', path: 'f.mp4' }] } }
  assert.equal(r.nextSteps({ kind: 'video' }, one, r.revealMedia({ kind: 'video' }, one)).finish, false, 'a finished version is finished')
  assert.equal(r.nextSteps({ kind: 'jobs' }, state, media).finish, false, 'a tool’s take finishes through the tool')
  assert.equal(r.nextSteps({ kind: 'image', set: { mode: 'generate' } }, { stage: 'done' }, null).again, true)
  assert.equal(r.nextSteps({ kind: 'image', set: { mode: 'frame' } }, { stage: 'done' }, null).again, false)
})

await ok('quick finals: One final with their own fields, recognised when the form matches, and your own saved', () => {
  const f = { mode: 'frames', oneFinal: false, aspect: '16:9', matchPhoto: false, finalMp: 1, finalEnhancer: 'dlss', megapixels: 0.4, steps: 8, prompt: 'keep me' }
  const g = r.applyQuickFinal(f, r.QUICK_FINALS[0])
  assert.equal(g.oneFinal, true)
  assert.equal(g.matchPhoto, true)
  assert.equal(g.finalMp, 2)
  assert.equal(g.finalEnhancer, 'none')
  assert.equal(g.prompt, 'keep me', 'nothing else changes')
  assert.ok(r.sameQuickFinal(g, r.QUICK_FINALS[0]))
  assert.ok(!r.sameQuickFinal(g, r.QUICK_FINALS[2]))
  // a leftover photo-shape switch outside First / last frame doesn't stop a 16:9 setup matching
  assert.ok(r.sameQuickFinal({ ...g, mode: 'text', matchPhoto: true, aspect: '16:9' }, { matchPhoto: false, aspect: '16:9', finalMp: 2, finalEnhancer: 'none' }))
  const mine = r.quickFinalOf({ ...g, matchPhoto: false, aspect: '9:16', finalMp: 1.5, finalEnhancer: 'seedvr2', steps: 4 })
  assert.match(mine.id, /^mine-/)
  assert.equal(mine.label, '9:16 · 1.5 MP · SeedVR2 · Draft')
  assert.match(r.quickFinalOf({ ...g, mode: 'text', matchPhoto: true, aspect: '1:1' }).label, /^1:1 /, 'Photo shape only in First / last frame')
  assert.ok(r.QUICK_FINALS.every((q) => q.label && !/—/.test(q.label)))
})

await ok('quiet hours: a window that may pass midnight, and editing full screen', () => {
  assert.equal(r.inQuietWindow({ on: true, from: '22:00', to: '07:00' }, 23 * 60), true)
  assert.equal(r.inQuietWindow({ on: true, from: '22:00', to: '07:00' }, 6 * 60 + 59), true)
  assert.equal(r.inQuietWindow({ on: true, from: '22:00', to: '07:00' }, 7 * 60), false)
  assert.equal(r.inQuietWindow({ on: true, from: '09:00', to: '17:00' }, 12 * 60), true)
  assert.equal(r.inQuietWindow({ on: false, from: '09:00', to: '17:00' }, 12 * 60), false)
  r.setQuietHours({ on: false, editor: true })
  assert.equal(r.isQuiet(new Date(2026, 0, 1, 12), true), true, 'full-screen editing is quiet')
  assert.equal(r.isQuiet(new Date(2026, 0, 1, 12), false), false)
  r.setQuietHours({ on: true, from: 'nonsense', to: '07:00', editor: false })
  assert.equal(r.quietHours().from, '22:00', 'a bad time falls back')
  assert.equal(r.isQuiet(new Date(2026, 0, 1, 23), false), true)
})

await ok('Frame Hunt keeps your best, and only a better one replaces it', () => {
  assert.deepEqual(r.frameHuntBest(), { score: 0, level: 1 })
  assert.equal(r.keepFrameHuntBest(120, 1), true)
  assert.equal(r.keepFrameHuntBest(80, 2), false)
  assert.equal(r.frameHuntBest().score, 120)
  assert.equal(r.keepFrameHuntBest(400, 2), true)
  assert.equal(r.frameHuntBest().level, 2)
})

await ok('the store tells the tray and the Dashboard what is rendering', () => {
  const seen = []
  const off = r.watchRenders((list) => seen.push(list.length))
  r.publishRenders([{ state: { stage: 'running' } }, { state: { stage: 'done' } }])
  off()
  r.publishRenders([])
  assert.deepEqual(seen, [0, 2])
  assert.equal(r.isRunning({ state: { stage: 'finishing' } }), true)
  assert.equal(r.isRunning({ state: { stage: 'failed' } }), false)
})

await ok('the wiring: tray, reveal buttons, quick finals, writers, quiet hours and the Dashboard card', () => {
  const hub = src('../src/renderer/src/components/RenderHub.jsx')
  assert.match(hub, /function RenderTray\(/)
  assert.match(hub, /<RenderTray/)
  assert.match(hub, /↻ Again/)
  assert.match(hub, /Finish take \{media\.candidate\}/)
  assert.match(hub, /if \(quietNow\(\)\) held\.current\.push\(r\.key\)/)
  assert.match(hub, /if \(popupOn\(\) && !quietNow\(\)\) setPopup\(key\)/)
  const create = src('../src/renderer/src/components/Create.jsx')
  assert.match(create, /Quick finals/)
  assert.match(create, /\+ Save this setup/)
  assert.match(create, /writtenBy: by \|\| null/)
  const pw = src('../src/renderer/src/components/PromptWriter.jsx')
  assert.match(pw, /export function useToolWriter\(tool\)/)
  assert.match(pw, /prompts\.write\(\{ \.\.\.context, idea: staged, writer: engine \}\)/)
  assert.match(src('../src/renderer/src/components/Sequences.jsx'), /tool="sequences"/)
  assert.match(src('../src/renderer/src/components/MusicVideo.jsx'), /<ToolWriter tool="musicvideo"/)
  assert.match(src('../src/renderer/src/components/Projects.jsx'), /<ToolWriter tool="films"/)
  assert.match(src('../src/renderer/src/components/Shot.jsx'), /written by \$\{writerName\(req\.writtenBy\)\}/)
  const main = src('../src/main/index.js')
  assert.match(main, /const toolSettings = \(s, tool\) =>/)
  assert.match(main, /writerFor\(toolSettings\(readSettings\(BASE\), 'musicvideo'\), request\)/)
  assert.match(main, /writerOf\(toolSettings\(readSettings\(BASE\), 'films'\)\)/)
  assert.match(main, /safe\.quickFinals = cleanQuickFinals\(safe\.quickFinals\)/)
  assert.match(main, /safe\.writers = Object\.fromEntries/)
  assert.match(main, /safe\.quietHours = \{ on: !!q\.on/)
  assert.match(src('../src/service/studio.js'), /plan\.asked = \{ prompt: asked\.prompt, mode: asked\.mode, character: asked\.character \?\? 'none'/)
  assert.match(src('../src/renderer/src/components/Settings.jsx'), /label="Quiet hours"/)
  assert.match(src('../src/renderer/src/App.jsx'), /setQuietHours\(s\.quietHours\)/)
  const dash = src('../src/renderer/src/components/Dashboard.jsx')
  assert.match(dash, /function WhileYouWait\(/)
  assert.match(dash, /<WhileYouWait \/>/)
  assert.match(src('../src/renderer/src/components/FrameHunt.jsx'), /New best!/)
})

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
