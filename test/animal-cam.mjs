// Animal Cam: beat times on H3's frame grid, the prompt (positive only, the check beat, the sound list), the animal as a
// referenced subject, the checklist, the writer's beats, and the service against a stand-in studio, with a real phone
// finish through the bundled ffmpeg.   node test/animal-cam.mjs
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { AnimalCams, applyBeats, beatsBrief, beatTimes, buildPrompt, checklist, cleanCam, FIXES, phoneArgs, realSeconds, sheetPrompt, withGenre, withWho } from '../src/service/animalcam.js'
import { lintPrompt, negativePhrases } from '../src/service/lint.js'
import { resolveMentions } from '../src/service/cast.js'

let n = 0
let failed = 0
const ok = async (name, fn) => {
  try {
    await fn()
    n++
    console.log(`ok   ${name}`)
  } catch (err) {
    failed++
    console.log(`FAIL ${name} -> ${err.message}`)
  }
}

// a complete, fictional gym clip
const gym = () =>
  withGenre(
    {
      name: 'Leg day',
      animal: { name: 'Shadow', species: 'cat', sheet: '/x/sheet.png', outfit: ['a straw hat', 'red suspenders', 'printed shorts'], cm: 32 },
      idea: 'A cat does one heavy rep on a leg press',
      seconds: 10,
      filmer: { distance: 'close', side: 'on the machine’s right side', facing: 'frame right', move: 'none' },
      scene: { anchor: 'the foot plate is wider than his whole body', extras: [{ who: 'a man in a grey T-shirt', task: 'walks on a treadmill with both hands on the side rails', thing: 'the treadmill' }], bystander: 'A woman by the dumbbell rack keeps her eyes on her phone the whole time' },
      action: { what: 'one heavy rep on a 45-degree leg press', equipment: 'a 45-degree plate-loaded leg press', load: 'heavy' },
      beats: {
        hook: 'Shadow lies back in the seat, both hind paws pressed flat on the foot plate; his right forepaw pushes the safety handle out with a clack.',
        build: 'The sled lowers toward him at normal speed, his knees folding to his chest; whiskers pressed back, eyes narrowing.',
        progress: 'At the bottom the seat cushion dips under his back and his hind legs shake against the load.',
        payoff: 'He drives the sled up in one shaking push, hind legs almost straight.',
        ending: 'He pushes the safety handle back in and rests, chest rising and falling.'
      },
      sound: { hook: 'a sharp metallic clack of the safety stop', hookAt: 0.6, more: ['the sled rolling on its rails', 'plates rattling softly'], animal: 'one low strained meow', animalAt: 7.2, random: 'a distant phone chime', randomAt: 4 }
    },
    'gym'
  )

await ok('beat times start at 0, end at H3’s real length and only go up', () => {
  for (const s of [5, 10, 15]) {
    const t = beatTimes(s)
    assert.equal(t[0].from, 0)
    assert.equal(t.at(-1).to, Math.round(realSeconds(s) * 10) / 10)
    t.forEach((b, i) => {
      assert.ok(b.to > b.from, `${s}s ${b.key}`)
      if (i) assert.equal(b.from, t[i - 1].to)
    })
  }
  assert.deepEqual(beatTimes(10).map((b) => b.key), ['hook', 'build', 'progress', 'check', 'payoff', 'ending'])
  assert.deepEqual(beatTimes(5).map((b) => b.key), ['hook', 'build', 'payoff', 'ending'])
  assert.equal(realSeconds(10), 10.125)
  assert.equal(cleanCam({ seconds: 7 }).seconds, 10)
})

await ok('the prompt has H3’s sections, music N/A and one continuous take', () => {
  const p = buildPrompt(gym(), { who: '@Shadow' })
  assert.match(p, /^integrated_multimodal_description: \[Shot 1\] Live-action ordinary phone video, vertical/)
  assert.match(p, /\n\noverall_soundscape: Only these sounds are heard/)
  assert.match(p, /non_diegetic_music: N\/A$/)
  assert.match(p, /It is one continuous take with no cuts\./)
  assert.match(p, /normal real-time speed/)
})

await ok('the prompt is written positively: nothing H3 would show by mistake', () => {
  const p = buildPrompt(gym(), { who: '@Shadow' })
  assert.deepEqual(negativePhrases(p), [])
  for (const genre of ['gym', 'comedy', 'secret', 'horror', 'wholesome']) assert.deepEqual(negativePhrases(buildPrompt(withGenre({ ...gym(), genre }, genre), { who: '@Shadow' })), [], genre)
})

await ok('the check beat repeats the outfit, the size anchor and the facing', () => {
  const p = buildPrompt(gym(), { who: '@Shadow' })
  const check = p.match(/From 5\.1 to 6\.6 seconds: ([^]*?)From/)?.[1] || ''
  assert.match(check, /@Shadow’s straw hat, red suspenders and printed shorts stay exactly as in the reference picture/)
  assert.match(check, /the size is unchanged: the foot plate is wider than his whole body/)
  assert.match(buildPrompt({ ...gym(), animal: { ...gym().animal, outfit: ['a yellow raincoat'] } }, { who: '@Shadow' }), /@Shadow’s yellow raincoat stays exactly/)
  assert.match(check, /still faces frame right/)
  // a 5 s clip has no check beat: the payoff carries it
  const short = buildPrompt({ ...gym(), seconds: 5 }, { who: '@Shadow' })
  assert.match(short.match(/From 3\.1 to [\d.]+ seconds: ([^]*?)From/)?.[1] || '', /stay exactly as in the reference picture/)
})

await ok('the payoff times the animal’s sound and its mouth; the sound list is closed', () => {
  const p = buildPrompt(gym(), { who: '@Shadow' })
  assert.match(p, /One low strained meow peaks at 7\.2 s: @Shadow’s mouth opens at its widest natural opening as the sound peaks and closes only after the sound ends/)
  const sound = p.split('overall_soundscape: ')[1]
  assert.match(sound, /a sharp metallic clack of the safety stop at 0\.6 s/)
  assert.match(sound, /a distant phone chime at 4\.0 s, which everyone ignores/)
  assert.match(sound, /the filmer’s quiet breathing/)
  assert.match(sound, /No one speaks\./)
})

await ok('the prompt passes IV Studio’s prompt checker with no errors', () => {
  const p = buildPrompt(gym(), { who: '@Shadow' })
  assert.deepEqual(lintPrompt(p, { mode: 'text', seconds: 10, media: [] }).filter((x) => x.level === 'error'), [])
})

await ok('the animal goes in as a referenced subject with its sheet attached', () => {
  const c = gym()
  const prompt = withWho(buildPrompt(c, { who: '@Shadow' }), c, '@Shadow')
  // the beats name him Shadow; every mention becomes the subject
  assert.ok(!/(^|[^@])\bShadow\b/.test(prompt.replace(/@Shadow/g, '')))
  const { request } = resolveMentions({ prompt, mode: 'text', character: 'none' }, [{ handle: 'Shadow', kind: 'animal', id: 'ac:1', name: 'Shadow', picture: '/x/sheet.png', description: 'a cat wearing a straw hat' }])
  assert.equal(request.mode, 'reference')
  assert.deepEqual(request.media, [{ kind: 'picture', file: '/x/sheet.png' }])
  assert.match(request.prompt, /<Subject 1> is Shadow, the animal in <Picture 1>, a cat wearing a straw hat\./)
  assert.match(request.prompt, /everything it wears, exactly as pictured/)
  assert.ok(!request.prompt.includes('@Shadow'))
})

await ok('a complete clip ticks every checklist item', () => {
  const c = gym()
  const items = checklist(c, { prompt: buildPrompt(c, { who: '@Shadow' }), lintCtx: { mode: 'text', seconds: 10, media: [] } })
  assert.deepEqual(items.filter((x) => !x.ok).map((x) => x.key), [])
  assert.ok(items.length >= 15)
})

await ok('the checklist catches gripping, slow motion, a dry animal in the rain and missing strain', () => {
  const miss = (patch) => checklist({ ...gym(), ...patch }).filter((x) => !x.ok).map((x) => x.key)
  assert.ok(miss({ beats: { ...gym().beats, build: 'Shadow grips the handles with his fingers.' } }).includes('paws'))
  assert.ok(miss({ beats: { ...gym().beats, build: 'His forepaws grab the bar.' } }).includes('paws'))
  assert.ok(!miss({ beats: { ...gym().beats, ending: 'Behind him the teenage girl keeps scrolling, thumb on her phone.' } }).includes('paws'), 'a person’s thumb is fine')
  assert.ok(miss({ beats: { ...gym().beats, payoff: 'In slow motion he pushes the sled up, legs shaking.' } }).includes('speed'))
  assert.ok(miss({ scene: { ...gym().scene, place: 'a gym car park in the pouring rain' } }).includes('state'))
  assert.ok(!miss({ animal: { ...gym().animal, state: 'soaked' }, scene: { ...gym().scene, place: 'a gym car park in the rain' } }).includes('state'))
  assert.ok(miss({ beats: { hook: 'a', build: 'b', progress: 'c', payoff: 'd', ending: 'e' } }).includes('effort'))
  assert.ok(miss({ scene: { ...gym().scene, bystander: '' } }).includes('bystander'))
  assert.ok(miss({ sound: { ...gym().sound, hook: '' } }).includes('hook'))
  assert.ok(miss({ sound: { ...gym().sound, hookAt: 3 } }).includes('hook'))
  assert.ok(miss({ sound: { ...gym().sound, animal: 'meow' } }).includes('vocal'))
  assert.ok(miss({ beats: { ...gym().beats, ending: 'Steam rises from his fur.' } }).includes('vapour'))
  assert.ok(miss({ scene: { ...gym().scene, extras: [{ who: 'a man', task: 'lifts and talks', thing: 'a bar' }] } }).includes('tasks'))
  assert.ok(miss({ filmer: { ...gym().filmer, side: '' } }).includes('sides'))
  assert.ok(miss({ animal: { ...gym().animal, sheet: null } }).includes('sheet'))
  assert.ok(miss({ filmer: { ...gym().filmer, move: 'whip' } }).includes('camera') === false, 'a move has its own trigger')
})

await ok('the checklist flags a negative a person wrote into a beat', () => {
  const c = { ...gym(), beats: { ...gym().beats, ending: 'He rests on the seat with no people around him.' } }
  const items = checklist(c, { prompt: buildPrompt(c, { who: '@Shadow' }) })
  const pos = items.find((x) => x.key === 'positive')
  assert.equal(pos.ok, false)
  assert.match(pos.why, /no people/)
})

await ok('the writer’s beats fill the empty beats, with the animal’s name', () => {
  const c = { ...gym(), beats: { hook: 'kept as written' } }
  const out = applyBeats(c, { beats: { hook: 'new hook', build: '{animal} presses the plate.', payoff: 'p', ending: 'e', progress: 'g', check: 'c' }, hook_sound: 'a clank' })
  assert.equal(out.beats.hook, 'kept as written')
  assert.equal(out.beats.build, 'Shadow presses the plate.')
  assert.equal(out.sound.hook, 'a sharp metallic clack of the safety stop')
  assert.equal(applyBeats(c, { beats: { hook: 'new hook' } }, { overwrite: true }).beats.hook, 'new hook')
  // a 5 s clip takes only its four beats
  assert.equal(applyBeats({ ...c, seconds: 5 }, { beats: { progress: 'x' } }).beats.progress, undefined)
  const brief = beatsBrief(c)
  assert.match(brief.system, /Never write that it grips/)
  assert.match(brief.user, /hook 0-1\.5/)
})

await ok('a genre fills only what is empty; the sheet prompt keeps the outfit', () => {
  const c = withGenre({ scene: { place: 'my own kitchen' } }, 'horror')
  assert.equal(c.scene.place, 'my own kitchen')
  assert.match(c.scene.light, /weak bulb/)
  assert.equal(withGenre({}, 'secret').filmer.distance, 'secret')
  const sp = sheetPrompt(gym(), { fromPhoto: true })
  assert.match(sp, /three-panel studio reference sheet of the cat in the picture/)
  assert.match(sp, /a straw hat, red suspenders and printed shorts/)
  assert.ok(FIXES.length >= 8 && FIXES.every((f) => f.step >= 0 && f.step <= 6))
})

// ---------- the service against a stand-in studio ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'animalcam-'))
const FFMPEG = ffmpegStatic.ffmpegPath
const clip = path.join(tmp, 'final.mp4')
const sheetFile = path.join(tmp, 'sheet.png')
spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=544x960:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clip])
spawnSync(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=white:size=640x360', '-frames:v', '1', sheetFile])
const jobs = {}
const asked = []
const studio = {
  characters: () => [],
  cast: { members: () => [{ handle: 'Tess', kind: 'character' }] },
  createProject: (name) => ({ id: 'proj1', name }),
  deleteProject: () => {},
  generatePreviews: async (r) => (asked.push(r), (jobs.p1 = { id: 'p1', status: 'success', outputs: [{ kind: 'preview', candidate: 1 }] })),
  finishCandidate: async (r) => (asked.push(r), (jobs.f1 = { id: 'f1', status: 'success', outputs: [{ kind: 'final', path: clip, url: 'x' }] })),
  getJob: (id) => jobs[id],
  publicJob: (j) => j,
  refreshJob: async () => {}
}
const editsMade = []
const edits = {
  create: (name) => ({ id: 'e1', name, settings: {}, clips: [], media: {}, tracks: [], markers: [] }),
  addMedia: async (file) => ({ id: 'm1', file, duration: 1 }),
  write: (e) => editsMade.push(e)
}
const cams = new AnimalCams({ dataDir: tmp, studio, edits, ask: async () => ({ beats: { hook: 'h', build: 'b', progress: 'p', payoff: 'y', ending: 'e' } }) })

await ok('create, save and keep the sheet in the animal cam’s folder', () => {
  const c = cams.create({ name: 'Leg day', genre: 'gym' })
  assert.match(c.scene.place, /gym/)
  cams.save(c.id, { ...gym(), animal: { ...gym().animal, sheet: null } })
  const s = cams.setSheet(c.id, sheetFile)
  assert.ok(s.animal.sheet.startsWith(path.join(tmp, 'animalcams', c.id)))
  assert.equal(cams.list()[0].name, 'Leg day')
  cams.saved = c.id
})

await ok('hunt sends a vertical text shot with the animal as a member picture', async () => {
  const id = cams.saved
  assert.equal(cams.check(id).misses, 0)
  await cams.hunt(id)
  const r = asked.at(-1)
  assert.equal(r.aspect, '9:16')
  assert.equal(r.seconds, 10)
  assert.equal(r.character, 'none')
  assert.equal(r.members[0].kind, 'animal')
  assert.equal(r.members[0].handle, 'Shadow')
  assert.match(r.prompt, /@Shadow is a real cat at real cat size, about 32 cm at the shoulder/)
})

await ok('a checklist miss stops the hunt unless asked to render anyway', async () => {
  const id = cams.saved
  cams.save(id, { scene: { bystander: '' } })
  await assert.rejects(() => cams.hunt(id), /checklist has 1 miss/)
  await cams.hunt(id, { anyway: true })
  cams.save(id, { scene: { bystander: 'A man reads his phone by the water cooler' } })
})

await ok('finish, the phone finish and the edit', async () => {
  const id = cams.saved
  await cams.hunt(id)
  await cams.finish(id, { candidate: 1 })
  const v = await cams.refresh(id)
  assert.equal(v.state.fresh, true)
  const r = await cams.assemble(id)
  assert.equal(r.editId, 'e1')
  assert.ok(fs.existsSync(r.file) && /phone-/.test(r.file))
  const probe = spawnSync(FFMPEG, ['-i', r.file], { encoding: 'utf8' }).stderr
  assert.match(probe, /1080x1920/)
  assert.match(probe, /24 fps/)
  assert.equal(editsMade.at(-1).settings.format, 'vertical')
  // a change to the clip makes the take stale
  cams.save(id, { beats: { ending: 'He looks at the lens.' } })
  assert.equal(cams.view(id).state.changed, true)
  assert.deepEqual(phoneArgs('a', 'b').slice(0, 3), ['-y', '-i', 'a'])
})

await ok('draft the beats through the writer', async () => {
  const c = cams.create({ genre: 'comedy' })
  const out = await cams.draftBeats(c.id)
  assert.equal(out.beats.hook, 'h')
  assert.equal(cams.get(c.id).beats.payoff, 'y')
})

await ok('the window’s “What broke?” list is the service’s, word for word', () => {
  const jsx = fs.readFileSync(new URL('../src/renderer/src/components/AnimalCam.jsx', import.meta.url), 'utf8')
  for (const f of FIXES) assert.ok(jsx.includes(`{ key: '${f.key}', label: '${f.label}', step: ${f.step}, tip: '${f.tip}' }`), f.key)
})

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`\n${n} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
