// The Workflows cards' Example pop-ups (workflows.js example, WorkflowExample.jsx, resources/examples).
//   node test/workflow-examples.mjs
// Every example's files are there and match examples.json, stay inside the size budget and 12 s, have a poster,
// have sound when they say so; a compare's two videos line up; the words follow the house style; and the page,
// the pop-up and main are wired to them.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { WORKFLOWS } from '../src/renderer/src/workflows.js'

const require = createRequire(import.meta.url)
const DIR = new URL('../resources/examples/', import.meta.url)
const file = (n) => new URL(n, DIR)
const BUDGET = 25 * 1024 * 1024
const MAX_SECONDS = 12
// a long example (Sequences: three 10 s shots in one take) may run to this
const LONG_SECONDS = 32
// tools that have no Example on purpose (Reel's was dropped, Matthew 2026-11-23)
const NO_EXAMPLE = ['reel']

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}

const manifest = JSON.parse(fs.readFileSync(file('examples.json'), 'utf8'))
const listed = manifest.files || {}
const onDisk = fs.readdirSync(DIR).filter((n) => n !== 'examples.json')

// ---------- the folder and its manifest ----------
check('examples.json lists exactly the files in resources/examples', JSON.stringify(Object.keys(listed).sort()) === JSON.stringify([...onDisk].sort()), onDisk.filter((n) => !listed[n]).concat(Object.keys(listed).filter((n) => !onDisk.includes(n))).join(', '))
const total = onDisk.reduce((a, n) => a + fs.statSync(file(n)).size, 0)
check(`all of it fits the ${BUDGET / 1048576} MB budget`, total <= BUDGET, `${(total / 1048576).toFixed(1)} MB`)
for (const n of onDisk) {
  const buf = fs.readFileSync(file(n))
  const sha = crypto.createHash('sha256').update(buf).digest('hex')
  if (listed[n] && (listed[n].sha256 !== sha || listed[n].bytes !== buf.length)) check(`${n} matches examples.json`, false, 'remake it with scripts/make-examples.mjs')
}
check('every file is H.264 MP4 or WebP', onDisk.every((n) => /\.(mp4|webp)$/.test(n)), onDisk.filter((n) => !/\.(mp4|webp)$/.test(n)).join(', '))

// what ffprobe says (the shipped ffmpeg), not only the manifest
let ffprobe = null
try {
  ffprobe = require('ffmpeg-ffprobe-static').ffprobePath
} catch {}
const probe = (n) => {
  if (!ffprobe) return null
  const p = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height', '-of', 'json', file(n).pathname.replace(/^\/(\w:)/, '$1')]).toString())
  const v = p.streams.find((s) => s.codec_type === 'video')
  return { seconds: Number(p.format.duration), codec: v?.codec_name, width: v?.width, height: v?.height, audio: p.streams.some((s) => s.codec_type === 'audio') }
}

// integrated loudness (EBU R128) by the shipped ffmpeg; null when it can't be measured here
const loudness = (n) => {
  let ffmpeg
  try {
    ffmpeg = require('ffmpeg-ffprobe-static').ffmpegPath
  } catch {
    return null
  }
  // ffmpeg prints the summary on stderr; the last "I:" line is the whole file's
  const r = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', file(n).pathname.replace(/^\/(\w:)/, '$1'), '-af', 'ebur128', '-f', 'null', '-'], { encoding: 'utf8' })
  const all = [...String(r.stderr || '').matchAll(/I:\s+(-?[\d.]+) LUFS/g)]
  return all.length ? Number(all.at(-1)[1]) : null
}

// ---------- each workflow's example ----------
const used = new Set()
const KINDS = ['compare', 'steps', 'video']
const words = []
for (const w of WORKFLOWS) {
  const ex = w.example
  if (!ex) {
    console.log(`  (${w.name} has no example yet, so no Example button)`)
    continue
  }
  check(`${w.name}: a known kind`, KINDS.includes(ex.kind), ex.kind)
  const videos = ex.kind === 'compare' ? ex.tabs.flatMap((t) => [t.before, t.after]) : [ex.video]
  const pictures = ex.kind === 'steps' ? ex.inputs.map((i) => i.picture) : []
  for (const n of [...videos, ...pictures]) {
    used.add(n)
    check(`${w.name}: ${n} is there`, onDisk.includes(n))
  }
  for (const n of videos) {
    const poster = n.replace(/\.mp4$/, '.webp')
    used.add(poster)
    check(`${w.name}: ${n} has its poster`, onDisk.includes(poster))
    const p = onDisk.includes(n) ? probe(n) : null
    if (!p) continue
    const max = ex.long ? LONG_SECONDS : MAX_SECONDS
    check(`${w.name}: ${n} is H.264, at most ${max} s`, p.codec === 'h264' && p.seconds <= max + 0.15, `${p.codec}, ${p.seconds.toFixed(2)} s`)
    check(`${w.name}: ${n} is at most 720 px on its short side`, Math.min(p.width, p.height) <= 720, `${p.width} x ${p.height}`)
    if (ex.sound && n === ex.video) {
      check(`${w.name}: ${n} has the sound it offers`, p.audio)
      const lufs = p.audio ? loudness(n) : null
      if (lufs != null) check(`${w.name}: ${n} is at the examples’ one loudness (-16 LUFS, within 2)`, Math.abs(lufs + 16) <= 2, `${lufs} LUFS`)
    }
  }
  if (ex.kind === 'compare') {
    check(`${w.name}: every compare tab has a label, before, after and words`, ex.tabs.every((t) => t.label && t.before && t.after && t.text))
    for (const t of ex.tabs) {
      const a = onDisk.includes(t.before) && probe(t.before)
      const b = onDisk.includes(t.after) && probe(t.after)
      if (a && b) {
        check(`${w.name} (${t.label}): before and after run the same length`, Math.abs(a.seconds - b.seconds) < 0.3, `${a.seconds.toFixed(2)} / ${b.seconds.toFixed(2)} s`)
        check(`${w.name} (${t.label}): before and after have the same shape`, Math.abs(a.width / a.height - b.width / b.height) < 0.02, `${a.width}x${a.height} / ${b.width}x${b.height}`)
      }
      words.push([`${w.name} (${t.label})`, t.text])
    }
  } else {
    words.push([w.name, ex.text])
  }
  if (ex.kind === 'steps') check(`${w.name}: 1 to 6 pictures went in`, ex.inputs.length >= 1 && ex.inputs.length <= 6)
  if (ex.strip) {
    const p = onDisk.includes(ex.video) ? probe(ex.video) : null
    const inOrder = ex.strip.every((s, i) => s.start < s.end && (i === 0 || s.start >= ex.strip[i - 1].end - 0.01))
    check(`${w.name}: the strip's parts are in order and inside the video`, inOrder && (!p || ex.strip.at(-1).end <= p.seconds + 0.2), JSON.stringify(ex.strip))
  }
}
check('nothing in resources/examples goes unused', onDisk.every((n) => used.has(n)), onDisk.filter((n) => !used.has(n)).join(', '))
check('every tool has an example (but the ones left without on purpose)', WORKFLOWS.every((w) => w.example || NO_EXAMPLE.includes(w.page)), WORKFLOWS.filter((w) => !w.example && !NO_EXAMPLE.includes(w.page)).map((w) => w.name).join(', '))
check('the tools left without an example have none', NO_EXAMPLE.every((p) => WORKFLOWS.some((w) => w.page === p && !w.example)))
check('only Sequences runs long', WORKFLOWS.filter((w) => w.example?.long).every((w) => w.page === 'sequences'))

// ---------- the words ----------
for (const [who, text] of words) {
  check(`${who}: one plain paragraph`, typeof text === 'string' && text.length > 60 && text.length < 420 && !/\n/.test(text), `${text?.length} chars`)
  check(`${who}: no em dashes`, !/—/.test(text))
}

// ---------- the wiring ----------
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')
const page = src('../src/renderer/src/components/Workflows.jsx')
const pop = src('../src/renderer/src/components/WorkflowExample.jsx')
const main = src('../src/main/index.js')
const pkg = JSON.parse(src('../package.json'))
check('a card is a box holding the open button and Example (no button inside a button)', /<div key=\{t\.page\} className="workflow-card">/.test(page) && /className="workflow-open"/.test(page) && /workflow-example/.test(page) && !/<button[^>]*className="workflow-card"/.test(page))
check('Example only shows for a tool that has one', /\{t\.example && \(/.test(page))
check('closing puts focus back on the Example button', /opener\.current\?\.focus\(\)/.test(page))
check('Try it opens the tool', /onTry=\{\(\) => \(setShowing\(null\), go\(showing\.page\)\)\}/.test(page))
check('a picture-in example can show its labelled parts too', /function Strip\(/.test(pop) && (pop.match(/<Strip parts=\{ex\.strip\}/g) || []).length === 2)
check('the pop-up is a labelled modal dialog titled Example', /role="dialog"/.test(pop) && /aria-modal="true"/.test(pop) && /<h2 id="wf-example-title">Example<\/h2>/.test(pop) && /aria-describedby="wf-example-text"/.test(pop))
check('Esc closes it and Tab stays inside', /e\.key === 'Escape'/.test(pop) && /e\.key === 'Tab'/.test(pop))
check('its videos start muted, and Reduce motion starts them paused', (pop.match(/<video /g) || []).length === (pop.match(/<video [^>]*\bmuted\b/g) || []).length && /reducedMotion\(\)/.test(pop) && /useState\(!stillStart\)/.test(pop))
check('there is always a Pause (moving pictures can be stopped)', /playing \? 'Pause' : 'Play'/.test(pop))
check('closing lets go of the video files', /removeAttribute\('src'\)/.test(pop))
check('the wipe line is a keyboard slider', /role="slider"/.test(pop) && /ArrowLeft/.test(pop) && /Home: 0, End: 100/.test(pop))
check('main tells the window where the examples are', /const examplesDir = path\.join\(resourcesDir\(.*\), 'examples'\)/.test(main) && /handle\('app:info', \(\) => \(\{ examplesDir,/.test(main))
check('the installer ships resources/ (so resources/examples)', (pkg.build?.extraResources || []).some((r) => r.from === 'resources'))
check('the files play through ivfile:// (mp4 and webp are allowed)', /mp4/.test(main.match(/const MEDIA_FILE = .*/)?.[0] || '') && /webp/.test(main.match(/const MEDIA_FILE = .*/)?.[0] || ''))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
