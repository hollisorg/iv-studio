// GitHub #49 and #50.
// #49: each run on the Shot page says when it finished (runTime.js).
// #50: Start ComfyUI's wait can be stopped (comfylauncher.js waitUp with a signal), so a launcher that asks
//      something before starting ComfyUI no longer keeps the button greyed out for 6 minutes.
//   node test/issues-49-50.mjs
import fs from 'node:fs'
import { runTime } from '../src/renderer/src/runTime.js'
import { STOPPED_WAITING, waitUp } from '../src/service/comfylauncher.js'

let failed = 0
const check = (name, ok, more = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !more ? '' : `: ${more}`}`)
  if (!ok) failed++
}

// ---------- #49 ----------
const now = new Date(2026, 10, 21, 12, 0)
const done = runTime({ createdAt: new Date(2026, 10, 20, 15, 30).toISOString(), finishedAt: new Date(2026, 10, 20, 15, 42).toISOString() }, { now, locale: 'en-GB' })
check('a finished run says Finished, with day, month and time', done?.label === 'Finished 20 Nov, 15:42', done?.label)
check('the full date and time are in its title', /2026/.test(done?.title || '') && /15:42/.test(done?.title || ''), done?.title)
check('it gives a machine-readable time', done?.at === new Date(2026, 10, 20, 15, 42).toISOString())
const going = runTime({ createdAt: new Date(2026, 10, 21, 11, 5).toISOString() }, { now, locale: 'en-GB' })
check('a run still going says when it started', going?.label === 'Started 21 Nov, 11:05', going?.label)
const old = runTime({ createdAt: '2025-03-02T09:00:00Z', finishedAt: new Date(2025, 2, 2, 9, 7).toISOString() }, { now, locale: 'en-GB' })
check('a run from another year shows the year', /2025/.test(old?.label || ''), old?.label)
check('this year’s runs leave the year out', !/2026/.test(done?.label || ''))
check('no times, no label', runTime({}) === null && runTime(null) === null && runTime({ createdAt: 'not a date' }) === null)
const us = runTime({ finishedAt: new Date(2026, 10, 20, 15, 42).toISOString() }, { now, locale: 'en-US' })
check('it follows the PC’s own date style', us?.label === 'Finished Nov 20, 3:42 PM', us?.label)

// ---------- #50 ----------
{
  const ac = new AbortController()
  let asked = 0
  const t0 = Date.now()
  setTimeout(() => ac.abort(), 150)
  const err = await waitUp('http://127.0.0.1:1', { every: 10_000, signal: ac.signal, up: async () => (asked++, false) }).catch((e) => e)
  check('stopping the wait ends it at once, not at the next check', Date.now() - t0 < 1000, `${Date.now() - t0} ms`)
  check('it ends with code stopped and the stopped message', err?.code === 'stopped' && err.message === STOPPED_WAITING, err?.message)
  check('it had asked ComfyUI once before the stop', asked === 1, String(asked))
}
{
  const ac = new AbortController()
  ac.abort()
  let asked = 0
  const err = await waitUp('x', { signal: ac.signal, up: async () => (asked++, true) }).catch((e) => e)
  check('an already-stopped wait doesn’t ask ComfyUI', err?.code === 'stopped' && asked === 0)
}
{
  let n = 0
  const r = await waitUp('x', { every: 5, signal: new AbortController().signal, up: async () => ++n >= 3 })
  check('without a stop it still waits until ComfyUI answers', typeof r.seconds === 'number' && n === 3)
}
{
  const err = await waitUp('x', { every: 5, timeoutMs: 30, up: async () => false }).catch((e) => e)
  check('the 6-minute timeout still says so, with no stopped code', !err.code && /didn’t answer/.test(err.message), err.message)
}
check('the stopped message tells the person what to do next', /Check again/.test(STOPPED_WAITING) && /Start ComfyUI/.test(STOPPED_WAITING) && !/—/.test(STOPPED_WAITING))

// the wiring: main can stop the wait, the window has Stop waiting, Check again stops it too, the Shot page shows the time
const main = fs.readFileSync(new URL('../src/main/index.js', import.meta.url), 'utf8')
const preload = fs.readFileSync(new URL('../src/preload/index.js', import.meta.url), 'utf8')
const start = fs.readFileSync(new URL('../src/renderer/src/components/StartComfy.jsx', import.meta.url), 'utf8')
const setup = fs.readFileSync(new URL('../src/renderer/src/components/Setup.jsx', import.meta.url), 'utf8')
const shot = fs.readFileSync(new URL('../src/renderer/src/components/Shot.jsx', import.meta.url), 'utf8')
check('main passes a stop signal to the wait', /waitUp\(s\.comfyUrl, \{ signal: comfyWait\.signal \}\)/.test(main))
check('main has comfy:stopWaiting and clears the launch note', /handle\('comfy:stopWaiting'/.test(main) && /rmSync\(launchMarker\(\)/.test(main))
check('the preload exposes stopWaiting', /stopWaiting: call\('comfy:stopWaiting'\)/.test(preload))
check('Start ComfyUI shows Stop waiting while it waits', /Stop waiting/.test(start) && /comfy\.stopWaiting\(\)/.test(start))
check('Check again stops a wait too', /comfy\.stopWaiting\(\)[^\n]*finally\(recheck\)/.test(setup))
check('the Shot page shows each run’s time', /runTime\(run\)/.test(shot) && /<time className="run-time/.test(shot))

console.log(failed ? `\n${failed} failed` : '\nall passed')
process.exit(failed ? 1 : 0)
