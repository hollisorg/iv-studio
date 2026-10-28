import { useEffect, useMemo, useState } from 'react'
import Hero from './Hero'

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

export default function Create({ setup, characters, notify, openShot, go }) {
  const [form, setForm] = useState({
    projectName: '',
    mode: 'text',
    character: characters[0]?.id || null,
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
    // characters arrive after the first render; default to the first one until the user picks
    if (characters.length && form.character !== 'none' && !characters.some((c) => c.id === form.character)) set({ character: characters[0].id })
  }, [characters])

  const request = useMemo(() => {
    const { projectName, ...r } = form
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
    const files = await window.ivstudio.files.pick(kind)
    if (!files.length) return
    const limit = form.mode === 'frames' ? 2 : form.mode === 'continue' ? 1 : 12
    const next = form.mode === 'continue' ? [] : form.media
    set({ media: [...next, ...files.map((path) => ({ kind, path }))].slice(0, limit) })
  }

  async function pickVoice() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) set({ voiceLine: file })
  }

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
        <div className="prompt-head">
          <span className="row-label">
            Prompt {char && <span className="dim small">· write <code>{'{char}'}</code> for {char.name.split(' ')[0]} ({char.trigger})</span>}
          </span>
          <button className="link-btn mono" onClick={() => set({ prompt: form.mode === 'reference' ? REF_TEMPLATE : TEMPLATE })}>
            Insert template
          </button>
        </div>
        <textarea className="prompt" rows={9} value={form.prompt} placeholder="Describe the shot: clothes, place, camera, action and the lines. Never the face or voice; the character carries those." onChange={(e) => set({ prompt: e.target.value })} />

        {form.mode !== 'text' && (
          <div className="media">
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
            {form.media.length === 0 && <p className="dim small">{form.mode === 'frames' ? 'Add the first frame, and optionally a last frame. Pick an aspect ratio that matches them.' : form.mode === 'continue' ? 'Add the clip to continue. 24 fps works best.' : 'Add what the shot should keep: a place, an outfit, a voice.'}</p>}
            <div className="chips">
              {form.media.map((m, i) => (
                <span key={i} className="chip">
                  <span className="mono pink">{form.mode === 'frames' ? (i === 0 ? 'First' : 'Last') : `<${m.kind[0].toUpperCase() + m.kind.slice(1)} ${form.media.filter((x, j) => x.kind === m.kind && j <= i).length}>`}</span>
                  {base(m.path)}
                  <button onClick={() => set({ media: form.media.filter((_, j) => j !== i) })}>×</button>
                </span>
              ))}
            </div>
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

        <div className="row voice-row">
          <span className="row-label">Voice line</span>
          <div className="voice-control">
            {form.voiceLine ? (
              <span className="chip">
                <span className="mono pink">Lip-sync</span>
                {base(form.voiceLine)}
                <button onClick={() => set({ voiceLine: null })}>×</button>
              </span>
            ) : (
              <button className="btn btn-small" onClick={pickVoice}>
                + Recording to lip-sync
              </button>
            )}
            <span className="dim small">Optional. Write the same words in the prompt.</span>
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
            <div className="row">
              <span className="row-label">Extra LoRAs</span>
              <div>
                <div className="chips">
                  {form.extraLoras.map((l, i) => (
                    <span key={i} className="chip">
                      {base(l.name)}
                      <input className="mini" type="number" min={0} max={1.5} step={0.1} value={l.strength} onChange={(e) => set({ extraLoras: form.extraLoras.map((x, j) => (j === i ? { ...x, strength: Number(e.target.value) } : x)) })} />
                      <button onClick={() => set({ extraLoras: form.extraLoras.filter((_, j) => j !== i) })}>×</button>
                    </span>
                  ))}
                </div>
                <select value="" onChange={(e) => e.target.value && set({ extraLoras: [...form.extraLoras, { name: e.target.value, strength: 1 }] })}>
                  <option value="">+ Add a style LoRA…</option>
                  {(setup?.loras || []).filter((l) => /minimax|h3/i.test(l)).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="block go">
        <div className="row">
          <span className="row-label">Shot name</span>
          <input value={form.projectName} placeholder="e.g. Tess car rant" onChange={(e) => set({ projectName: e.target.value })} />
        </div>
        <div className="summary">
          {r ? (
            <>
              <span className="mono">
                {r.previews} preview{r.previews > 1 ? 's' : ''} · {r.width} × {r.height} · {r.frames} frames · {r.seconds} s · {r.model}
              </span>
              <span className="mono dim">
                Finish at 2 MP → {plan.finish.width} × {plan.finish.height}
              </span>
            </>
          ) : (
            <span className="mono pink">{planError}</span>
          )}
        </div>
        <button className="btn btn-primary big" disabled={busy || !form.prompt.trim() || !r || blocked} onClick={hunt}>
          {busy ? 'Starting…' : `Hunt ${r?.previews || ''} preview${r?.previews > 1 ? 's' : ''}`}
        </button>
      </section>
    </div>
  )
}
