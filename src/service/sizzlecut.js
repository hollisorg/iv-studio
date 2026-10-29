// A sizzle's first cut, as a Shinobi timeline: the approved storyboard laid out on the music's beat, with the
// site's own screens, its colours, two-tone kinetic titles and an end card on the logo and the web address.
// It is a starting point an agent (or the person) can refine in Shinobi; firstCut() is pure, so it is tested
// without Shinobi. Titles use IV Studio's bundled Barlow Condensed, measured here from the font file itself
// so every line fits the frame.
import fs from 'node:fs'

// ---------- measuring text (advance widths from the TTF's cmap and hmtx tables; no kerning) ----------
export function fontMetrics(file) {
  const b = fs.readFileSync(file)
  const tables = {}
  for (let k = 0, n = b.readUInt16BE(4); k < n; k++) {
    const at = 12 + k * 16
    tables[b.toString('latin1', at, at + 4)] = b.readUInt32BE(at + 8)
  }
  const unitsPerEm = b.readUInt16BE(tables.head + 18)
  const metrics = b.readUInt16BE(tables.hhea + 34)
  const advance = (glyph) => b.readUInt16BE(tables.hmtx + 4 * Math.min(glyph, metrics - 1))
  // cmap: the Windows Unicode (3,1) format 4 subtable
  const cmap = tables.cmap
  let sub = null
  for (let k = 0, n = b.readUInt16BE(cmap + 2); k < n; k++) {
    const at = cmap + 4 + k * 8
    if (b.readUInt16BE(at) === 3 && b.readUInt16BE(at + 2) === 1) sub = cmap + b.readUInt32BE(at + 4)
  }
  if (sub === null || b.readUInt16BE(sub) !== 4) throw new Error('The title font has no Unicode map.')
  const segs = b.readUInt16BE(sub + 6) / 2
  const ends = sub + 14
  const starts = ends + segs * 2 + 2
  const deltas = starts + segs * 2
  const offsets = deltas + segs * 2
  const glyphOf = (code) => {
    for (let k = 0; k < segs; k++) {
      if (code > b.readUInt16BE(ends + k * 2)) continue
      const start = b.readUInt16BE(starts + k * 2)
      if (code < start) return 0
      const delta = b.readInt16BE(deltas + k * 2)
      const ro = b.readUInt16BE(offsets + k * 2)
      if (!ro) return (code + delta) & 0xffff
      const g = b.readUInt16BE(offsets + k * 2 + ro + (code - start) * 2)
      return g ? (g + delta) & 0xffff : 0
    }
    return 0
  }
  const cache = new Map()
  // the width of a line at 1 px font size
  return (text) => [...String(text)].reduce((w, ch) => {
    if (!cache.has(ch)) cache.set(ch, advance(glyphOf(ch.codePointAt(0))) / unitsPerEm)
    return w + cache.get(ch)
  }, 0)
}

// ---------- the site's palette ----------
const hexRgb = (h) => {
  const m = String(h).trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const s = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((k) => parseInt(s.slice(k, k + 2), 16))
}
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`
const luma = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const chroma = (c) => (Math.max(...c) - Math.min(...c)) / 255
const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t)

// bg: the darkest of the site's near-neutral colours; ink: the neutral furthest from it (or near-black or
// off-white when none is far enough); accent: the most colourful of the rest. "soft" is the accent eased
// toward the ink, so a second title line reads on the background.
export function palette(colors = []) {
  const cs = colors.map(hexRgb).filter(Boolean)
  const neutral = cs.filter((c) => chroma(c) <= 0.25)
  const byLuma = [...(neutral.length ? neutral : cs)].sort((a, b) => luma(a) - luma(b))
  let bg = byLuma[0] || [16, 14, 16]
  let ink = [...byLuma].sort((a, b) => Math.abs(luma(b) - luma(bg)) - Math.abs(luma(a) - luma(bg)))[0] || [242, 238, 230]
  if (Math.abs(luma(ink) - luma(bg)) < 0.45) ink = luma(bg) > 0.55 ? [17, 17, 17] : [245, 243, 238]
  const rest = cs.filter((c) => c !== bg && c !== ink && chroma(c) > 0.25).sort((a, b) => chroma(b) - chroma(a))
  const accent = rest[0] || ink
  const dark = luma(bg) < 0.5
  return { bg: rgbHex(bg), ink: rgbHex(ink), accent: rgbHex(accent), soft: rgbHex(rest[0] ? mix(accent, dark ? [255, 255, 255] : [0, 0, 0], dark ? 0.45 : 0.2) : ink), dark }
}

// ---------- titles ----------
// Two sentences become two lines; a long line splits at the space nearest its middle.
export function titleLines(text) {
  const t = String(text).replace(/\s+/g, ' ').trim()
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean)
  if (sentences.length >= 2 && sentences.length <= 3) return sentences
  if (t.length <= 16 || !t.includes(' ')) return [t]
  const words = t.split(' ')
  let best = 1
  for (let k = 1; k < words.length; k++) {
    const left = words.slice(0, k).join(' ').length
    if (Math.abs(left - t.length / 2) < Math.abs(words.slice(0, best).join(' ').length - t.length / 2)) best = k
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

// The main button's words: the first call to action that isn't page furniture, without its arrow.
export function mainCta(ctas = []) {
  const furniture = /skip|pause|play|menu|close|cookie|accept|reject|search|sign ?in|log ?in|toggle|open nav|back to top/i
  const c = ctas.map((x) => String(x).replace(/[\s↗→›»↓↘➜➔]+$/u, '').replace(/^[\s↗→›»]+/u, '').trim()).find((x) => x && x.length <= 34 && !furniture.test(x))
  return c || null
}

// ---------- the cut ----------
// scenes: the plan's scenes; media: scene id -> {clip, kind} for h3, image and screen scenes; logo: {clip} or null;
// music: {assetId, duration, end} where end is where it falls silent (or null); voiceover: [{assetId, duration}];
// beats: seconds; site: {name, host, ctas}; font: {family, url, measure}.
export function firstCut({ scenes, format, colors, media, logo, music, voiceover = [], beats = [], site, font, fps = 30 }) {
  const W = format.width
  const H = format.height
  const pal = palette(colors)
  const f = (sec) => Math.round(sec * fps)

  // End on the music: when it falls silent before the storyboard ends, the time comes out of the longer
  // scenes before the end card (H3 shots down to 3 s, the rest to 1.2 s), so the logo still lands on its last hit.
  const lengths = scenes.map((sc) => sc.seconds)
  const end = music?.end ? music.end + 0.2 : null
  let over = end ? lengths.reduce((a, b) => a + b, 0) - end : 0
  if (over > 0.05) {
    const floor = (k) => (scenes[k].kind === 'h3' ? 3 : 1.2)
    const give = lengths.map((len, k) => (k === lengths.length - 1 ? 0 : Math.max(0, len - floor(k))))
    const room = give.reduce((a, b) => a + b, 0)
    if (room > 0) lengths.forEach((_, k) => (lengths[k] -= give[k] * Math.min(1, over / room)))
  }
  // storyboard -> times, each cut snapped to the nearest beat when one is close
  const bounds = [0]
  let t = 0
  lengths.forEach((len, k) => {
    t += len
    const near = beats.length ? beats.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), beats[0]) : t
    bounds.push(k < lengths.length - 1 && Math.abs(near - t) < 0.35 && near - bounds.at(-1) > 0.8 ? near : t)
  })
  if (end && end < bounds.at(-1)) bounds[bounds.length - 1] = Math.max(end, bounds.at(-2) + 2.8)
  const total = bounds.at(-1)
  const frames = f(total)

  const clips = {}
  const clipOf = (key, a) => {
    if (!a?.clip) throw new Error(`The ${key} scene has no piece in the Shinobi project.`)
    clips[key] = a.clip
    return key
  }
  const text = []
  const T = (f0, f1, txt, pos, size, fill, extra = {}) => text.push({ type: 'font', f0, f1, family: font.family, text: txt, pos, size: Math.round(size), fill, stroke: null, shadow: false, weight: 600, style: 'normal', ...extra })
  // a size at which every line fits within `share` of the frame's width (and no taller than `cap`)
  const fit = (lines, cap, share = 0.86) => Math.min(cap, ...lines.map((l) => (share * W) / Math.max(0.01, font.measure(l))))
  const big = 0.16 * Math.min(H, W * 0.75)
  // a title in the site's manner: the first line in the ink, the others in the soft accent, slammed in on the beat
  const title = (f0, f1, words, { y = 0.5, cap = big } = {}) => {
    const lines = titleLines(words)
    const size = fit(lines, cap)
    const step = (size * 1.0) / H
    lines.forEach((l, k) => T(f0 + k * 3, f1, l, [0.5, y + (k - (lines.length - 1) / 2) * step], size, k === 0 ? pal.ink : pal.soft, { anim: 'slam', fade_out: 0.12 }))
  }
  // a short opening line ("WHAT IF?") as one big word, its last mark in the accent
  const hook = (f0, f1, words) => {
    const w = String(words).trim()
    const mark = /[?!.]$/.test(w) && w.length > 1 ? w.slice(-1) : ''
    const body = mark ? w.slice(0, -1) : w
    const size = fit([w], 0.28 * H, 0.8)
    const wb = (font.measure(body) * size) / W
    const wm = (font.measure(mark) * size) / W
    const left = 0.5 - (wb + wm) / 2
    T(f0, f1, body, [left + wb / 2, 0.5], size, pal.ink, { anim: 'slam' })
    if (mark) T(f0 + 4, f1, mark, [left + wb + wm / 2, 0.5], size, pal.accent, { anim: 'slam' })
  }
  // a picture or screen: cover when its shape is close to the frame's, otherwise whole over the background
  const camFor = (a, push) => {
    const c = a.clip
    const off = Math.abs(Math.log(c.w / c.h / (W / H)))
    return off < 0.25 ? { fit: 'cover', push: { v: push } } : { fit: 'contain', z: 0.94, push: { v: push } }
  }

  const shots = []
  let screens = 0
  const last = scenes.length - 1
  scenes.forEach((sc, k) => {
    const f0 = f(bounds[k])
    const f1 = k === last ? frames : f(bounds[k + 1])
    if (k === last) return endCard(sc, f0, f1, k)
    if (sc.kind === 'title') {
      shots.push({ f0, f1, special: { type: 'color', color: pal.bg } })
      if (k === 0 && String(sc.text).trim().split(/\s+/).length <= 3) hook(f0, f1, sc.text)
      else title(f0, f1, sc.text)
    } else if (sc.kind === 'screen') {
      shots.push({ f0, f1, clip: clipOf(sc.id, media[sc.id]), src: 0, speed: 0, bg: pal.bg, cam: camFor(media[sc.id], 0.015), transition: { type: screens++ % 2 ? 'push' : 'whip', dir: 'left' } })
    } else if (sc.kind === 'h3') {
      shots.push({ f0, f1, clip: clipOf(sc.id, media[sc.id]), src: 0.4, speed: 1, loop: 'clamp', cam: { fit: 'cover', push: { v: 0.03 } }, transition: { type: 'dissolve', d: 0.3 } })
    } else if (sc.kind === 'image') {
      shots.push({ f0, f1, clip: clipOf(sc.id, media[sc.id]), src: 0, speed: 0, bg: pal.bg, cam: camFor(media[sc.id], 0.05), transition: { type: 'dissolve', d: 0.4 } })
    }
  })

  // The last scene, then the logo card. A title closes over the scene before it (darkened) when that is a
  // shot or a picture; the logo holds for at least 1.6 s with the main button's words and the address.
  function endCard(sc, f0, f1, k) {
    const span = f1 - f0
    const logoFrames = Math.max(f(1.6), Math.min(span - f(1.2), Math.round(span * 0.5)))
    const mid = f1 - Math.min(logoFrames, span - f(0.8))
    const prev = scenes[k - 1]
    if (sc.kind === 'title') {
      const under = prev && (prev.kind === 'image' || prev.kind === 'h3') && media[prev.id] ? prev : null
      if (under) shots.push({ f0, f1: mid, clip: clipOf(under.id, media[under.id]), src: under.kind === 'h3' ? 2 : 0, speed: under.kind === 'h3' ? 0.5 : 0, loop: 'clamp', cam: { fit: 'cover', z: 1.1, push: { v: 0.05 } }, look: { type: 'studio', grade: { exposure: pal.dark ? -1.6 : 0.6, sat: 0.8 } } })
      else shots.push({ f0, f1: mid, special: { type: 'color', color: pal.bg } })
      title(f0, mid, sc.text, { cap: big * 0.9 })
    } else {
      const a = media[sc.id]
      shots.push({ f0, f1: mid, clip: clipOf(sc.id, a), src: sc.kind === 'h3' ? 0.4 : 0, speed: sc.kind === 'h3' ? 1 : 0, loop: 'clamp', bg: pal.bg, cam: sc.kind === 'h3' ? { fit: 'cover', push: { v: 0.03 } } : camFor(a, 0.03), transition: { type: 'dissolve', d: 0.3 } })
    }
    const cta = mainCta(site.ctas)
    let below = 0.62
    if (logo?.clip) {
      // the logo about a third of the frame wide, and never more than a quarter of its height
      const c = logo.clip
      const fitScale = Math.min(W / c.w, H / c.h)
      const z = Math.min((0.3 * W) / (c.w * fitScale), (0.24 * H) / (c.h * fitScale))
      const half = (c.h * fitScale * z) / H / 2
      shots.push({ f0: mid, f1, clip: clipOf('logo', logo), src: 0, speed: 0, bg: pal.bg, cam: { fit: 'contain', z: +z.toFixed(3) }, transition: { type: 'dip', color: pal.bg } })
      below = 0.5 + half + 0.07
    } else {
      shots.push({ f0: mid, f1, special: { type: 'color', color: pal.bg }, transition: { type: 'dip', color: pal.bg } })
      const name = String(site.name || site.host).toUpperCase()
      T(mid + 2, f1, name, [0.5, 0.45], fit([name], big, 0.8), pal.ink, { anim: 'slam' })
    }
    const lines = [cta && [cta.toUpperCase(), pal.ink, 4], [String(site.host).toUpperCase(), pal.soft, 6]].filter(Boolean)
    const small = Math.min(0.059 * H, ...lines.map(([l]) => (0.8 * W) / font.measure(l)))
    lines.forEach(([l, fill, track], j) => T(mid + 4 + j * 4, f1, l, [0.5, Math.min(0.9, below + j * 0.08)], j ? small * 0.8 : small, fill, { anim: 'fade', tracking: track }))
  }

  shots.forEach((x, k) => k === 0 && delete x.transition)

  function checkFrames() {
    const mids = scenes.slice(0, -1).map((_, k) => f((bounds[k] + bounds[k + 1]) / 2))
    const pick = mids.length <= 10 ? mids : Array.from({ length: 10 }, (_, j) => mids[Math.round((j * (mids.length - 1)) / 9)])
    const logoAt = shots.at(-1).f0
    return [...pick, Math.round((f(bounds.at(-2)) + logoAt) / 2), Math.round((logoAt + frames) / 2) + f(0.3)]
  }

  // music under everything (lower under a voice-over), the voice-over lines one after another from the
  // second scene, each starting on a cut where one is near
  const audio_tracks = []
  if (music) audio_tracks.push({ asset_id: music.assetId, start: 0, duration: Math.min(music.duration, total + 0.2), at: 0, fade_out: 1.2, ...(voiceover.length && { gain_db: -7 }) })
  let at = bounds[1] ?? 0
  for (const v of voiceover) {
    const cut = bounds.find((b) => b >= at - 0.01 && b - at < 0.6)
    at = cut ?? at
    if (at + 0.3 > total) break
    audio_tracks.push({ asset_id: v.assetId, start: 0, duration: Math.min(v.duration, total - at), at: +at.toFixed(3) })
    at += v.duration + 0.35
  }

  return {
    timeline: { canvas: { w: W, h: H, fps, frames, bg: pal.bg }, fonts: [{ family: font.family, url: font.url, weight: 600 }], clips, shots, text, audio_tracks },
    bounds,
    seconds: +(frames / fps).toFixed(2),
    palette: pal,
    // the middle of the scenes (at most 10, spread out), the closing title and the logo card, to look at
    checkFrames: checkFrames()
  }
}
