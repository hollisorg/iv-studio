// Animal Cam: animal videos that look filmed on a phone, as a seven-step wizard (Workflows → Animal Cam). The method
// (after pik.vik1's Higgsfield guide on realistic animal phone footage, in IV Studio's own words) fitted to H3:
//   1 the animal     a reference sheet (made here from a pet photo or words, or a character), its real size, outfit
//                    and state (dry, soaked...). Without an H3 LoRA it goes in as a referenced subject (cast.js kind
//                    'animal'), so its look comes from the sheet.
//   2 the idea       one line, a genre (sets defaults), a length of 5, 10 or 15 s
//   3 the filmer     an unseen person holding the phone: close, audience or secret; one special move with a reason
//   4 the scene      the place, a size anchor, extras with one task each on one named thing, a bystander who
//                    doesn't care
//   5 the action     six timed beats (hook, build, progress, check, payoff, ending) fitted to H3's real length
//   6 the sound      a closed list of the only sounds heard, a hook sound in the first 1.5 s, the animal's sound
//                    with its pitch and mouth timing
//   7 check, film    a checklist, IV Studio's prompt checker, then hunt, pick and finish like any shot, an optional
//                    phone finish, and an edit.
// H3 has no negative prompt (lint.js): every rule is written as what to show, never "no music" or "without fingers".
// The pure parts (presets, beat times, the prompt, the checklist, the fixes) are tested in test/animal-cam.mjs.
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-ffprobe-static'
import { resolveFrames } from './plan.js'
import { lintPrompt, negativePhrases } from './lint.js'
import { handleOf } from './cast.js'
import { applyOps } from './timeline.js'

const unpacked = (p) => p && p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
const FFMPEG = unpacked(ffmpegStatic.ffmpegPath)

export const AC_SECONDS = [5, 10, 15]
export const AC_EXTRAS = 3
export const AC_STEPS = ['animal', 'idea', 'filmer', 'scene', 'action', 'sound', 'film']
const PICTURE = /\.(png|jpe?g|webp|bmp)$/i
const round1 = (n) => Math.round(n * 10) / 10
const round3 = (n) => +n.toFixed(3)
const now = () => new Date().toISOString()
const str = (v, max = 400) => String(v ?? '').trim().slice(0, max)
const sentence = (s) => {
  const t = str(s, 2000)
  return t && !/[.!?]$/.test(t) ? `${t}.` : t
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const low = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}

// ---------- presets ----------
// Real size (shoulder height, or standing height for a bird), what its feet are called, how they touch things and
// its usual sound. Sizes are typical adults; the person can change them.
export const SPECIES = {
  cat: { label: 'Cat', cm: 30, measure: 'shoulder', feet: 'paws', contact: 'the paw pads press, hook or push, toes curled, as real cat paws do', sound: 'meow', pitch: 'a short low strained meow' },
  dog: { label: 'Dog', cm: 50, measure: 'shoulder', feet: 'paws', contact: 'the paw pads press and push, claws on the surface, as real dog paws do', sound: 'bark', pitch: 'one short deep bark' },
  rabbit: { label: 'Rabbit', cm: 20, measure: 'shoulder', feet: 'paws', contact: 'the furry paws press flat and the hind feet push, as a real rabbit’s do', sound: 'grunt', pitch: 'a soft short grunt' },
  hamster: { label: 'Hamster', cm: 6, measure: 'shoulder', feet: 'paws', contact: 'the tiny pink paws press and hold on with small curled toes, as a real hamster’s do', sound: 'squeak', pitch: 'a tiny high squeak' },
  parrot: { label: 'Parrot', cm: 30, measure: 'standing', feet: 'feet', contact: 'the scaly toes curl around perches and edges and the beak hooks on, as a real parrot’s do', sound: 'squawk', pitch: 'one sharp loud squawk' },
  horse: { label: 'Horse', cm: 160, measure: 'shoulder', feet: 'hooves', contact: 'the hooves press and paw at the ground, as a real horse’s do', sound: 'whinny', pitch: 'a short high whinny' },
  pig: { label: 'Pig', cm: 60, measure: 'shoulder', feet: 'trotters', contact: 'the small hard trotters press and push, as a real pig’s do', sound: 'grunt', pitch: 'a low throaty grunt' },
  goat: { label: 'Goat', cm: 70, measure: 'shoulder', feet: 'hooves', contact: 'the split hooves grip ledges by their edges and press flat, as a real goat’s do', sound: 'bleat', pitch: 'a short wavering bleat' },
  duck: { label: 'Duck', cm: 35, measure: 'standing', feet: 'webbed feet', contact: 'the orange webbed feet slap and press flat, as a real duck’s do', sound: 'quack', pitch: 'two short quacks' },
  other: { label: 'Another animal', cm: null, measure: 'shoulder', feet: 'feet', contact: 'its feet touch things the way that animal’s really do', sound: '', pitch: '' }
}
export const STATES = { dry: 'clean and dry', soaked: 'fur soaked and flattened, water dripping off it', muddy: 'fur caked with wet mud', snowy: 'snow clinging to its fur', dusty: 'fur dusty and dull' }

// What a genre starts its steps with. All of it can be changed.
export const GENRES = {
  gym: { label: 'Gym and sport', about: 'A tiny animal against a load far too big for it, in an ordinary gym.', distance: 'close', place: 'an ordinary weekday gym', floor: 'black rubber flooring', light: 'cool white overhead LED panels', time: 'a weekday afternoon', room: 'gym room tone with light reverb', ending: 'it rests, chest rising and falling, and a gym-goer notices a beat late' },
  comedy: { label: 'Everyday comedy', about: 'Played completely straight: the animal does something absurd with total seriousness, people react a beat late, and it ends on a small deadpan look.', distance: 'close', place: 'a lived-in family kitchen', floor: 'grey tiled floor', light: 'warm late-afternoon window light', time: 'late afternoon', room: 'the fridge humming and a clock ticking', ending: 'it holds a small deadpan look at the person who just noticed' },
  secret: { label: 'Caught on camera', about: 'Filmed in secret through a door gap or round a corner; nobody looks at the lens.', distance: 'secret', place: 'a quiet living room seen through a half-open door', floor: 'worn wooden floorboards', light: 'one table lamp and the blue light of a television', time: 'late evening', room: 'the low murmur of a television in the next room', ending: 'it freezes mid-action and slowly looks toward the door gap' },
  horror: { label: 'Horror', about: 'Realism makes it scary: long true quiet, real footsteps, then one loud sound exactly where the scare is.', distance: 'close', place: 'a dark upstairs hallway', floor: 'creaky wooden boards', light: 'one weak bulb at the far end, the rest in shadow', time: 'the middle of the night', room: 'near silence: a faint house hum and the filmer’s breathing', ending: 'everything goes still and silent, something still swinging gently' },
  wholesome: { label: 'Wholesome', about: 'A small warm moment that feels like it really happened.', distance: 'close', place: 'a sunny back garden', floor: 'short green lawn', light: 'soft morning sun', time: 'a weekend morning', room: 'birdsong and a distant lawnmower', ending: 'it settles contentedly and someone nearby smiles without looking up' }
}

// The filmer. Only the audience filmer zooms (and it looks like phone zoom).
export const DISTANCES = {
  close: { label: 'Close', who: 'someone standing nearby', where: 'about 2 metres away, at chest height', zoom: false },
  audience: { label: 'Audience', who: 'a bystander in the crowd', where: 'further back among other people, at head height', zoom: true },
  secret: { label: 'Secret', who: 'someone filming in secret', where: 'from behind a half-open door, the dark door edge soft in the foreground', zoom: false }
}
// One special camera move, each with what triggers it in the scene and how the phone reacts.
export const MOVES = {
  none: { label: 'No special move', reaction: '' },
  flinch: { label: 'Flinch', trigger: 'a sudden crash', reaction: 'the filmer flinches back, the frame tilts, then one correction re-centres it' },
  whip: { label: 'Whip pan', trigger: 'a sound off to one side', reaction: 'one fast whip pan toward it with a slight overshoot, then it settles on the new sight' },
  zoom: { label: 'Phone zoom', trigger: 'the peak moment, seen from far away', reaction: 'the phone zoom snaps in, the picture goes briefly soft and a little shakier, then focus comes back' },
  focus: { label: 'Focus grab', trigger: 'someone walking past close to the lens', reaction: 'focus jumps to them as they pass, the animal goes soft, then snaps sharp again' }
}
export const LOADS = { none: 'Nothing heavy', light: 'Light for it', heavy: 'Far too heavy for it' }

// ---------- the beats ----------
export const BEATS = {
  hook: { label: 'Hook', about: 'A striking action and a sharp real sound together; where the animal is looking.' },
  build: { label: 'Build', about: 'Exact mechanics: where each paw is, what it presses, the effort starting.' },
  progress: { label: 'Progress', about: 'What the object or surface does back; one focus shift if there’s a reason.' },
  check: { label: 'Check', about: 'Still the same: outfit, size against the anchor, which way it faces (IV Studio adds these).' },
  payoff: { label: 'Payoff', about: 'The strongest moment, with the animal’s sound and its mouth in time with it.' },
  ending: { label: 'Ending', about: 'Not flat: a lingering look, a late reaction, something still wobbling.' }
}
// Beat edges for each length, as written in seconds, then fitted to H3's real length (its 17n+5 frame grid at 24 fps).
// A 5 s clip folds build and progress together, and the check into the payoff.
const EDGES = {
  5: [['hook', 0, 1.2], ['build', 1.2, 3], ['payoff', 3, 4.2], ['ending', 4.2, 5]],
  10: [['hook', 0, 1.5], ['build', 1.5, 3.5], ['progress', 3.5, 5], ['check', 5, 6.5], ['payoff', 6.5, 8], ['ending', 8, 10]],
  15: [['hook', 0, 2], ['build', 2, 5], ['progress', 5, 7.5], ['check', 7.5, 9.5], ['payoff', 9.5, 12.5], ['ending', 12.5, 15]]
}
export const realSeconds = (seconds) => round3(resolveFrames(seconds) / 24)
export const lengthOf = (s) => (AC_SECONDS.includes(Number(s)) ? Number(s) : 10)
// [{ key, from, to }] for a length, stretched to the length H3 really renders. The hook keeps its written end.
export function beatTimes(seconds) {
  const s = lengthOf(seconds)
  const real = realSeconds(s)
  const k = real / s
  return EDGES[s].map(([key, a, b], i) => ({ key, from: round1(i === 0 ? 0 : a * k), to: round1(i === EDGES[s].length - 1 ? real : b * k) }))
}

// ---------- the record ----------
export const AC_DEFAULTS = {
  name: '',
  animal: { name: '', species: 'cat', characterId: null, sheet: null, photo: null, describe: '', outfit: [], cm: null, state: 'dry' },
  idea: '',
  genre: 'gym',
  seconds: 10,
  filmer: { distance: 'close', side: '', facing: 'frame right', move: 'none', trigger: '', at: null },
  scene: { place: '', floor: '', light: '', time: '', anchor: '', extras: [], bystander: '', reactor: '', reactAt: null },
  action: { what: '', equipment: '', paws: '', object: '', load: 'none' },
  beats: {},
  sound: { hook: '', hookAt: 0.5, room: '', animal: '', animalAt: null, random: '', randomAt: null, more: [], breathing: true },
  phone: true
}
const pickOf = (v, list, d) => (Object.prototype.hasOwnProperty.call(list, v) ? v : d)
const numOr = (v, d = null) => (v === '' || v == null || !Number.isFinite(Number(v)) ? d : Number(v))

// A record with every field present and in range. Unknown fields are dropped from the parts below.
export function cleanCam(c = {}) {
  const a = { ...AC_DEFAULTS.animal, ...(c.animal || {}) }
  const f = { ...AC_DEFAULTS.filmer, ...(c.filmer || {}) }
  const sc = { ...AC_DEFAULTS.scene, ...(c.scene || {}) }
  const ac = { ...AC_DEFAULTS.action, ...(c.action || {}) }
  const so = { ...AC_DEFAULTS.sound, ...(c.sound || {}) }
  const seconds = lengthOf(c.seconds)
  const real = realSeconds(seconds)
  const at = (v) => {
    const n = numOr(v)
    return n == null ? null : round1(Math.min(real, Math.max(0, n)))
  }
  const beats = {}
  for (const key of Object.keys(BEATS)) if (c.beats?.[key] != null) beats[key] = str(c.beats[key], 900)
  return {
    ...c,
    name: str(c.name, 80),
    animal: {
      name: str(a.name, 40),
      species: pickOf(a.species, SPECIES, 'cat'),
      characterId: a.characterId || null,
      sheet: a.sheet || null,
      photo: a.photo || null,
      describe: str(a.describe, 300),
      outfit: (Array.isArray(a.outfit) ? a.outfit : String(a.outfit || '').split(/[,\n]/)).map((x) => str(x, 60)).filter(Boolean).slice(0, 6),
      cm: numOr(a.cm),
      state: pickOf(a.state, STATES, 'dry')
    },
    idea: str(c.idea, 400),
    genre: pickOf(c.genre, GENRES, 'gym'),
    seconds,
    filmer: { distance: pickOf(f.distance, DISTANCES, 'close'), side: str(f.side, 120), facing: str(f.facing, 60), move: pickOf(f.move, MOVES, 'none'), trigger: str(f.trigger, 200), at: at(f.at) },
    scene: {
      place: str(sc.place, 200),
      floor: str(sc.floor, 120),
      light: str(sc.light, 160),
      time: str(sc.time, 80),
      anchor: str(sc.anchor, 200),
      extras: (Array.isArray(sc.extras) ? sc.extras : []).slice(0, AC_EXTRAS).map((x) => ({ who: str(x?.who, 100), task: str(x?.task, 160), thing: str(x?.thing, 120) })),
      bystander: str(sc.bystander, 200),
      reactor: str(sc.reactor, 200),
      reactAt: at(sc.reactAt)
    },
    action: { what: str(ac.what, 600), equipment: str(ac.equipment, 200), paws: str(ac.paws, 300), object: str(ac.object, 300), load: pickOf(ac.load, LOADS, 'none') },
    beats,
    sound: {
      hook: str(so.hook, 160),
      hookAt: at(so.hookAt) ?? 0.5,
      room: str(so.room, 200),
      animal: str(so.animal, 160),
      animalAt: at(so.animalAt),
      random: str(so.random, 160),
      randomAt: at(so.randomAt),
      more: (Array.isArray(so.more) ? so.more : String(so.more || '').split(/[;\n]/)).map((x) => str(x, 160)).filter(Boolean).slice(0, 8),
      breathing: so.breathing !== false
    },
    phone: c.phone !== false
  }
}

// A new animal cam with the genre's defaults filled in where the person hasn't written anything yet.
export function withGenre(c, genre) {
  const g = GENRES[genre] || GENRES.gym
  const out = cleanCam({ ...c, genre })
  const fill = (v, d) => (v ? v : d)
  out.scene = { ...out.scene, place: fill(out.scene.place, g.place), floor: fill(out.scene.floor, g.floor), light: fill(out.scene.light, g.light), time: fill(out.scene.time, g.time) }
  out.sound = { ...out.sound, room: fill(out.sound.room, g.room) }
  if (!c?.filmer?.distance) out.filmer = { ...out.filmer, distance: g.distance }
  return out
}

// ---------- the prompt ----------
const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '')
const atWord = (t) => `${Number(t).toFixed(1)} s`
const firstName = (c) => str(c.animal.name, 40).split(/\s+/)[0] || SPECIES[c.animal.species].label
export const animalHandle = (c, taken = []) => {
  const h0 = handleOf(firstName(c), 'place') || 'Animal'
  const base = h0[0].toUpperCase() + h0.slice(1)
  const used = new Set(taken.map((h) => String(h).toLowerCase()))
  let h = base
  for (let k = 2; used.has(h.toLowerCase()); k++) h = `${base}${k}`
  return h
}
export function sizeLine(c) {
  const sp = SPECIES[c.animal.species]
  const cm = c.animal.cm ?? sp.cm
  const what = c.animal.species === 'other' ? 'real life size' : `real ${sp.label.toLowerCase()} size`
  return cm ? `${what}, about ${cm} cm at the ${sp.measure}` : what
}
const outfitWords = (c) => list(c.animal.outfit)
// "@Shadow’s straw hat, red suspenders and printed shorts stay exactly as in the reference picture"
const outfitSentence = (who, c) => {
  const items = c.animal.outfit.map((x) => x.replace(/^(?:a|an|the|his|her|its|their)\s+/i, ''))
  return items.length ? `${who}’s ${list(items)} ${items.length > 1 || /s$/i.test(items[0]) ? 'stay' : 'stays'} exactly as in the reference picture` : ''
}

// The H3 prompt (text mode; the animal written as `who`: @Handle when it comes in by its sheet, {char} for a LoRA
// character). cast.js turns a mentioned animal into a referenced subject with its sheet attached.
export function buildPrompt(raw, { who = '@Animal' } = {}) {
  const c = cleanCam(raw)
  const sp = SPECIES[c.animal.species]
  const g = GENRES[c.genre]
  const d = DISTANCES[c.filmer.distance]
  const real = realSeconds(c.seconds)
  const parts = []
  // the phone itself: format, take, speed, lens
  parts.push(`Live-action ordinary phone video, vertical, filmed by ${d.who} as one continuous handheld phone take at normal real-time speed from the first second to the last, through a phone’s wide-angle lens, with constant white balance and the mild compression of a clip uploaded to social media.`)
  // the place
  const where = [c.scene.place, c.scene.floor && `with ${c.scene.floor}`, c.scene.light && `lit by ${c.scene.light}`, c.scene.time].filter(Boolean)
  if (where.length) parts.push(sentence(cap(where.join(', '))))
  if (c.action.equipment) parts.push(sentence(`In the shot: ${c.action.equipment}`))
  // the animal, its size, state, outfit and facing
  const looks = [`${who} is a real ${c.animal.species === 'other' ? 'animal' : sp.label.toLowerCase()} at ${sizeLine(c)}`]
  if (c.animal.state !== 'dry') looks.push(STATES[c.animal.state])
  if (c.animal.outfit.length) looks.push(`wearing ${outfitWords(c)} exactly as in the reference picture`)
  if (c.filmer.facing) looks.push(`facing ${c.filmer.facing}`)
  parts.push(sentence(looks.join(', ')))
  if (c.scene.anchor) parts.push(sentence(`Size: ${c.scene.anchor}`))
  if (sp.feet) parts.push(sentence(`${who}’s ${sp.feet} touch everything the way real ${c.animal.species === 'other' ? 'animal' : sp.label.toLowerCase()} ${sp.feet} do: ${sp.contact.replace(/,\s*as (?:a )?real [^,]*$/, '')}`))
  // the people: extras with one task each, the one who doesn't care
  const extras = c.scene.extras.filter((x) => x.who && x.task)
  if (extras.length) parts.push(sentence(`In the background: ${extras.map((x) => `${x.who} ${x.task}${x.thing ? ` on ${x.thing}` : ''}`).join('; ')}, each doing only that the whole time`))
  if (c.scene.bystander) parts.push(sentence(cap(c.scene.bystander)))
  // the filmer
  parts.push(sentence(`The phone is held ${d.where}${c.filmer.side ? `, ${c.filmer.side}` : ''}, with natural handheld drift from breathing and small weight shifts and slightly off-centre framing; the picture shows only the scene itself`))
  // the beats, timed
  const times = beatTimes(c.seconds)
  for (const b of times) {
    const said = [str(c.beats[b.key], 900)]
    if (b.key === 'check' || (b.key === 'payoff' && !times.some((x) => x.key === 'check'))) {
      const keep = [outfitSentence(who, c), c.scene.anchor && `the size is unchanged: ${low(c.scene.anchor.replace(/[.\s]+$/, ''))}`, c.filmer.facing && `${who} still faces ${c.filmer.facing}`].filter(Boolean)
      if (keep.length) said.push(cap(`${keep.join('; ')}`))
    }
    if (b.key === 'payoff' && c.sound.animal) said.push(`${cap(c.sound.animal)} peaks at ${atWord(c.sound.animalAt ?? round1((b.from + b.to) / 2))}: ${who}’s mouth opens at its widest natural opening as the sound peaks and closes only after the sound ends`)
    if (b.key === 'ending' && c.scene.reactor) said.push(`At ${atWord(c.scene.reactAt ?? round1(b.from + 0.6))}, ${low(c.scene.reactor)}`)
    const text = said.filter(Boolean).map(sentence).join(' ')
    if (text) parts.push(`From ${b.from.toFixed(1)} to ${b.to.toFixed(1)} seconds: ${text}`)
  }
  // one special camera move, with its reason
  const m = MOVES[c.filmer.move]
  if (c.filmer.move !== 'none' && m) parts.push(sentence(`At ${atWord(c.filmer.at ?? round1(real / 2))}, ${c.filmer.trigger || m.trigger}; ${m.reaction}`))
  parts.push('It is one continuous take with no cuts.')
  const body = `[Shot 1] ${parts.join(' ')}`
  // the sound: only what's listed
  const sounds = []
  if (c.sound.room) sounds.push(c.sound.room)
  if (c.sound.hook) sounds.push(`${c.sound.hook} at ${atWord(c.sound.hookAt ?? 0.5)}`)
  sounds.push(...c.sound.more)
  if (c.sound.animal) sounds.push(`${c.sound.animal} at ${atWord(c.sound.animalAt ?? beatTimes(c.seconds).find((b) => b.key === 'payoff').from + 0.5)}`)
  if (c.sound.random) sounds.push(`${c.sound.random}${c.sound.randomAt != null ? ` at ${atWord(c.sound.randomAt)}` : ''}, which everyone ignores`)
  if (c.sound.breathing) sounds.push('the filmer’s quiet breathing and slight handling noise on the phone')
  const speaks = /<d>/.test(body)
  const soundscape = `Only these sounds are heard, at their real speed and pitch: ${sounds.join('; ') || 'the quiet room tone of the place'}.${speaks ? '' : ' No one speaks.'} ${g.label === 'Horror' ? 'Long stretches stay quiet until the planned loud sound.' : ''}`.trim()
  return [`integrated_multimodal_description: ${body}`, `overall_soundscape: ${soundscape}`, `non_diegetic_music: N/A`].join('\n\n')
}

// ---------- the checklist ----------
const GRIP = /\b(grips?|gripping|gripped|grabs?|grabbing|grasps?|grasping|fingers?|thumbs?|hands? (?:wrap|close)|holds? (?:it|the \w+) in (?:its|his|her) hands?)\b/i
const SLOW = /\b(slow[- ]?mo(?:tion)?|in slow|speed ramp|time slows|freeze[- ]frame)\b/i
const VAPOUR = /\b(steam|steaming|vapou?r|mist|misty|smoke|smoky|fog|foggy|breath clouds?|particles|sparkles?|sparkling|dust motes|glitter)\b/i
const EFFORT = /\b(shak(?:e|es|ing)|trembl\w*|strain\w*|whiskers? (?:press|pressed|flat)|squeez\w*|wider stance|lower stance|pant\w*|heav(?:es|ing)|quiver\w*|wobbl\w*)\b/i
const WET = /\b(rain|raining|rainy|puddles?|pool|swimming|bath|shower|river|lake|sea|beach|hose)\b/i
const MUD = /\b(mud|muddy|bog)\b/i
const SNOW = /\b(snow|snowy|snowing|blizzard)\b/i

// Every item: { key, label, step (an AC_STEPS index), ok, why (what to change when it isn't) }.
export function checklist(raw, { prompt = null, lintCtx = null, character = null } = {}) {
  const c = cleanCam(raw)
  const times = beatTimes(c.seconds)
  const real = realSeconds(c.seconds)
  const beatText = times.map((b) => c.beats[b.key] || '').join(' ')
  const animalText = [c.action.what, c.action.paws, c.action.object, beatText].join(' ')
  const all = [animalText, c.scene.place, c.scene.floor, c.scene.light, c.scene.bystander, ...c.scene.extras.map((x) => `${x.who} ${x.task} ${x.thing}`), c.sound.hook, c.sound.room, ...c.sound.more, c.sound.random].join(' ')
  const items = []
  const add = (key, label, step, ok, why) => items.push({ key, label, step, ok: !!ok, why: ok ? '' : why })
  const hasLook = !!(c.animal.sheet || character)
  add('sheet', 'The animal has a reference picture', 0, hasLook, 'Make or pick a reference sheet in step 1, or pick a character, so its face, markings and outfit stay the same.')
  add('size', 'Its size is anchored to something in the shot', 3, (c.animal.cm || SPECIES[c.animal.species].cm) && c.scene.anchor, 'Write a size anchor in step 4, like “his shoulder reaches mid-shin on the man beside him”.')
  const extrasOk = c.scene.extras.every((x) => !x.who || (x.task && x.thing && !/\band\b|,/.test(x.task)))
  add('tasks', 'Every person in frame has one task on one named thing', 3, extrasOk, 'In step 4, give each extra one task (no “and”) and the thing they use.')
  add('sides', 'Left and right are set: where the filmer stands, which way it faces', 2, c.filmer.side && c.filmer.facing, 'In step 3, say where the filmer stands and which way the animal faces (frame left or frame right).')
  add('outfit', 'Its outfit is named again in the check beat', 4, true, '')
  const scenery = [c.scene.place, c.scene.light, c.idea, c.action.what].join(' ')
  const needsWet = WET.test(scenery) && c.animal.state === 'dry'
  const needsMud = MUD.test(scenery) && c.animal.state !== 'muddy'
  const needsSnow = SNOW.test(scenery) && !['snowy', 'soaked'].includes(c.animal.state)
  add('state', 'Its state matches the scene (wet, muddy, snowy)', 0, !needsWet && !needsMud && !needsSnow, `The scene has ${needsWet ? 'water or rain' : needsMud ? 'mud' : 'snow'} but the animal is ${STATES[c.animal.state]}: change its state in step 1.`)
  // only sentences about the animal: "the girl's thumb scrolls" is fine, "Pepper grips the bar" isn't
  const esc = (x) => String(x).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const aboutAnimal = new RegExp(`\\b(${[esc(firstName(c)), esc(SPECIES[c.animal.species].label), 'paws?', 'forepaws?', 'hind', 'pads?', 'claws?', 'hooves', 'trotters', 'talons'].join('|')})\\b`, 'i')
  const person = /\b(man|men|woman|women|girl|boy|person|people|guy|lady|kid|child|owner|someone|teenager|filmer|gym-goer)\b/i
  const grip = animalText
    .split(/(?<=[.!?;])\s+/)
    .filter((x) => aboutAnimal.test(x) && !person.test(x))
    .join(' ')
    .match(GRIP)
  add('paws', `${cap(SPECIES[c.animal.species].feet)} press and push; nothing grips like a hand`, 4, !grip, `“${grip?.[0]}” makes H3 grow fingers. Write how the ${SPECIES[c.animal.species].feet} press or push instead (step 5).`)
  const strained = ['build', 'progress', 'payoff'].filter((k) => EFFORT.test(c.beats[k] || '')).length
  add('effort', 'The effort matches the load in every push', 4, c.action.load !== 'heavy' || strained >= Math.min(2, times.filter((b) => ['build', 'progress', 'payoff'].includes(b.key)).length), 'The load is heavy: show the strain in the build, progress and payoff beats (shaking legs, whiskers pressed back, a lower stance).')
  add('hook', 'A sharp real sound in the first 1.5 seconds', 5, c.sound.hook && (c.sound.hookAt ?? 0.5) <= 1.5, 'Add the hook sound in step 6 and put it before 1.5 s.')
  const vocalOk = !c.sound.animal || (c.sound.animalAt != null && c.sound.animalAt <= real)
  add('vocal', 'Its sound has a pitch and a time, so the mouth can follow it', 5, vocalOk && (!c.sound.animal || c.sound.animal.split(/\s+/).length >= 3), 'In step 6, name the sound’s kind and pitch (“a short low strained meow”) and the second it peaks.')
  const slow = all.match(SLOW)
  add('speed', 'Real-time speed throughout', 4, !slow, `“${slow?.[0]}” asks for slow motion; phone footage runs at real speed. Take it out of step 5.`)
  add('camera', 'The camera moves only for a reason', 2, c.filmer.move === 'none' || c.filmer.trigger || MOVES[c.filmer.move]?.trigger, 'Give the special move its trigger in the scene (step 3), or pick no special move.')
  add('bystander', 'Someone in frame doesn’t care', 3, c.scene.bystander, 'In step 4, add the person who doesn’t care: on their phone, walking past, eyes on something else.')
  const missing = times.filter((b) => b.key !== 'check' && !str(c.beats[b.key]))
  add('beats', 'Every beat says what happens', 4, !missing.length, `Write the ${list(missing.map((b) => BEATS[b.key].label.toLowerCase()))} beat${missing.length > 1 ? 's' : ''} in step 5, or press Draft the beats.`)
  const vapour = all.match(VAPOUR)
  add('vapour', 'No steam, smoke or floating particles', 4, !vapour, `“${vapour?.[0]}” tends to look generated. Leave it out.`)
  if (prompt) {
    const neg = negativePhrases(prompt)
    add('positive', 'Everything is written as what to show (H3 has no negative prompt)', 4, !neg.length, `H3 shows every noun, so “${neg[0]?.phrase}” can bring it in. Write what is there instead${neg[0]?.instead ? ` (${neg[0].instead})` : ''}.`)
    if (lintCtx) {
      const errors = lintPrompt(prompt, lintCtx).filter((x) => x.level === 'error')
      add('checker', 'IV Studio’s prompt checker finds nothing blocking', 6, !errors.length, errors[0]?.message || '')
    }
  }
  return items
}

// After watching a take: what broke, and the one field that controls it (the guide's "change only that line").
export const FIXES = [
  { key: 'identity', label: 'It doesn’t look like my animal', step: 0, tip: 'Use a clearer reference sheet: the face close-up, the front with the outfit and the back, studio lit.' },
  { key: 'size', label: 'It grew or shrank', step: 3, tip: 'Make the size anchor more concrete: something next to it in every beat, like the foot plate or a person’s shin.' },
  { key: 'outfit', label: 'The outfit changed or vanished', step: 0, tip: 'Put every item it wears on the sheet and in the outfit list; IV Studio repeats them in the check beat.' },
  { key: 'fingers', label: 'It has fingers or holds things like a hand', step: 4, tip: 'Rewrite the contact as pads pressing, hooking or pushing; heavy things take both paws.' },
  { key: 'slow', label: 'It went into slow motion', step: 4, tip: 'Take out anything slow or dramatic from the beats; the payoff happens at normal speed.' },
  { key: 'sound', label: 'Music or made-up sounds', step: 5, tip: 'Keep the sound list short and concrete; every sound you want is listed, and the room tone fills the rest.' },
  { key: 'mouth', label: 'Its mouth doesn’t match its sound', step: 5, tip: 'Give the sound a time inside the payoff beat and a clear pitch.' },
  { key: 'camera', label: 'The camera moved like a film camera', step: 2, tip: 'Use no special move, or give the one move a trigger in the scene.' },
  { key: 'extras', label: 'The people in the background do too much', step: 3, tip: 'One task each on one named thing, and fewer of them.' },
  { key: 'cut', label: 'It cut to another shot', step: 4, tip: 'Shorten the beats so each is one visible action; the prompt keeps it one continuous take.' }
]

// ---------- writer briefs (askWriter in filmcraft.js) ----------
export const BEATS_SCHEMA = {
  type: 'object',
  properties: { beats: { type: 'object', properties: Object.fromEntries(Object.keys(BEATS).map((k) => [k, { type: 'string' }])), required: ['hook', 'build', 'payoff', 'ending'] }, hook_sound: { type: 'string' }, animal_sound: { type: 'string' } },
  required: ['beats']
}
export function beatsBrief(raw) {
  const c = cleanCam(raw)
  const sp = SPECIES[c.animal.species]
  const g = GENRES[c.genre]
  const times = beatTimes(c.seconds)
  const system = `You write the timed action of a short animal video that must look like ordinary phone footage filmed by a stranger, for the video model MiniMax H3. Answer with JSON only.
Rules for every beat:
- Write it like a coach or a mechanic explains it, not like a viewer: where each paw or foot is, what it presses, what the object does back (the sled slides down its rails, the cushion dips, the cable goes taut).
- The animal's ${sp.feet} press, hook, pin or push; ${sp.contact}. Heavy things take both. Never write that it grips, grabs or holds things like a hand.
- Everything happens at normal real-time speed. Write nothing slow, dramatic or cinematic.
- If the load is heavy, show the strain in every push (shaking legs, ${c.animal.species === 'cat' ? 'whiskers pressed back, ' : ''}squeezed eyes, a lower wider stance), not only at the end.
- Write only what is seen and heard, as positive statements. Never write "no", "not", "without" or "never" about anything to leave out: name what is there instead.
- Keep extras to the one task each already given; add no new people, props, steam, smoke or particles.
- Refer to the animal as {animal}.
- Each beat is one to three plain sentences.`
  const user = [
    `The video (${c.seconds} seconds, genre ${g.label}: ${g.about})`,
    `Idea: ${c.idea || c.action.what || 'an animal doing something surprising'}`,
    `The animal: a ${sp.label.toLowerCase()}${c.animal.outfit.length ? ` wearing ${outfitWords(c)}` : ''}, ${sizeLine(c)}${c.animal.state !== 'dry' ? `, ${STATES[c.animal.state]}` : ''}.`,
    c.action.what && `What happens: ${c.action.what}`,
    c.action.equipment && `The equipment: ${c.action.equipment}`,
    c.action.paws && `Where its ${sp.feet} are: ${c.action.paws}`,
    c.action.object && `What the object does back: ${c.action.object}`,
    `How heavy it is for the animal: ${LOADS[c.action.load]}`,
    `The place: ${[c.scene.place, c.scene.floor, c.scene.light, c.scene.time].filter(Boolean).join(', ')}`,
    c.scene.anchor && `Size anchor: ${c.scene.anchor}`,
    c.scene.extras.filter((x) => x.who).length && `Extras (keep them to this): ${c.scene.extras.filter((x) => x.who).map((x) => `${x.who} ${x.task} on ${x.thing}`).join('; ')}`,
    c.scene.bystander && `The one who doesn't care: ${c.scene.bystander}`,
    `The ending should feel like this: ${g.ending}`,
    '',
    `Write these beats (times in seconds): ${times.map((b) => `${b.key} ${b.from}-${b.to}: ${BEATS[b.key].about}`).join(' | ')}${times.some((b) => b.key === 'check') ? '' : ' (this short clip has no separate progress or check beat)'}.`,
    'Also suggest "hook_sound": the sharp real sound in the first 1.5 seconds, and "animal_sound": the animal\'s one sound at the payoff with its kind and pitch (like "a short low strained meow").'
  ].filter(Boolean)
  return { system, user: user.join('\n') }
}
export const IDEAS_SCHEMA = { type: 'object', properties: { ideas: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 5 } }, required: ['ideas'] }
export function ideasBrief(raw) {
  const c = cleanCam(raw)
  const g = GENRES[c.genre]
  const sp = SPECIES[c.animal.species]
  return {
    system: 'You suggest ideas for short animal videos that look like real phone footage filmed by a stranger. Each idea is one plain sentence with one clear action and a contrast (a tiny animal and a huge task, a serious place and a silly act). Answer with JSON only.',
    user: `Genre: ${g.label}: ${g.about}\nThe animal: a ${sp.label.toLowerCase()}${c.animal.outfit.length ? ` wearing ${outfitWords(c)}` : ''}.\nLength: ${c.seconds} seconds, one continuous handheld take.\nSuggest four fresh ideas.`
  }
}
// The writer's beats -> the record's beats and suggested sounds (only where empty, unless overwrite).
export function applyBeats(raw, answer, { overwrite = false } = {}) {
  const c = cleanCam(raw)
  const keys = beatTimes(c.seconds).map((b) => b.key)
  const beats = { ...c.beats }
  for (const k of keys) {
    const text = str(answer?.beats?.[k], 900).replace(/\{animal\}/gi, firstName(c))
    if (text && (overwrite || !beats[k])) beats[k] = text
  }
  const sound = { ...c.sound }
  if (answer?.hook_sound && (overwrite || !sound.hook)) sound.hook = str(answer.hook_sound, 160)
  if (answer?.animal_sound && (overwrite || !sound.animal)) sound.animal = str(answer.animal_sound, 160)
  return cleanCam({ ...c, beats, sound })
}
// Beats name the animal by its first name; the prompt mentions it once as `who`, so its name becomes the mention.
export function withWho(prompt, c, who) {
  const name = firstName(c)
  if (!name || who === name) return prompt
  return prompt.replace(new RegExp(`(^|[^\\w@<{])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `$1${who}`)
}

// ---------- the reference sheet ----------
export function sheetPrompt(raw, { fromPhoto = false } = {}) {
  const c = cleanCam(raw)
  const sp = SPECIES[c.animal.species]
  const kind = c.animal.species === 'other' ? 'animal' : sp.label.toLowerCase()
  const what = fromPhoto ? `the ${kind} in the picture, keeping its exact face, fur colour, markings, eye colour and build` : `${c.animal.describe || `a ${kind}`}`
  const outfit = c.animal.outfit.length ? outfitWords(c) : null
  return [
    `A three-panel studio reference sheet of ${what}, the same animal in all three panels.`,
    `Left panel: a close-up of the face, sharp on the eyes, nose, whiskers and ear shape, with individual hairs visible.`,
    `Middle panel: the front of the body, cropped below the head${outfit ? `, showing ${outfit} and how each piece sits and folds` : ', standing naturally'}.`,
    `Right panel: the full body from behind${outfit ? `, showing how ${outfit} sit on the back` : ''}, with the tail visible.`,
    `A near-white seamless studio backdrop, one directional key light raking across the fur and soft rim lights separating the edges. A real photograph with natural fur texture.`
  ].join(' ')
}

// ---------- the phone finish ----------
// A 1080x1920 H.264 file like a clip off a phone: the frame filled and cropped to 9:16, a faint grain, a phone-like
// bit rate, AAC sound. It doesn't add frames: H3's 24 fps stay.
export const phoneArgs = (src, out) => ['-y', '-i', src, '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase:flags=bicubic,crop=1080:1920,noise=alls=3:allf=t,format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '12M', '-bufsize', '24M', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out]
function run(exe, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(exe, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d).slice(-4000)))
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed: ${err.split('\n').filter(Boolean).slice(-2).join(' ')}`))))
  })
}

// ---------- storage and rendering ----------
export class AnimalCams {
  // studio: Studio (or a function returning the current one); edits: Edits; images: Images (or a function); ask:
  // (request) => JSON from the Settings writer (askWriter)
  constructor({ dataDir, studio, edits, images = null, ask = null }) {
    this.dir = path.join(dataDir, 'animalcams')
    this.studioOf = typeof studio === 'function' ? studio : () => studio
    this.imagesOf = typeof images === 'function' ? images : () => images
    this.edits = edits
    this.ask = ask
  }
  get studio() {
    return this.studioOf()
  }
  get images() {
    return this.imagesOf()
  }
  file = (id) => path.join(this.dir, `${id}.json`)
  work = (id) => path.join(this.dir, id)

  list() {
    if (!fs.existsSync(this.dir)) return []
    return fs
      .readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(this.dir, f), null))
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((c) => ({ id: c.id, name: c.name, animal: c.animal?.name || '', species: c.animal?.species || 'cat', genre: c.genre, seconds: c.seconds, cover: c.animal?.sheet || c.animal?.photo || null, finished: !!c.take?.finish, updatedAt: c.updatedAt }))
  }
  get(id) {
    const c = readJson(this.file(id), null)
    if (!c) throw new Error(`No animal cam ${id}`)
    return c
  }
  write(c) {
    const out = cleanCam(c)
    out.updatedAt = now()
    writeJson(this.file(out.id), out)
    return out
  }
  create({ name = '', genre = 'gym', animal = {}, idea = '', seconds = 10 } = {}) {
    const c = withGenre({ ...AC_DEFAULTS, id: randomUUID().slice(0, 8), name: name.trim() || 'Animal cam', animal: { ...AC_DEFAULTS.animal, ...animal }, idea, seconds, take: null, jobLog: [], projectId: null, edits: [], sheetSets: [], createdAt: now() }, genre)
    return this.write(c)
  }
  // patch: any part ({ animal: {...}, filmer: {...}, beats: {...} ...}); parts are merged one level deep.
  save(id, patch = {}) {
    const c = this.get(id)
    for (const [k, v] of Object.entries(patch)) {
      if (['id', 'take', 'jobLog', 'projectId', 'edits', 'createdAt', 'updatedAt', 'sheetSets', 'phoneFile'].includes(k)) continue
      if (k === 'genre') Object.assign(c, withGenre(c, v))
      else if (v && typeof v === 'object' && !Array.isArray(v) && c[k] && typeof c[k] === 'object') c[k] = { ...c[k], ...v }
      else c[k] = v
    }
    return this.write(c)
  }
  delete(id) {
    const c = readJson(this.file(id), null)
    if (c?.projectId) {
      try {
        this.studio.deleteProject(c.projectId)
      } catch {}
    }
    fs.rmSync(this.file(id), { force: true })
    fs.rmSync(this.work(id), { recursive: true, force: true })
    return true
  }

  // A picture copied into the animal cam's folder (the pet photo, or the sheet picked from a set).
  keep(id, file, kind) {
    if (!file || !fs.existsSync(file)) throw new Error('That picture isn’t there.')
    if (!PICTURE.test(file)) throw new Error('Pick a picture: PNG, JPEG, WebP or BMP.')
    const dir = path.join(this.work(id), 'pictures')
    fs.mkdirSync(dir, { recursive: true })
    const copy = path.join(dir, `${kind}-${Date.now().toString(36)}${path.extname(file).toLowerCase()}`)
    fs.copyFileSync(file, copy)
    return copy
  }
  setPhoto(id, file) {
    const c = this.get(id)
    c.animal.photo = file ? this.keep(id, file, 'photo') : null
    return this.write(c)
  }
  setSheet(id, file) {
    const c = this.get(id)
    c.animal.sheet = file ? this.keep(id, file, 'sheet') : null
    return this.write(c)
  }

  // Makes reference sheets with a picture model: an edit of the pet photo, or from the words. model: an image
  // checkpoint (or ChatGPT Images). Returns the picture set; its pictures show up in view().sheetSets.
  async makeSheet(id, { model, count = 2 } = {}) {
    if (!this.images) throw new Error('Pictures aren’t available here.')
    const c = this.get(id)
    const fromPhoto = !!c.animal.photo
    if (!fromPhoto && !c.animal.describe) throw new Error('Add a photo of your animal, or describe it, first.')
    const rec = await this.images.create({ mode: fromPhoto ? 'edit' : 'generate', model, prompt: sheetPrompt(c, { fromPhoto }), refs: fromPhoto ? [c.animal.photo] : [], aspect: '16:9', megapixels: 2, count: Math.max(1, Math.min(4, Number(count) || 2)), name: `${firstName(c)} reference sheet`, tag: 'animalcam', keepAspect: true })
    const fresh = this.get(id)
    fresh.sheetSets = [...(fresh.sheetSets || []), rec.id].slice(-6)
    this.write(fresh)
    return rec
  }

  // The animal as the render needs it: { character, who, members, note }. A character with an H3 LoRA or RefMod is
  // the shot's character ({char}); otherwise the sheet (or the character's picture) comes in as a referenced animal.
  animalFor(c) {
    const chars = this.studio.characters()
    const ch = c.animal.characterId ? chars.find((x) => x.id === c.animal.characterId) : null
    if (ch && (ch.lora || ch.refmod)) return { character: ch.id, who: '{char}', members: [], name: ch.name }
    const picture = c.animal.sheet || ch?.picture || null
    if (!picture || !fs.existsSync(picture)) throw new Error('Your animal needs a reference sheet (step 1) or a character with a picture or an H3 LoRA.')
    const taken = this.studio.cast?.members?.().map((m) => m.handle) || []
    const handle = animalHandle({ ...c, animal: { ...c.animal, name: c.animal.name || ch?.name || '' } }, taken)
    const sp = SPECIES[c.animal.species]
    const description = [c.animal.species === 'other' ? '' : `a ${sp.label.toLowerCase()}`, c.animal.outfit.length ? `wearing ${outfitWords(c)}` : ''].filter(Boolean).join(' ')
    return { character: 'none', who: `@${handle}`, members: [{ handle, kind: 'animal', id: `ac:${c.id}`, name: c.animal.name || ch?.name || handle, picture, description }], name: c.animal.name || handle }
  }
  promptFor(c) {
    const a = this.animalFor(c)
    return { ...a, prompt: withWho(buildPrompt(c, { who: a.who }), c, a.who) }
  }
  check(id) {
    const c = this.get(id)
    let built = null
    try {
      built = this.promptFor(c)
    } catch {}
    const ch = c.animal.characterId ? this.studio.characters().find((x) => x.id === c.animal.characterId) : null
    const items = checklist(c, { prompt: built?.prompt || null, lintCtx: { mode: 'text', seconds: c.seconds, media: [] }, character: ch && (ch.lora || ch.refmod || ch.picture) ? ch : null })
    return { items, misses: items.filter((x) => !x.ok).length, prompt: built?.prompt || null }
  }

  project(c) {
    if (!c.projectId) c.projectId = this.studio.createProject(`${c.name} (animal cam)`, null, null, 'animalcam').id
    return c.projectId
  }
  takeKey = (c, prompt) => JSON.stringify([prompt, c.animal.sheet, c.animal.characterId, c.seconds])

  // Hunt takes. opts: { seed, speed, previews, anyway } (anyway: render with checklist misses).
  async hunt(id, opts = {}) {
    const c = this.get(id)
    const { items } = this.check(id)
    const misses = items.filter((x) => !x.ok)
    if (misses.length && !opts.anyway) throw new Error(`The checklist has ${misses.length} miss${misses.length > 1 ? 'es' : ''}: ${misses[0].label}. ${misses[0].why}`)
    const built = this.promptFor(c)
    const projectId = this.project(c)
    const j = await this.studio.generatePreviews({ projectId, prompt: built.prompt, character: built.character, ...(built.members.length ? { members: built.members } : {}), aspect: '9:16', seconds: c.seconds, mode: 'text', ...(opts.seed != null ? { seed: opts.seed } : {}), ...(opts.speed ? { speed: opts.speed } : {}), ...(opts.previews ? { previews: opts.previews } : {}) })
    c.take = { previews: j.id, finish: null, key: this.takeKey(c, built.prompt) }
    c.jobLog = [...(c.jobLog || []), j.id]
    c.phoneFile = null
    this.write(c)
    return j
  }
  async finish(id, { candidate = 1, speed } = {}) {
    const c = this.get(id)
    if (!c.take?.previews) throw new Error('Hunt takes first.')
    const j = await this.studio.finishCandidate({ jobId: c.take.previews, candidate: Number(candidate), ...(speed ? { speed } : {}) })
    c.take.finish = j.id
    c.jobLog = [...(c.jobLog || []), j.id]
    c.phoneFile = null
    this.write(c)
    return j
  }

  view(id) {
    const c = this.get(id)
    const job = (jid) => {
      if (!jid) return null
      try {
        return this.studio.publicJob(this.studio.getJob(jid, { refresh: false }))
      } catch {
        return null
      }
    }
    const done = (j) => ['success', 'error', 'cancelled'].includes(j?.status)
    const previews = job(c.take?.previews)
    const finish = job(c.take?.finish)
    const clip = finish?.status === 'success' ? finish.outputs?.find((o) => o.kind === 'final') || null : null
    let keyNow = null
    try {
      keyNow = this.takeKey(c, this.promptFor(c).prompt)
    } catch {}
    const state = { previews, finish, clip, fresh: !!(clip && c.take?.key === keyNow), changed: !!c.take?.key && c.take.key !== keyNow, busy: !!((previews && !done(previews)) || (finish && !done(finish))) }
    const sheets = []
    for (const sid of c.sheetSets || []) {
      const rec = this.images?.all?.().find((x) => x.id === sid)
      if (rec) sheets.push({ id: rec.id, status: rec.status, files: rec.files || [], error: rec.error || null, family: rec.familyLabel, progress: rec.progress || null })
    }
    return { ...c, beatTimes: beatTimes(c.seconds), real: realSeconds(c.seconds), state, sheets, check: this.check(id), phoneFile: c.phoneFile && fs.existsSync(c.phoneFile) ? c.phoneFile : null }
  }
  async refresh(id) {
    const c = this.get(id)
    for (const jid of c.jobLog || []) {
      try {
        const j = this.studio.getJob(jid, { refresh: false })
        if (!['success', 'error', 'cancelled'].includes(j.status)) await this.studio.refreshJob(jid)
      } catch {}
    }
    for (const sid of c.sheetSets || []) {
      try {
        await this.images?.get?.(sid)
      } catch {}
    }
    return this.view(id)
  }

  // The finished take as a phone-style file (animalcams/<id>/phone-*.mp4).
  async phoneFinish(id) {
    const v = await this.refresh(id)
    if (!v.state.fresh) throw new Error('Finish a take first.')
    fs.mkdirSync(this.work(id), { recursive: true })
    const out = path.join(this.work(id), `phone-${Date.now().toString(36)}.mp4`)
    await run(FFMPEG, phoneArgs(v.state.clip.path, out))
    const c = this.get(id)
    if (c.phoneFile && fs.existsSync(c.phoneFile) && c.phoneFile.startsWith(this.work(id))) fs.rmSync(c.phoneFile, { force: true })
    c.phoneFile = out
    this.write(c)
    return { file: out }
  }

  // A new vertical edit with the finished take (the phone finish when it's on) and its own sound.
  async assemble(id, { name = null } = {}) {
    const v = await this.refresh(id)
    if (!v.state.fresh) throw new Error('Finish a take first.')
    let file = v.state.clip.path
    if (v.phone) file = v.phoneFile || (await this.phoneFinish(id)).file
    const e = this.edits.create(name || `${v.name} (animal cam)`)
    e.settings = { ...e.settings, format: 'vertical', loudness: 'web' }
    const md = await this.edits.addMedia(file, { type: 'animalcam', from: v.id })
    const r = applyOps({ ...e, media: { [md.id]: md } }, [{ op: 'add_clip', media: md.id, track: 'V1', start: 0, in: 0, out: md.duration }])
    Object.assign(e, { clips: r.clips, media: r.media, tracks: r.tracks, markers: r.markers })
    this.edits.write(e)
    const c = this.get(id)
    c.edits = [...(c.edits || []), { id: e.id, createdAt: now() }]
    this.write(c)
    return { editId: e.id, seconds: round3(md.duration || 0), file }
  }

  // The writer drafts the beats (and suggests the hook and animal sounds) from steps 1 to 5.
  async draftBeats(id, { overwrite = false } = {}) {
    if (!this.ask) throw new Error('No prompt writer is set up. Pick one in Settings → Prompt writer.')
    const c = this.get(id)
    const { system, user } = beatsBrief(c)
    const answer = await this.ask({ system, user, schema: BEATS_SCHEMA })
    return this.write(applyBeats(c, answer, { overwrite }))
  }
  async ideas(id) {
    if (!this.ask) throw new Error('No prompt writer is set up. Pick one in Settings → Prompt writer.')
    const { system, user } = ideasBrief(this.get(id))
    const answer = await this.ask({ system, user, schema: IDEAS_SCHEMA })
    return (answer?.ideas || []).map((x) => str(x, 300)).filter(Boolean).slice(0, 5)
  }

  // Saves the animal as an ordinary character (its sheet as a full-body picture), so other tools can use it too.
  saveAsCharacter(id) {
    const c = this.get(id)
    if (!c.animal.sheet) throw new Error('Make or pick a reference sheet first.')
    const sp = SPECIES[c.animal.species]
    const ch = this.studio.saveCharacter({ name: c.animal.name || `${sp.label} ${c.id}`, about: `a ${c.animal.species === 'other' ? 'animal' : sp.label.toLowerCase()}, ${sizeLine(c)}`, look: c.animal.outfit.length ? `wears ${outfitWords(c)}` : '' })
    const saved = this.studio.addCharacterPictures(ch.id, [c.animal.sheet], 'full body')
    c.animal.characterId = saved.id
    this.write(c)
    return saved
  }
}
