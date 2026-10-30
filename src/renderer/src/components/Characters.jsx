import { useEffect, useRef, useState } from 'react'
import { LoraPicker, loraTitle } from './Loras'
import { ask } from './Confirm'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { MediaEditor, MediaTile } from './MediaEditor'
import { fileUrl } from './edit/model'
import { media } from '../media'

const STEPS = [
  ['design', 'Design'],
  ['clips', 'Clips'],
  ['train', 'Train'],
  ['pick', 'Pick']
]
const DONE = ['success', 'error', 'cancelled']
const RUNNING = ['preparing', 'models', 'uploading', 'training']
const STATE_TEXT = {
  preparing: 'Building the dataset…',
  models: 'Making sure the H3 training files are in your Modal storage (about 42 GB, the first time only)…',
  uploading: 'Uploading the dataset…',
  training: 'Training on Modal',
  done: 'Training finished',
  failed: 'Training stopped',
  stopped: 'Stopped'
}
const src = (file) => (file?.url ? media(file.url) : file?.path ? fileUrl(file.path) : null)

// Every character in one place: the ones you can use now (presets), ready-made ones to download, and
// characters you're designing or training.
export function CharacterList({ openCharacter, notify, characters, setCharacters, go }) {
  const [list, setList] = useState(null)
  // which character's LoRA the picker is choosing ('new' adds a character)
  const [pickFor, setPickFor] = useState(null)
  const [ready, setReady] = useState([])
  const [loras, setLoras] = useState([])
  const [progress, setProgress] = useState({})
  const [voices, setVoices] = useState([])
  const [name, setName] = useState('')
  const [who, setWho] = useState('a woman in her thirties')
  const C = window.ivstudio.characters
  const loadReady = () => C.catalog().then(setReady, () => {})
  useEffect(() => {
    window.ivstudio.voices.list().then(setVoices, () => {})
    window.ivstudio.training.list().then(setList)
    loadReady()
    C.loras().then(setLoras, () => {})
    return C.onProgress(({ id, progress: p }) => setProgress((x) => ({ ...x, [id]: p })))
  }, [])
  async function create() {
    try {
      openCharacter((await window.ivstudio.training.create({ name, who })).id)
    } catch (err) {
      notify(err.message)
    }
  }
  async function saveCharacter(id, patch) {
    setCharacters(await C.save(characters.map((c) => (c.id === id ? { ...c, ...patch } : c))))
  }
  async function install(id) {
    setProgress((x) => ({ ...x, [id]: 0 }))
    try {
      await C.install(id)
      setCharacters(await C.list())
      window.ivstudio.voices.list().then(setVoices, () => {})
      notify(`${ready.find((r) => r.id === id)?.name} is ready: pick them in Create and write {char} in the prompt.`, 'info')
    } catch (err) {
      notify(err.message)
    } finally {
      setProgress((x) => ({ ...x, [id]: undefined }))
      loadReady()
    }
  }
  const has = (lora) => loras.some((l) => l.replace(/\\/g, '/').toLowerCase() === String(lora).replace(/\\/g, '/').toLowerCase())
  const offered = ready.filter((r) => !characters.some((c) => c.id === r.id))
  const face = (c) => c.picture || ready.find((r) => r.id === c.id)?.picture

  return (
    <div className="characters">
      <Hero art="characters" title="Characters" kicker="Your recurring actors" />
      <p className="lede">
        The people H3 plays, the same in every shot.
        <span className="lede-small dim">
          A character is a trained H3 LoRA plus its trigger word: pick one in Create or Sequences and write {'{char}'} in the prompt where they go. Download a ready-made one, add a LoRA you already have, or design and train your own.
        </span>
      </p>

      <section className="group">
        <div className="group-head">
          <h2>Your characters</h2>
          <p className="dim small">Ready to use in Create, Sequences and Replace.</p>
        </div>
        <div className="group-body">
          <datalist id="iv-loras">
            {loras.filter((l) => /h3|minimax/i.test(l)).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
          <div className="preset-cards">
            {characters.map((c) => {
              const found = has(c.lora)
              const offer = ready.find((r) => r.id === c.id && r.available)
              return (
                <div key={c.id} className="preset-card">
                  <div className="preset-face">{face(c) ? <img src={fileUrl(face(c))} alt="" /> : <span>{c.name.slice(0, 1)}</span>}</div>
                  <div className="preset-fields">
                    <input className="preset-name" value={c.name} onChange={(e) => saveCharacter(c.id, { name: e.target.value })} />
                    <div className="row tight">
                      <span className="row-label">Trigger</span>
                      <input className="mono" value={c.trigger} onChange={(e) => saveCharacter(c.id, { trigger: e.target.value })} />
                    </div>
                    <div className="row tight">
                      <span className="row-label">Strength</span>
                      <input className="mini" type="number" step={0.05} min={0} max={1.5} value={c.strength} onChange={(e) => saveCharacter(c.id, { strength: Number(e.target.value) })} />
                    </div>
                    <div className="row tight">
                      <span className="row-label">LoRA</span>
                      <div className="lora-field">
                        <input list="iv-loras" value={c.lora} onChange={(e) => saveCharacter(c.id, { lora: e.target.value })} />
                        <button className="btn btn-small" onClick={() => setPickFor(c.id)}>
                          Choose
                        </button>
                      </div>
                    </div>
                    <div className="row tight">
                      <span className="row-label">Voice</span>
                      <select value={c.voiceId || ''} onChange={(e) => saveCharacter(c.id, { voiceId: e.target.value || null, voiceDeclined: !e.target.value })}>
                        <option value="">No voice</option>
                        {voices.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="row-actions">
                      <span className={`mono small ${found ? 'cloud-ok' : 'pink'}`}>{found ? '● LoRA found' : '● LoRA not in ComfyUI'}</span>
                      {!found && offer && (
                        <button className="btn btn-small btn-primary" disabled={progress[c.id] != null} onClick={() => install(c.id)}>
                          {progress[c.id] != null ? `Downloading ${Math.round(progress[c.id] * 100)}%` : `Download (${Math.round(offer.lora.size / 1e6)} MB)`}
                        </button>
                      )}
                    </div>
                  </div>
                  <TileDelete name={c.name} keeps="Only the preset goes; its LoRA file stays in ComfyUI, and shots already made with it keep working." notify={notify} onDelete={async () => setCharacters(await C.save(characters.filter((x) => x.id !== c.id)))} />
                </div>
              )
            })}
          </div>
          <button className="btn btn-small" onClick={() => setPickFor('new')}>
            + Add one from a LoRA
          </button>
          {pickFor && (
            <LoraPicker
              notify={notify}
              go={go}
              onClose={() => setPickFor(null)}
              onPick={async ({ name, words = [], title }) => {
                // a new character from the LoRA, or another LoRA for an existing one
                if (pickFor === 'new') setCharacters(await C.save([...characters, { id: `char${Date.now().toString(36)}`, name: title || loraTitle(name), lora: name, strength: 0.8, trigger: words[0] || 'n4m3' }]))
                else await saveCharacter(pickFor, { lora: name, ...(words[0] ? { trigger: words[0] } : {}) })
                setPickFor(null)
              }}
            />
          )}
        </div>
      </section>

      {offered.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Ready-made</h2>
            <p className="dim small">IV Studio's own invented characters. Download one (about 150 MB) and they join your characters.</p>
          </div>
          <div className="group-body">
            <div className="ready-cards">
              {offered.map((r) => (
                <div key={r.id} className="ready-card">
                  <img src={fileUrl(r.picture)} alt={`${r.name}'s face`} />
                  <div className="ready-body">
                    <span className="ready-name">{r.name}</span>
                    <span className="small dim">{r.about}</span>
                    <span className="mono small">
                      trigger {r.trigger} · strength {r.strength}
                    </span>
                    {r.available ? (
                      <button className="btn btn-small btn-primary" disabled={progress[r.id] != null} onClick={() => install(r.id)}>
                        {progress[r.id] != null ? `Downloading ${Math.round(progress[r.id] * 100)}%` : `Download (${Math.round(r.lora.size / 1e6)} MB)`}
                      </button>
                    ) : (
                      <span className="mono small dim">Coming soon</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="group">
        <div className="group-head">
          <h2>Train your own</h2>
          <p className="dim small">Design an invented person, give them talking clips and a voice, and train their LoRA on your Modal account (about 30 minutes and $3–4; new accounts get $30 a month free). Only invented people, or real people who agreed to it.</p>
        </div>
        <div className="group-body">
          <div className="row">
            <span className="row-label">Name</span>
            <input value={name} placeholder="e.g. Maya Ortiz" onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="row">
            <span className="row-label">Who</span>
            <input value={who} placeholder="a man in his fifties" onChange={(e) => setWho(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={!name.trim()} onClick={create}>
            Start designing
          </button>
          {list?.length > 0 && (
            <div className="tiles seq-tiles">
              {list.map((t) => (
                <div key={t.id} className="tile-wrap">
                  <button className="tile char-tile" onClick={() => openCharacter(t.id)}>
                    {t.cover ? <img src={src(t.cover)} alt="" /> : <span className="char-cover-empty mono dim">No face yet</span>}
                    <div className="tile-body">
                      <span className="tile-name">{t.name}</span>
                      <span className="mono dim">
                        {t.trigger} · {t.characterId ? 'ready to use' : t.state ? STATE_TEXT[t.state] || t.state : `step: ${t.step}`}
                      </span>
                    </div>
                  </button>
                  <TileDelete name={t.name} keeps={t.characterId ? 'The character preset and its LoRA stay; this removes the design stills, clips and dataset.' : 'This removes its design stills, clips and dataset.'} notify={notify} onDelete={async () => (await window.ivstudio.training.delete(t.id), setList(await window.ivstudio.training.list()))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

// One character from design to a saved preset.
export function CharacterTrainer({ trainingId, notify, go, setCharacters }) {
  const [t, setT] = useState(null)
  const [meta, setMeta] = useState(null)
  const [step, setStep] = useState(null)
  const [busy, setBusy] = useState(null)
  const [log, setLog] = useState([])
  const live = useRef(true)

  const load = () => window.ivstudio.training.get(trainingId).then((x) => live.current && setT(x), (err) => notify(err.message))
  useEffect(() => {
    live.current = true
    window.ivstudio.training.meta().then(setMeta)
    load()
    const offChange = window.ivstudio.training.onChanged(({ id }) => id === trainingId && load())
    const offLog = window.ivstudio.training.onLog(({ id, line }) => id === trainingId && setLog((l) => [...l.slice(-300), line]))
    return () => {
      live.current = false
      offChange()
      offLog()
    }
  }, [trainingId])
  useEffect(() => {
    if (t && !step) setStep({ done: 'pick', pick: 'pick', train: 'train', clips: 'clips', design: 'design' }[stepOf(t)])
  }, [t])

  // Keep polling while renders are queued or running.
  const pending = t && Object.values(t.jobs || {}).some((j) => !DONE.includes(j.status))
  useEffect(() => {
    if (!pending) return
    const h = setInterval(load, 3000)
    return () => clearInterval(h)
  }, [pending])
  // A training that runs on Modal without this window streaming it: read its log from storage now and then.
  const detached = t?.train?.state === 'training'
  useEffect(() => {
    if (!detached) return
    const check = () => window.ivstudio.training.check(trainingId).catch(() => {})
    check()
    const h = setInterval(check, 60000)
    return () => clearInterval(h)
  }, [detached])

  async function act(label, fn) {
    setBusy(label)
    try {
      const r = await fn()
      if (r?.id === trainingId) await load()
      return r
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!t || !meta || !step) return null
  const job = (id) => t.jobs?.[id]
  const save = (patch) => act('Saving', () => window.ivstudio.training.save(trainingId, patch))

  return (
    <div className="characters">
      <Hero art="characters" title={t.name} kicker={`Character · trigger ${t.trigger}`} />
      <div className="segmented char-steps">
        {STEPS.map(([id, label], i) => (
          <button key={id} className={step === id ? 'on' : ''} onClick={() => setStep(id)}>
            {String(i + 1).padStart(2, '0')} {label}
          </button>
        ))}
      </div>
      {busy && <p className="mono small dim">{busy}…</p>}

      {step === 'design' && <Design t={t} job={job} act={act} save={save} trainingId={trainingId} />}
      {step === 'clips' && <Clips t={t} job={job} act={act} save={save} trainingId={trainingId} meta={meta} notify={notify} next={() => setStep('train')} />}
      {step === 'train' && <Train t={t} act={act} meta={meta} log={log} go={go} trainingId={trainingId} next={() => setStep('pick')} />}
      {step === 'pick' && <Pick t={t} job={job} act={act} trainingId={trainingId} go={go} setCharacters={setCharacters} />}
    </div>
  )
}

function stepOf(t) {
  if (t.characterId || t.train?.state === 'done') return 'pick'
  if (t.train) return 'train'
  if (t.stills.some((s) => s.file)) return 'clips'
  return 'design'
}

// A render's picture or video, or how far it has got.
// A likeness score as a small badge: ArcFace cosine similarity with the picked face.
function Score({ value }) {
  if (value == null) return null
  const tone = value >= 0.5 ? 'good' : value >= 0.4 ? 'ok' : 'low'
  return <span className={`char-score ${tone}`} title="Face likeness with the picked face (InsightFace ArcFace): 0.6+ the same person, 0.4-0.6 a family resemblance, under 0.4 someone else">{value.toFixed(2)}</span>
}

// Scoring stills and clips against the picked face, after a one-time download of InsightFace's models.
function Likeness({ t, act, trainingId, pick }) {
  const [st, setSt] = useState(null)
  const [progress, setProgress] = useState(null)
  useEffect(() => {
    window.ivstudio.shinobi.status().then(setSt)
    return window.ivstudio.shinobi.onFaceProgress(setProgress)
  }, [])
  if (!st || !t.face) return null
  if (!st.faceModels)
    return (
      <div className="char-likeness">
        <p className="small">
          <span className="pink">Rank by likeness.</span> IV Studio can score every still and clip against the picked face and keep the closest, the way Tess's set was chosen. It uses InsightFace's face models (289 MB, downloaded once from InsightFace's release{st.installed ? '' : ', with Shinobi’s engine, about 440 MB'}). {st.faceLicence}
        </p>
        <button className="btn btn-small" onClick={() => act('Downloading the face models', () => window.ivstudio.shinobi.faceModels()).then(() => window.ivstudio.shinobi.status().then(setSt))}>
          {progress != null && progress < 1 ? `Downloading… ${Math.round(progress * 100)}%` : 'Download the face models'}
        </button>
      </div>
    )
  return (
    <div className="char-likeness">
      <button className="btn btn-small" onClick={() => act('Scoring likeness', () => window.ivstudio.training.rank(trainingId, { pick }))}>
        {pick ? 'Score and keep the closest of each scene' : 'Score against the face'}
      </button>
      {t.rankedAt && <span className="mono small dim">Scored {new Date(t.rankedAt).toLocaleTimeString()}. 0.5+ good · 0.4–0.5 fair · under 0.4 another face</span>}
    </div>
  )
}

function Render({ j, kind = 'image', onClick, picked, score }) {
  if (!j || !DONE.includes(j.status))
    return <div className="char-pending mono small dim">{j?.status === 'running' ? `Rendering${j.progress?.max ? ` ${Math.round((100 * j.progress.value) / j.progress.max)}%` : '…'}` : j?.queuePosition ? `Queued · ${j.queuePosition}` : 'Queued'}</div>
  if (j.status !== 'success') return <div className="char-pending mono small pink">{j.error || j.status}</div>
  const out = j.outputs.find((o) => o.kind === (kind === 'image' ? 'image' : 'preview'))
  if (!out) return <div className="char-pending mono small dim">No output</div>
  return kind === 'image' ? (
    <button className={`char-img ${picked ? 'picked' : ''}`} onClick={() => onClick?.(out)}>
      <img src={media(out.url)} alt="" />
      <Score value={score} />
    </button>
  ) : (
    <div className="char-video-wrap">
      <video className="char-video" src={media(out.url)} controls preload="metadata" />
      <Score value={score} />
    </div>
  )
}

function Design({ t, job, act, save, trainingId }) {
  const [faceText, setFaceText] = useState(t.faceText)
  const [who, setWho] = useState(t.who)
  const [trigger, setTrigger] = useState(t.trigger)
  const [caption, setCaption] = useState('')
  const T = window.ivstudio.training
  return (
    <>
      <section className="block">
        <p className="mono label">01 · The face</p>
        <div className="row">
          <span className="row-label">Who</span>
          <input value={who} onChange={(e) => setWho(e.target.value)} onBlur={() => who !== t.who && save({ who })} />
        </div>
        <div className="row">
          <span className="row-label">Trigger word</span>
          <input className="mono" value={trigger} onChange={(e) => setTrigger(e.target.value)} onBlur={() => trigger !== t.trigger && save({ trigger })} />
        </div>
        <p className="small dim">Made up, so H3 has no idea what it means until it learns this face. Prompts write {'{char}'} for it.</p>
        <span className="row-label">Face</span>
        <textarea rows={3} value={faceText} placeholder="e.g. oval face, light freckles across the nose, hazel eyes, straight dark brown shoulder-length hair with a side parting, thin eyebrows" onChange={(e) => setFaceText(e.target.value)} />
        <p className="small dim">Only the face and hair: age, face shape, eyes, skin, hair. It's used for the design stills only; captions never mention it, so the face binds to the trigger word.</p>
        <button className="btn btn-primary" onClick={() => act('Making four faces', () => T.designFaces(trainingId, { faceText, who }))}>
          {t.faceCandidates.length ? 'Make four more faces' : 'Make four faces'}
        </button>
        {t.faceCandidates.length > 0 && (
          <div className="char-grid">
            {t.faceCandidates.map((c) => (
              <Render key={c.jobId} j={job(c.jobId)} picked={t.face?.jobId === c.jobId} onClick={(file) => act('Picking', () => T.pickFace(trainingId, { jobId: c.jobId, file }))} />
            ))}
          </div>
        )}
        {t.face && <p className="small">Face picked. Every scene uses its seed and description, so they read as one person.</p>}
      </section>

      <section className="block">
        <p className="mono label">02 · Scenes</p>
        <p className="small dim">Eight stills in different places, clothes and light, so none of them welds to the trigger. Each scene has four candidates: pick the one that looks most like your face ("Two more" if none do), or leave the scene out. A weak still teaches the LoRA a blend.</p>
        {t.stills.length > 0 && <Likeness t={t} act={act} trainingId={trainingId} pick />}
        {t.face && !t.stills.some((s) => s.source === 'generated') && (
          <button className="btn btn-primary" onClick={() => act('Making the scenes', () => T.designScenes(trainingId))}>
            Make the scene stills
          </button>
        )}
        {t.stills.map((s) => (
          <div key={s.id} className="char-still">
            <div className="char-grid">
              {s.source === 'upload' ? (
                <span className="char-img picked">
                  <img src={src(s.file)} alt="" />
                </span>
              ) : (
                s.candidates.map((c, k) => <Render key={c.jobId} j={job(c.jobId)} picked={s.pick === k} score={c.score} onClick={(file) => act('Picking', () => T.pickStill(trainingId, s.id, { pick: k, file }))} />)
              )}
            </div>
            <div className="char-still-side">
              <input className="small" defaultValue={s.caption} onBlur={(e) => e.target.value !== s.caption && act('Saving', () => T.setCaption(trainingId, 'still', s.id, e.target.value))} />
              <div className="row-actions">
                {s.source === 'generated' && (
                  <>
                    <button className="link-btn mono" onClick={() => act('Rendering', () => T.rerollStill(trainingId, s.id))}>
                      Two more
                    </button>
                    <button className="link-btn mono" onClick={() => act('Saving', () => T.pickStill(trainingId, s.id, { pick: null }))}>
                      Leave out
                    </button>
                  </>
                )}
                {s.source === 'upload' && (
                  <button className="link-btn mono" onClick={() => act('Removing', () => T.removeItem(trainingId, 'still', s.id))}>
                    Remove
                  </button>
                )}
                <span className={`mono small ${s.file ? 'cloud-ok' : 'dim'}`}>{s.file ? '● In the set' : 'Not in the set'}</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="block">
        <p className="mono label">03 · Or your own pictures</p>
        <label className="me-snap small">
          <input type="checkbox" checked={!!t.consent} onChange={(e) => save({ consent: e.target.checked })} /> These pictures and clips are of an invented person, or of someone who agreed to be trained
        </label>
        <div className="row">
          <span className="row-label">Caption</span>
          <input value={caption} placeholder="what's in them: clothes, place, framing (never the face)" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <button className="btn btn-small" disabled={!t.consent} onClick={() => act('Adding', () => T.addStills(trainingId, caption))}>
          + Add pictures
        </button>
      </section>
    </>
  )
}

function Clips({ t, job, act, save, trainingId, meta, notify, next }) {
  const [lines, setLines] = useState(meta.talks.map((x) => x.line))
  const [caption, setCaption] = useState('')
  const [editing, setEditing] = useState(false)
  const T = window.ivstudio.training
  const kept = t.stills.filter((s) => s.file).length
  const voice = t.voice?.path ? { kind: 'audio', path: t.voice.path, source: t.voice.source, edit: t.voice.edit, info: t.voice.info } : null
  const [voices, setVoices] = useState([])
  useEffect(() => {
    window.ivstudio.voices.list().then(setVoices, () => {})
  }, [])
  async function pickVoice() {
    const [file] = await window.ivstudio.files.pick('audio')
    if (file) save({ voice: { path: file, info: await window.ivstudio.media.probe(file).catch(() => null) } })
  }
  return (
    <>
      <section className="block">
        <p className="mono label">01 · Voice (optional)</p>
        <p className="small dim">One of your voices (design one under Audio › Voices) or a clean recording; never a real person's voice without their consent. The clips speak with it, so the LoRA learns it too. 10–30 seconds is plenty.</p>
        {voice ? (
          <div className="voice-control">
            <MediaTile item={voice} label="Voice" onEdit={() => setEditing(true)} onRemove={() => save({ voice: null })} />
          </div>
        ) : (
          <div className="row-actions">
            <button className="btn btn-small" onClick={pickVoice}>
              + Voice recording
            </button>
            {voices.length > 0 && (
              <select value="" onChange={async (e) => {
                const v = voices.find((x) => x.id === e.target.value)
                if (v) save({ voice: { path: v.reference, info: await window.ivstudio.media.probe(v.reference).catch(() => null) } })
              }}>
                <option value="">or one of your voices…</option>
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {editing && voice && (
          <MediaEditor
            item={voice}
            hint="Keep a clean stretch of the voice, without music or other people."
            onApply={(v) => (save({ voice: { path: v.path, source: v.source, edit: v.edit, info: v.info } }), setEditing(false))}
            onClose={() => setEditing(false)}
            notify={notify}
          />
        )}
      </section>

      <section className="block">
        <p className="mono label">02 · Talking clips</p>
        <p className="small dim">
          Clips teach how they move and talk. IV Studio renders them with H3 on this PC from two of your stills{voice ? ' and the voice' : ''}: eight 5-second clips, about a minute each. Edit the lines if you like.
        </p>
        {!t.clips.some((c) => c.source === 'generated') && (
          <>
            <div className="char-lines">
              {meta.talks.map((x, k) => (
                <div key={k} className="row">
                  <span className="row-label small dim">{x.scene.split(',')[0]}</span>
                  <input value={lines[k]} onChange={(e) => setLines(lines.map((l, j) => (j === k ? e.target.value : l)))} />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" disabled={kept < 2} onClick={() => act('Queuing the clips', () => T.makeClips(trainingId, { talks: meta.talks.map((x, k) => ({ ...x, line: lines[k] })) }))}>
              Render the talking clips
            </button>
            {kept < 2 && <p className="small pink">Keep at least two stills in Design first.</p>}
          </>
        )}
        <div className="char-clips">
          {t.clips.map((c) => (
            <div key={c.id} className={`char-clip ${c.keep ? '' : 'left-out'}`}>
              {c.source === 'upload' ? <video className="char-video" src={src(c.file)} controls preload="metadata" /> : <Render j={job(c.jobId)} kind="video" score={c.score} />}
              <input className="small" defaultValue={c.caption} onBlur={(e) => e.target.value !== c.caption && act('Saving', () => T.setCaption(trainingId, 'clip', c.id, e.target.value))} />
              <div className="row-actions">
                <label className="me-snap small">
                  <input type="checkbox" checked={c.keep} onChange={(e) => act('Saving', () => T.keepClip(trainingId, c.id, e.target.checked))} /> In the set
                </label>
                {c.source === 'upload' ? (
                  <button className="link-btn mono" onClick={() => act('Removing', () => T.removeItem(trainingId, 'clip', c.id))}>
                    Remove
                  </button>
                ) : (
                  DONE.includes(job(c.jobId)?.status) && (
                    <button className="link-btn mono" onClick={() => act('Rendering again', () => T.remakeClips(trainingId, [c.id]))}>
                      Render again
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
        {t.clips.some((c) => c.file) && <Likeness t={t} act={act} trainingId={trainingId} />}
        <p className="small dim">If the face drifts or the mouth smears, render that clip again or leave it out. Every clip uses the picked face as its main reference.</p>
      </section>

      <section className="block">
        <p className="mono label">03 · Or your own clips</p>
        <p className="small dim">Phone videos or generations (Seedance, Kling…) of the same person talking. Long clips are cut into 5-second pieces and fitted to H3's frame grid.</p>
        <div className="row">
          <span className="row-label">Caption</span>
          <input value={caption} placeholder="clothes, place, action, framing (never the face or voice)" onChange={(e) => setCaption(e.target.value)} />
        </div>
        <button className="btn btn-small" disabled={!t.consent} onClick={() => act('Adding', () => T.addClips(trainingId, caption))}>
          + Add clips
        </button>
        {!t.consent && <p className="small dim">Tick the consent box in Design first.</p>}
      </section>
      <button className="btn btn-primary" onClick={next}>
        Next: train
      </button>
    </>
  )
}

function Train({ t, act, meta, log, go, trainingId, next }) {
  const [gpu, setGpu] = useState(t.train?.gpu || 'H200')
  const [epochs, setEpochs] = useState(t.train?.epochs || t.estimate.epochs)
  const [est, setEst] = useState(t.estimate)
  const [cloud, setCloud] = useState(null)
  const logEl = useRef(null)
  const T = window.ivstudio.training
  useEffect(() => {
    window.ivstudio.cloud.status().then(setCloud)
  }, [])
  useEffect(() => {
    T.estimate(trainingId, { gpu, epochs }).then(setEst)
  }, [gpu, epochs, t.updatedAt])
  useEffect(() => {
    logEl.current?.scrollTo(0, logEl.current.scrollHeight)
  }, [log])
  const kept = t.stills.filter((s) => s.file).length
  const clips = t.clips.filter((c) => c.keep && c.file).length
  const st = t.train?.state
  const running = RUNNING.includes(st)
  const p = t.train?.progress
  const ready = cloud?.toolkit && cloud?.workspace

  async function start() {
    const yes = await ask({
      kicker: 'Uses your Modal account',
      title: `Train ${t.name}?`,
      message: 'Modal bills by the second and stops the GPU when training ends. New accounts get $30 of free compute a month.',
      details: [
        ['GPU', gpu],
        ['Workspace', cloud.workspace],
        ['Time', `about ${est.minutes} minutes (${est.steps} steps)`],
        ['Cost', `about $${est.dollars}`]
      ],
      confirm: 'Start training'
    })
    if (!yes) return
    act('Starting', () => T.start(trainingId, { gpu, epochs }))
  }
  return (
    <>
      <section className="block">
        <p className="mono label">01 · The set</p>
        <p className="small">
          {kept} still{kept === 1 ? '' : 's'} and {clips} clip{clips === 1 ? '' : 's'}.{' '}
          <span className="dim">Claire had 8 stills, 7 face crops and 14 clips; Tess 15, 15 and 48 voice clips. 6–10 stills and 8–14 clips is a good start.</span>
        </p>
        {(kept < 4 || kept + clips < 8) && <p className="small pink">Too few to learn a face yet: keep at least 4 stills and 8 items in all.</p>}
        <button className="link-btn mono" onClick={() => act('Building the dataset', () => T.openDataset(trainingId))}>
          Open the dataset folder (to train in Fizgig yourself) ↗
        </button>
      </section>

      <section className="block">
        <p className="mono label">02 · Where it trains</p>
        {!ready && (
          <p className="small">
            Training runs on your own Modal account.{' '}
            <button className="link-btn" onClick={() => go('cloud')}>
              Set up the Cloud tools and sign in first
            </button>{' '}
            (steps 1 and 2 on the Cloud page; you don't need the rest).
          </p>
        )}
        <div className="cloud-gpus">
          {meta.gpus.map((g) => (
            <button key={g.id} className={`mode-card ${gpu === g.id ? 'on' : ''}`} disabled={running} onClick={() => setGpu(g.id)}>
              <span className="mode-name">{g.label}</span>
              <span className="mono">${g.perHour.toFixed(2)} an hour, by the second</span>
              <span className="dim small">{g.note}</span>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="row-label">Epochs</span>
          <input className="mini" type="number" min={10} max={200} value={epochs} disabled={running} onChange={(e) => setEpochs(Number(e.target.value))} />
        </div>
        {est && kept >= 4 && (
          <p className="small">
            About <span className="pink">{est.minutes} minutes</span> and <span className="pink">${est.dollars}</span> of Modal time ({est.steps} steps). The GPU stops by itself when training ends.
          </p>
        )}
        {!running && (
          <button className="btn btn-primary" disabled={!ready || kept < 4} onClick={start}>
            {st ? 'Train again' : 'Start training'}
          </button>
        )}
      </section>

      {st && (
        <section className="block">
          <p className="mono label">03 · Progress</p>
          <p className="small">
            {STATE_TEXT[st] || st}
            {p?.epoch ? ` · epoch ${p.epoch} of ${p.epochs}` : p?.stage ? ` · ${p.stage}` : ''}
          </p>
          {p?.epoch && (
            <div className="char-progress">
              <span style={{ width: `${(100 * p.epoch) / p.epochs}%` }} />
            </div>
          )}
          {t.train.error && <p className="small pink">{t.train.error}</p>}
          {st === 'training' && <p className="small dim">It keeps training on Modal if you close IV Studio; come back here to see how far it got.</p>}
          {running && (
            <button className="link-btn mono" onClick={async () => (await ask({ title: 'Stop training?', message: 'Billing stops at once. The epochs saved so far stay in your Modal storage.', confirm: 'Stop training', danger: true })) && act('Stopping', () => T.stop(trainingId))}>
              Stop training
            </button>
          )}
          {st === 'done' && (
            <button className="btn btn-primary" onClick={next}>
              Next: pick the best checkpoint
            </button>
          )}
          {log.length > 0 && (
            <pre className="code cloud-log" ref={logEl}>
              {log.join('\n')}
            </pre>
          )}
        </section>
      )}
    </>
  )
}

function Pick({ t, job, act, trainingId, go, setCharacters }) {
  const T = window.ivstudio.training
  const epochs = t.checkpoints.map((c) => c.epoch)
  const last = epochs.at(-1)
  const suggested = [...new Set([Math.round(last * 0.5), Math.round(last * 0.75), last].map((e) => epochs.reduce((a, b) => (Math.abs(b - e) < Math.abs(a - e) ? b : a), epochs[0])))].filter(Boolean)
  const [chosen, setChosen] = useState(suggested)
  if (!t.train || t.train.state !== 'done') return <p className="small dim">Train first; the checkpoints show up here when it's done.</p>
  async function test() {
    await act('Downloading the checkpoints', () => T.fetch(trainingId, chosen))
    await act('Rendering the tests', () => T.test(trainingId, { epochs: chosen }))
  }
  async function adopt(epoch) {
    await act('Saving the character', () => T.adopt(trainingId, epoch))
    setCharacters(await window.ivstudio.characters.list())
  }
  return (
    <>
      <section className="block">
        <p className="mono label">01 · Test checkpoints</p>
        <p className="small dim">Training saved a checkpoint every few epochs. Trainer previews mislead, so judge them in H3 itself: the same shot and seed for each. Late epochs often look best.</p>
        <div className="char-epochs">
          {epochs.map((e) => (
            <button key={e} className={`mono ${chosen.includes(e) ? 'on' : ''}`} onClick={() => setChosen(chosen.includes(e) ? chosen.filter((x) => x !== e) : [...chosen, e].sort((a, b) => a - b))}>
              {e}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!chosen.length} onClick={test}>
          Test {chosen.length} checkpoint{chosen.length === 1 ? '' : 's'}
        </button>
      </section>
      {t.tests.length > 0 && (
        <section className="block">
          <p className="mono label">02 · Choose one</p>
          <div className="char-clips">
            {[...t.tests].sort((a, b) => a.epoch - b.epoch).map((x) => (
              <div key={x.epoch} className={`char-clip ${t.chosenEpoch === x.epoch ? 'chosen' : ''}`}>
                <Render j={job(x.jobId)} kind="video" />
                <div className="row-actions">
                  <span className="mono">Epoch {x.epoch}</span>
                  <button className="btn btn-small" disabled={job(x.jobId)?.status !== 'success'} onClick={() => adopt(x.epoch)}>
                    {t.chosenEpoch === x.epoch ? 'Chosen ✓' : 'Use this one'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {t.characterId && (
        <section className="block">
          <p className="small">
            <span className="cloud-ok">●</span> {t.name} is a character now (epoch {t.chosenEpoch} at 0.8). Pick them in Create or Sequences, and write {'{char}'} in the prompt.
          </p>
          <button className="btn btn-primary" onClick={() => go('create')}>
            Make a shot with {t.name.split(' ')[0]}
          </button>
        </section>
      )}
    </>
  )
}
