import { useEffect, useMemo, useState } from 'react'
import Hero from './Hero'
import { MediaEditor, MediaTile } from './MediaEditor'
import PromptWriter from './PromptWriter'
import { LoraPicker, LoraThumb, loraTitle, useYours } from './Loras'

const MODES = [
  ['text', 'Text', 'Just the prompt.'],
  ['reference', 'References', 'Pictures, videos or audio guide the shot. Name them <Picture 1>, <Video 1>, <Audio 1>.'],
  ['frames', 'First / last frame', 'The clip opens on picture 1 and, optionally, ends on picture 2.'],
  ['continue', 'Continue a video', 'Carries a clip on from its last frames. One preview, finished at its own size.']
]
const ASPECTS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const PREVIEW_MP = [0.3, 0.4, 0.6, 0.8]

const TEMPLATE = `integrated_multimodal_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture: no signs, no labels, no captions. A medium close-up of {char}, a woman wearing ___, ___. The camera is handheld, a gentle sway. {char} (S1) ___, then says: <d>[English] ___</d>

overall_soundscape: ___. Her voice is close and natural.

non_diegetic_music: N/A`

const REF_TEMPLATE = `subject_definitions: <Subject 1> is {char}, a woman. <Subject 2> is the ___ from <Picture 1>.

retention_analysis: <Picture 1>: reference - the location keeps ___; the camera position follows the description.

detailed_description: [Shot 1] Live-action, filmed on a smartphone. There is no writing anywhere in the picture: no signs, no labels, no captions. In the ___ from <Picture 1>. {char} is wearing ___. {char} (S1) ___ and says: <d>[English] ___</d>

overall_soundscape: ___. Her voice is close and natural.

non_diegetic_music: N/A`

const base = (p) => p.split(/[\\/]/).pop()
// The first <d>[Language] …</d> in a prompt takes the spoken words; a prompt without one is left alone.
const DIALOGUE = /<d>\[([^\]]+)\][^<]*<\/d>/
const withLine = (prompt, text) => {
  const m = DIALOGUE.exec(prompt)
  return m ? prompt.replace(m[0], `<d>[${m[1]}] ${text}</d>`) : prompt
}

export default function Create({ setup, characters, notify, openShot, go, incomingLine, clearIncomingLine, incomingLora, clearIncomingLora, incomingPicture, clearIncomingPicture, kindSwitch }) {
  const [form, setForm] = useState({
    projectName: '',
    mode: 'text',
    character: 'none',
    prompt: '',
    aspect: '16:9',
    megapixels: 0.4,
    seconds: 5,
    previews: 3,
    seed: 4242,
    steps: 8,
    media: [],
    overlapFrames: 22,
    voiceLine: null,
    refmods: [],
    retention: 1,
    extraLoras: []
  })
  const [advanced, setAdvanced] = useState(false)
  const [plan, setPlan] = useState(null)
  const [planError, setPlanError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  useEffect(() => {
    // a picked character that was deleted falls back to None (the default)
    if (form.character !== 'none' && !characters.some((c) => c.id === form.character)) set({ character: 'none' })
  }, [characters])

  const request = useMemo(() => {
    const { projectName, voiceItem, ...r } = form
    return { ...r, character: r.character ?? 'none', media: r.media.map((m) => ({ kind: m.kind, file: m.path })) }
  }, [form])

  useEffect(() => {
    let live = true
    const probe = { ...request, prompt: request.prompt || 'x' }
    window.ivstudio.render
      .plan(probe, { megapixels: 2 })
      .then((p) => live && (setPlan(p), setPlanError(null)))
      .catch((err) => live && (setPlan(null), setPlanError(err.message)))
    return () => {
      live = false
    }
  }, [request])

  async function addMedia(kind) {
    addFiles((await window.ivstudio.files.pick(kind)).map((path) => ({ kind, path })))
  }
  // Adds [{kind, path}] in one update (so several kinds dropped at once all land), each probed for the tile.
  async function addFiles(list) {
    if (!list.length) return
    const added = await Promise.all(list.map(async (m) => ({ ...m, info: await window.ivstudio.media.probe(m.path).catch(() => null) })))
    setForm((f) => {
      const limit = f.mode === 'frames' ? 2 : f.mode === 'continue' ? 1 : 12
      return { ...f, media: [...(f.mode === 'continue' ? [] : f.media), ...added].slice(0, limit) }
    })
  }

  // A line spoken in the character's voice (here, or from Audio > Lines) becomes the voice line, and its
  // words go into the prompt's dialogue so H3 says what it lip-syncs. A song from Audio > Music becomes the
  // voice line as it is.
  const [say, setSay] = useState('')
  const [speaking, setSpeaking] = useState(false)
  async function takeLine(line) {
    const info = await window.ivstudio.media.probe(line.file).catch(() => null)
    // a song (Music): it becomes what the character sings to; the prompt is the person's to write
    if (line.kind === 'music') {
      set({ voiceLine: line.file, voiceItem: { kind: 'audio', path: line.file, info } })
      notify(`"${line.name}" is the voice line now. Click its tile to trim it to the shot, and say in the prompt that they sing.`, 'info')
      return
    }
    const prompt = withLine(form.prompt.trim() ? form.prompt : form.mode === 'reference' ? REF_TEMPLATE : TEMPLATE, line.text)
    set({ voiceLine: line.file, voiceItem: { kind: 'audio', path: line.file, info }, prompt })
    if (!DIALOGUE.test(prompt)) notify('The line is the voice line now. Put the same words in the prompt, inside <d>[English] …</d>.', 'info')
  }
  async function speakLine() {
    setSpeaking(true)
    try {
      await takeLine(await window.ivstudio.voices.speak({ voiceId: char.voiceId, text: say }))
      setSay('')
    } catch (err) {
      notify(err.message)
    } finally {
      setSpeaking(false)
    }
  }
  useEffect(() => {
    if (!incomingLine) return
    takeLine(incomingLine)
    clearIncomingLine?.()
  }, [incomingLine])

  // The LoRA tray: each LoRA as its picture with a strength slider. A LoRA's trigger words go into the
  // prompt when it's added (the shot's first description), unless the person turned that off for it.
  const [picking, setPicking] = useState(false)
  const [yours, , reloadYours] = useYours()
  const loraInfo = (name) => yours?.find((x) => x.name === name)
  function addLora({ name, words = [], title }) {
    if (form.extraLoras.some((l) => l.name === name)) return notify(`${title || loraTitle(name)} is already in the shot.`, 'info')
    const info = loraInfo(name)
    const strength = info?.prefs?.strength ?? 1
    const auto = info?.prefs?.autoTrigger !== false
    const add = auto ? words.filter((w) => w && !form.prompt.includes(w)) : []
    const prompt = add.length ? (/\[Shot 1\] /.test(form.prompt) ? form.prompt.replace('[Shot 1] ', `[Shot 1] ${add.join(', ')}. `) : `${add.join(', ')}. ${form.prompt}`) : form.prompt
    set({ extraLoras: [...form.extraLoras, { name, strength }], prompt })
    if (add.length) notify(`Added ${title || loraTitle(name)} and its trigger words (${add.join(', ')}) to the prompt.`, 'info')
    setPicking(false)
    reloadYours()
  }
  useEffect(() => {
    if (!incomingLora) return
    addLora(incomingLora)
    clearIncomingLora?.()
  }, [incomingLora])
  // a picture from Create -> Image (Use in a shot): the shot opens on it, as its first frame
  useEffect(() => {
    if (!incomingPicture) return
    set({ mode: 'frames', media: [] })
    addFiles([{ kind: 'picture', path: incomingPicture }])
    clearIncomingPicture?.()
  }, [incomingPicture])

  async function pickVoice() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) set({ voiceLine: file, voiceItem: { kind: 'audio', path: file, info: await window.ivstudio.media.probe(file).catch(() => null) } })
  }

  // Files dropped on the references area, sorted by kind; the mode decides which kinds it takes.
  const [dragOver, setDragOver] = useState(false)
  function dropMedia(e) {
    e.preventDefault()
    setDragOver(false)
    const kindOf = (p) => (/\.(png|jpe?g|webp|bmp)$/i.test(p) ? 'picture' : /\.(mp4|mov|webm|mkv|m4v)$/i.test(p) ? 'video' : /\.(wav|mp3|flac|m4a|ogg|aac)$/i.test(p) ? 'audio' : null)
    const allowed = form.mode === 'frames' ? ['picture'] : form.mode === 'continue' ? ['video'] : ['picture', 'video', 'audio']
    const paths = [...e.dataTransfer.files].map((f) => window.ivstudio.media.pathFor(f)).filter(Boolean)
    const fit = paths.filter((p) => allowed.includes(kindOf(p)))
    if (fit.length < paths.length) notify(`This mode takes ${allowed.map((k) => `${k}s`).join(', ')}; the other files were left out.`)
    addFiles(fit.map((path) => ({ kind: kindOf(path), path })))
  }

  // The media editor: which reference is open (an index into media, or 'voice').
  const [editing, setEditing] = useState(null)
  const editItem = editing === 'voice' ? form.voiceItem || { kind: 'audio', path: form.voiceLine } : form.media[editing]
  const editHint = {
    frames: `Frames are stretched to the shot's size (${form.aspect}). Crop to "Shot" so nothing gets squashed.`,
    continue: 'The shot carries on from the last frames you keep: trim where the clip should hand over.',
    reference: 'Keep only what the shot should use. Shorter references are quicker.'
  }
  function applyEdit(next) {
    if (editing === 'voice') set({ voiceLine: next.path, voiceItem: next })
    else set({ media: form.media.map((m, j) => (j === editing ? next : m)) })
    setEditing(null)
  }
  const mediaLabel = (m, i) => (form.mode === 'frames' ? (i === 0 ? 'First frame' : 'Last frame') : form.mode === 'continue' ? 'Source video' : `<${m.kind[0].toUpperCase() + m.kind.slice(1)} ${form.media.filter((x, j) => x.kind === m.kind && j <= i).length}>`)

  async function hunt() {
    setBusy(true)
    try {
      const job = await window.ivstudio.render.previews({ ...request, projectName: form.projectName || undefined })
      notify('Previews started. You can keep working; they appear here as they finish.', 'info')
      openShot(job.projectId)
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }

  const char = characters.find((c) => c.id === form.character)
  const r = plan?.resolved
  const refmodsAvailable = setup?.refmods || []
  const blocked = setup && !setup.ready

  return (
    <div className="create">
      <Hero title="What if?" kicker="New shot" />
      {kindSwitch}

      {blocked && (
        <p className="notice">
          ComfyUI isn't ready yet.{' '}
          <button className="link-btn" onClick={() => go('setup')}>
            Open Setup
          </button>
        </p>
      )}

      <section className="block">
        <p className="mono label">01 · Mode</p>
        <div className="mode-cards">
          {MODES.map(([id, label, hint]) => (
            <button key={id} className={`mode-card ${form.mode === id ? 'on' : ''}`} onClick={() => set({ mode: id, media: [] })}>
              <span className="mode-name">{label}</span>
              <span className="dim small">{hint}</span>
            </button>
          ))}
        </div>
        {form.mode !== 'text' && (
          <p className="dim small mode-writer-hint">
            ✦ Add your {form.mode === 'frames' ? 'frames' : form.mode === 'continue' ? 'video' : 'pictures and videos'} below first: <b>Write it for me</b> looks at {form.mode === 'continue' ? 'its last frame' : 'them'} and writes what it sees into the prompt.
          </p>
        )}
      </section>

      <section className="block">
        <p className="mono label">02 · Who and what</p>
        <div className="row">
          <span className="row-label">Character</span>
          <div className="segmented">
            {characters.map((c) => (
              <button key={c.id} className={form.character === c.id ? 'on' : ''} onClick={() => set({ character: c.id })}>
                {c.name.split(' ')[0]}
              </button>
            ))}
            <button className={form.character === 'none' ? 'on' : ''} onClick={() => set({ character: 'none' })}>
              None
            </button>
          </div>
        </div>
        <div className="row">
          <span className="row-label">Shot name</span>
          <input className="shot-name-input" value={form.projectName} placeholder="e.g. Tess car rant (optional)" onChange={(e) => set({ projectName: e.target.value })} />
        </div>
        <div className="row lora-tray-row">
          <span className="row-label">LoRAs</span>
          <div className="lora-tray">
            {form.extraLoras.map((l, i) => {
              const info = loraInfo(l.name)
              return (
                <div key={l.name} className="lora-chip">
                  <LoraThumb className="small" preview={info?.prefs?.picture ? { file: info.prefs.picture, type: 'image' } : info?.civitai?.preview} label={loraTitle(l.name)} mature={info?.civitai?.mature} />
                  <div className="lora-chip-body">
                    <span className="lora-chip-name" title={l.name}>
                      {info?.civitai?.name || loraTitle(l.name)}
                    </span>
                    <div className="lora-chip-strength">
                      <input type="range" min={0} max={1.5} step={0.05} value={l.strength} onChange={(e) => set({ extraLoras: form.extraLoras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                      <span className="mono small">{Number(l.strength).toFixed(2)}</span>
                    </div>
                  </div>
                  <button className="lora-chip-x" title="Take it out of the shot" onClick={() => set({ extraLoras: form.extraLoras.filter((_, j) => j !== i) })}>
                    ×
                  </button>
                </div>
              )
            })}
            <button className="lora-add" onClick={() => setPicking(true)}>
              + Add LoRA
            </button>
          </div>
        </div>
        {picking && <LoraPicker notify={notify} go={go} onClose={() => setPicking(false)} onPick={addLora} />}
        {form.mode !== 'text' && (
          <div className={`media ${dragOver ? 'drag-over' : ''}`} onDragOver={(e) => (e.preventDefault(), setDragOver(true))} onDragLeave={() => setDragOver(false)} onDrop={dropMedia}>
            <div className="media-head">
              <span className="row-label">{form.mode === 'frames' ? 'Frames' : form.mode === 'continue' ? 'Source video' : 'References'}</span>
              <div className="media-actions">
                {(form.mode === 'frames' || form.mode === 'reference') && (
                  <button className="btn btn-small" onClick={() => addMedia('picture')}>
                    + Picture
                  </button>
                )}
                {(form.mode === 'continue' || form.mode === 'reference') && (
                  <button className="btn btn-small" onClick={() => addMedia('video')}>
                    + Video
                  </button>
                )}
                {form.mode === 'reference' && (
                  <button className="btn btn-small" onClick={() => addMedia('audio')}>
                    + Audio
                  </button>
                )}
              </div>
            </div>
            {form.media.length === 0 && <p className="dim small">{form.mode === 'frames' ? 'Add the first frame, and optionally a last frame, or drop pictures here. Pick an aspect ratio that matches them.' : form.mode === 'continue' ? 'Add the clip to continue, or drop it here. 24 fps works best.' : 'Add what the shot should keep: a place, an outfit, a voice. You can drop files here too.'}</p>}
            {form.media.length > 0 && (
              <div className="media-tiles">
                {form.media.map((m, i) => (
                  <MediaTile key={`${i}:${m.path}`} item={m} label={mediaLabel(m, i)} onEdit={() => setEditing(i)} onRemove={() => set({ media: form.media.filter((_, j) => j !== i) })} />
                ))}
              </div>
            )}
            {form.media.length > 0 && <p className="dim small">Click a reference to crop it or trim it. The original file isn't changed.</p>}
            {form.mode === 'continue' && (
              <div className="row">
                <span className="row-label">Overlap frames</span>
                <div className="segmented">
                  {[5, 22, 39, 56].map((n) => (
                    <button key={n} className={form.overlapFrames === n ? 'on' : ''} onClick={() => set({ overlapFrames: n })}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <PromptWriter
          context={{ mode: form.mode, seconds: form.seconds, aspect: form.aspect, character: form.character ?? 'none', media: form.media.map((m) => ({ kind: m.kind, file: m.path })) }}
          current={form.prompt}
          onWritten={(prompt) => set({ prompt })}
          notify={notify}
          go={go}
        />
        <div className="prompt-head">
          <span className="row-label">
            Prompt {char && <span className="dim small">· write <code>{'{char}'}</code> for {char.name.split(' ')[0]} ({char.trigger})</span>}
          </span>
          <button className="link-btn mono" onClick={() => set({ prompt: form.mode === 'reference' ? REF_TEMPLATE : TEMPLATE })}>
            Insert template
          </button>
        </div>
        <textarea className="prompt" rows={9} value={form.prompt} placeholder="Describe the shot: clothes, place, camera, action and the lines. Never the face or voice; the character carries those." onChange={(e) => set({ prompt: e.target.value })} />

        <div className="row voice-row">
          <span className="row-label">Voice line</span>
          <div className="voice-control">
            {form.voiceLine ? (
              <MediaTile item={form.voiceItem || { kind: 'audio', path: form.voiceLine }} label="Lip-sync" onEdit={() => setEditing('voice')} onRemove={() => set({ voiceLine: null, voiceItem: null })} />
            ) : (
              <>
                {char?.voiceId && (
                  <div className="speak-line">
                    <input value={say} placeholder={`What ${char.name.split(' ')[0]} says`} onChange={(e) => setSay(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && say.trim() && !speaking && speakLine()} />
                    <button className="btn btn-small btn-primary" disabled={!say.trim() || speaking} onClick={speakLine}>
                      {speaking ? 'Speaking… (up to a minute the first time)' : 'Speak it'}
                    </button>
                  </div>
                )}
                <button className="btn btn-small" onClick={pickVoice}>
                  + Recording to lip-sync
                </button>
              </>
            )}
            <span className="dim small">
              {char?.voiceId ? `Optional. Speak a line in ${char.name.split(' ')[0]}'s voice, or add a recording; the words go into the prompt's dialogue.` : char ? `Optional. Write the same words in the prompt. Give ${char.name.split(' ')[0]} a voice under Audio › Voices to speak lines here.` : 'Optional. Write the same words in the prompt.'}
            </span>
          </div>
        </div>
      </section>

      <section className="block">
        <p className="mono label">03 · Video</p>
        <div className="row">
          <span className="row-label">Aspect</span>
          <div className="segmented">
            {ASPECTS.map((a) => (
              <button key={a} className={form.aspect === a ? 'on' : ''} onClick={() => set({ aspect: a })}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <span className="row-label">Length</span>
          <div className="slider">
            <input type="range" min={1} max={15} step={0.5} value={form.seconds} onChange={(e) => set({ seconds: Number(e.target.value) })} />
            <span className="mono">{form.seconds} s</span>
          </div>
        </div>
        <div className="row">
          <span className="row-label">Preview size</span>
          <div className="segmented">
            {PREVIEW_MP.map((mp) => (
              <button key={mp} className={form.megapixels === mp ? 'on' : ''} onClick={() => set({ megapixels: mp })}>
                {mp} MP
              </button>
            ))}
          </div>
        </div>
        {form.mode !== 'continue' && (
          <div className="row">
            <span className="row-label">Previews</span>
            <div className="segmented">
              {[1, 2, 3].map((n) => (
                <button key={n} className={form.previews === n ? 'on' : ''} onClick={() => set({ previews: n })}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="row">
          <span className="row-label">Seed</span>
          <div className="seed">
            <input type="number" value={form.seed} onChange={(e) => set({ seed: Math.max(0, Number(e.target.value) || 0) })} />
            <button className="btn btn-small" onClick={() => set({ seed: Math.floor(Math.random() * 1e9) })}>
              🎲 New seed
            </button>
          </div>
        </div>
      </section>

      <section className="block">
        <button className="link-btn mono advanced-toggle" onClick={() => setAdvanced(!advanced)}>
          {advanced ? '− Hide advanced' : '+ Advanced: steps, extra LoRAs, RefMods'}
        </button>
        {advanced && (
          <div className="advanced">
            <div className="row">
              <span className="row-label">Steps</span>
              <input type="number" min={4} max={20} value={form.steps} onChange={(e) => set({ steps: Number(e.target.value) || 8 })} />
            </div>
            <div className="row">
              <span className="row-label">RefMods</span>
              <div>
                <div className="chips">
                  {form.refmods.map((m, i) => (
                    <span key={i} className="chip">
                      {m.name}
                      <input className="mini" type="number" min={0} max={1} step={0.1} value={m.strength} onChange={(e) => set({ refmods: form.refmods.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                      <button onClick={() => set({ refmods: form.refmods.filter((_, j) => j !== i) })}>×</button>
                    </span>
                  ))}
                </div>
                <select value="" onChange={(e) => e.target.value && set({ refmods: [...form.refmods, { name: e.target.value, strength: 1, copies: 1 }].slice(0, 8) })}>
                  <option value="">+ Add a RefMod…</option>
                  {refmodsAvailable.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                {form.refmods.length > 0 && (
                  <div className="row tight">
                    <span className="row-label">Retention</span>
                    <div className="segmented">
                      {[
                        [1, 'Full'],
                        [0.7, 'Partial'],
                        [0.4, 'Style']
                      ].map(([v, l]) => (
                        <button key={v} className={form.retention === v ? 'on' : ''} onClick={() => set({ retention: v })}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <p className="dim small">Saved references: a character's look or voice, a place, a style. Best with References mode.</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Stays at the bottom of the window while the form scrolls: what will render, and the button. */}
      <section className="go-dock">
        <div className="go-info">
          {r ? (
            <>
              <span className="mono">
                {r.previews} preview{r.previews > 1 ? 's' : ''} · {r.width} × {r.height} · {r.seconds} s · {r.model}
              </span>
              <span className="mono dim">
                {r.frames} frames · finish at 2 MP → {plan.finish.width} × {plan.finish.height}
              </span>
            </>
          ) : (
            <span className="mono pink">{planError}</span>
          )}
        </div>
        <button className="btn btn-primary" disabled={busy || !form.prompt.trim() || !r || blocked} onClick={hunt}>
          {busy ? 'Starting…' : `Hunt ${r?.previews || ''} preview${r?.previews > 1 ? 's' : ''}`}
        </button>
      </section>
      {editItem && <MediaEditor item={editItem} shotAspect={form.aspect} hint={editing === 'voice' ? 'Keep just the line to lip-sync. Write the same words in the prompt.' : editHint[form.mode]} onApply={applyEdit} onClose={() => setEditing(null)} notify={notify} />}
    </div>
  )
}
