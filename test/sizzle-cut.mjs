// The sizzle first cut (src/service/sizzlecut.js), without Shinobi: palette, titles, the button's words,
// beat snapping, ending on the music, fitting every line in the frame.   node test/sizzle-cut.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { firstCut, fontMetrics, mainCta, palette, titleLines } from '../src/service/sizzlecut.js'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const measure = fontMetrics(path.join(root, 'resources', 'fonts', 'BarlowCondensed-SemiBold.ttf'))
let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log(`ok  ${name}`)
}

check('font widths', () => {
  assert.ok(measure('W') > measure('I') * 2)
  assert.ok(Math.abs(measure('AB') - measure('A') - measure('B')) < 1e-9)
  assert.ok(measure('WHAT IF') > 2 && measure('WHAT IF') < 4.5)
})

check('palette from the site', () => {
  const p = palette(['#f1ede5', '#100c0e', '#de374f', '#191216'])
  assert.equal(p.bg, '#100c0e')
  assert.equal(p.ink, '#f1ede5')
  assert.equal(p.accent, '#de374f')
  assert.ok(p.dark)
  // a light site: dark ink is chosen when it has no dark colour of its own
  const light = palette(['#ffffff', '#f4f4f4', '#2a6df4'])
  assert.equal(light.ink, '#111111')
  assert.equal(light.accent, '#2a6df4')
  assert.equal(palette([]).bg, '#100e10')
})

check('title lines', () => {
  assert.deepEqual(titleLines('STAY HUMAN. MAKE STRANGE THINGS.'), ['STAY HUMAN.', 'MAKE STRANGE THINGS.'])
  assert.deepEqual(titleLines('WHAT IF?'), ['WHAT IF?'])
  assert.deepEqual(titleLines('SOME TAKE YOU SOMEWHERE NEW.'), ['SOME TAKE YOU', 'SOMEWHERE NEW.'])
})

check("the main button's words", () => {
  assert.equal(mainCta(['Skip to the studio', 'Let’s make something ↗', 'Ⅱ PAUSE MOTION']), 'Let’s make something')
  assert.equal(mainCta(['Accept cookies', 'Menu']), null)
})

const scenes = [
  { id: 'hook', kind: 'title', seconds: 1.5, text: 'WHAT IF?' },
  { id: 'eye', kind: 'screen', seconds: 2.5, capture: 'hero' },
  { id: 'maker', kind: 'h3', seconds: 5 },
  { id: 'deeper', kind: 'title', seconds: 1.5, text: 'SOME STORIES GO DEEPER.' },
  { id: 'phone', kind: 'screen', seconds: 2, capture: 'mobile' },
  { id: 'ink', kind: 'image', seconds: 2 },
  { id: 'end', kind: 'title', seconds: 3, text: 'STAY HUMAN. MAKE STRANGE THINGS.' }
]
const clip = (w, h) => ({ clip: { frames_dir: 'plates/x', n: 1, fps: 30, w, h, pattern: '%05d.png' } })
const media = { eye: clip(1920, 1080), maker: clip(1376, 768), phone: clip(780, 1688), ink: clip(1920, 1088) }
const base = { scenes, format: { width: 1920, height: 1088 }, colors: ['#f1ede5', '#100c0e', '#de374f'], media, logo: clip(364, 198), site: { name: 'Infinite Variance', host: 'infinitevariance.ai', ctas: ['Let’s make something ↗'] }, font: { family: 'Barlow Condensed', url: 'media/f.ttf', measure } }
const beats = Array.from({ length: 40 }, (_, k) => k * 0.625)

check('the storyboard on the beat', () => {
  const cut = firstCut({ ...base, beats, music: { assetId: 'm', duration: 20, end: null } })
  assert.equal(cut.seconds, 17.5)
  assert.equal(cut.timeline.canvas.frames, 525)
  // every inner cut is on a beat or where the storyboard put it
  cut.bounds.slice(1, -1).forEach((b) => assert.ok(beats.some((x) => Math.abs(x - b) < 1e-9) || [1.5, 4, 9, 10.5, 12.5, 14.5].includes(b)))
  assert.equal(cut.timeline.shots[0].transition, undefined)
  // the phone screen is shown whole, the hero covers the frame
  const byClip = Object.fromEntries(cut.timeline.shots.filter((s) => s.clip).map((s) => [s.clip, s]))
  assert.equal(byClip.phone.cam.fit, 'contain')
  assert.equal(byClip.eye.cam.fit, 'cover')
  // the end title over the darkened ink, then the logo
  assert.ok(byClip.logo.f1 === 525 && byClip.logo.f1 - byClip.logo.f0 >= 48)
  assert.ok(cut.timeline.shots.some((s) => s.clip === 'ink' && s.look))
  assert.deepEqual(cut.timeline.audio_tracks, [{ asset_id: 'm', start: 0, duration: 17.7, at: 0, fade_out: 1.2 }])
})

check('every line fits the frame', () => {
  for (const format of [{ width: 1920, height: 1088 }, { width: 1088, height: 1920 }, { width: 1440, height: 1440 }]) {
    const cut = firstCut({ ...base, format, beats })
    for (const t of cut.timeline.text) {
      const w = measure(t.text) * t.size + (t.tracking || 0) * t.text.length
      assert.ok(w <= format.width * 0.9, `${t.text} is ${Math.round(w)} px wide in ${format.width}`)
      assert.ok(t.pos[1] > 0.05 && t.pos[1] < 0.95)
    }
    // the hook's question mark sits right after its words
    const [what, mark] = cut.timeline.text.filter((t) => t.f0 < 10)
    assert.equal(mark.text, '?')
    assert.ok(Math.abs(what.pos[0] * format.width + (measure('WHAT IF') * what.size) / 2 - (mark.pos[0] * format.width - (measure('?') * mark.size) / 2)) < 1)
  }
})

check('ends on the music', () => {
  const cut = firstCut({ ...base, beats, music: { assetId: 'm', duration: 18, end: 16 } })
  assert.ok(Math.abs(cut.seconds - 16.2) < 0.05, `${cut.seconds}`)
  // the end card keeps its length; the time came out of the other scenes
  assert.ok(cut.bounds.at(-1) - cut.bounds.at(-2) >= 2.8)
  assert.ok(cut.bounds[3] - cut.bounds[2] >= 3)
})

check('voice-over lines in turn, with the music under them', () => {
  const cut = firstCut({ ...base, beats, music: { assetId: 'm', duration: 20, end: null }, voiceover: [{ assetId: 'v1', duration: 3 }, { assetId: 'v2', duration: 2 }] })
  const [m, v1, v2] = cut.timeline.audio_tracks
  assert.equal(m.gain_db, -7)
  assert.ok(v1.at >= 1.2 && v2.at >= v1.at + 3.3, `${v1.at} ${v2.at}`)
})

check('no logo: the name instead', () => {
  const cut = firstCut({ ...base, logo: null, beats })
  assert.ok(cut.timeline.text.some((t) => t.text === 'INFINITE VARIANCE'))
  assert.ok(!cut.timeline.clips.logo)
})

console.log(`\n${passed} passed`)
