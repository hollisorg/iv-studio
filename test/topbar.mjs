// Settings → Top bar (topbar.js): each top-bar item can be hidden, the cloud cost on its own, and nothing but known
// switches is saved. The logo, the ComfyUI status and a running setup always show.  node test/topbar.mjs
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { cleanTopBar, onTopBar, TOP_BAR } from '../src/renderer/src/topbar.js'

let n = 0
let failed = 0
const ok = (name, fn) => {
  n++
  try {
    fn()
    console.log('ok', name)
  } catch (err) {
    failed++
    console.log('FAIL', name, '-', err.message)
  }
}
const src = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8')

ok('everything shows until it is switched off', () => {
  for (const [id] of TOP_BAR) assert.equal(onTopBar(null, id), true)
  assert.equal(onTopBar({ cloudCost: false }, 'cloudCost'), false)
  assert.equal(onTopBar({ cloudCost: false }, 'cloudMeter'), true)
})

ok('only true or false for known items is kept', () => {
  assert.deepEqual(cleanTopBar({ cloudCost: false, chat: true, logo: false, meter: 'no', __proto__x: false }), { cloudCost: false, chat: true })
  assert.equal(cleanTopBar('x'), null)
  assert.equal(cleanTopBar(null), null)
})

ok('each item has a label and a plain hint, and the cloud cost is its own switch', () => {
  assert.ok(TOP_BAR.every(([id, label, hint]) => id && label && hint && !/—/.test(hint)))
  assert.ok(TOP_BAR.some(([id]) => id === 'cloudCost'))
})

ok('the top bar reads every switch, and keeps the logo, the ComfyUI status and the setup pill', () => {
  const app = src('../src/renderer/src/App.jsx')
  for (const [id] of TOP_BAR) assert.ok(app.includes(`bar('${id}')`), `App.jsx reads ${id}`)
  assert.match(app, /<IVWorkspace /)
  assert.match(app, /<SetupPill /)
  assert.match(app, /'ComfyUI ready'/)
  assert.match(app, /showCost=\{bar\('cloudCost'\)\}/)
})

ok('the cloud meter leaves out the money when asked', () => {
  const cloud = src('../src/renderer/src/components/Cloud.jsx')
  assert.match(cloud, /export function CloudMeter\(\{ onOpen, showCost = true \}\)/)
  assert.match(cloud, /\{showCost && ` · \$\$\{cost\.toFixed\(2\)\}`\}/)
})

ok('Settings has the Top bar card, and the main process cleans what it saves', () => {
  const settings = src('../src/renderer/src/components/Settings.jsx')
  assert.match(settings, /\['topbar', 'Top bar'\]/)
  assert.match(settings, /<TopBarCard n=\{n\('topbar'\)\}/)
  // one short row and a pop-up, not a switch per item down the page (Matthew, 2026-11-23)
  assert.match(settings, /Customize top bar/)
  assert.match(settings, /function TopBarPicker\(/)
  assert.match(settings, /role="dialog" aria-modal="true" aria-labelledby="topbar-title"/)
  assert.ok(!/TOP_BAR\.map\(\(\[id, label, hint\]\) => \(\s*<SetField/.test(settings), 'no SetField per item')
  assert.match(src('../src/main/index.js'), /if \('topBar' in safe\) safe\.topBar = cleanTopBar\(safe\.topBar\)/)
})

console.log(`\n${n - failed} of ${n} passed`)
if (failed) process.exit(1)
