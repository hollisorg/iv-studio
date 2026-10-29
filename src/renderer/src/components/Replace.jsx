import { useEffect, useState } from 'react'
import Hero from './Hero'
import { MediaEditor, MediaTile } from './MediaEditor'
import { fileUrl } from './edit/model'
import { media } from '../media'

const MODES = [
  ['person', 'Person', 'Your character takes the place of the main person.'],
  ['people', 'Several people', '1–4 characters, each replacing someone you describe.'],
  ['object', 'Object', 'Change, remove, or replace the background around something.'],
  ['finish', 'Finish', 'Restore small faces, or soften H3’s look.']
]
const OBJECT_MODES = [
  ['change', 'Change it'],
  ['remove', 'Remove it'],
  ['background', 'New background']
]
const DONE = ['success', 'error', 'cancelled']

export default function Replace({ notify, characters }) {
  const [meta, setMeta] = useState(null)
  const [mode, setMode] = useState('person')
  const [video, setVideo] = useState(null) // MediaEditor item
  const [editing, setEditing] = useState(false)
  const [pictures, setPictures] = useState([]) // [{path, role}]
  const [faces, setFaces] = useState([])
  const [characterId, setCharacterId] = useState('')
  const [obj, setObj] = useState({ mode: 'change', target: '', changeTo: '' })
  const [finish, setFinish] = useState('faces')
  const [faceStyle, setFaceStyle] = useState('photo')
  const [detail, setDetail] = useState(-0.2)
  const [run, setRun] = useState({ resolution: '576p', motion: 512, clipSeconds: 6, seed: 7, noLipSync: false, hatFix: false, margin: 'normal', onePass: false })
  const [check, setCheck] = useState(null)
  const [history, setHistory] = useState([])
  const [busy, setBusy] = useState(null)
  const R = window.ivstudio.replace
  const flowMode = mode === 'finish' ? (finish === 'faces' ? 'faces' : 'colours') : mode === 'people' && run.onePass && pictures.length === 2 ? 'people_maxq' : mode

  const loadHistory = () => R.history().then(setHistory)
  useEffect(() => {
    R.meta().then(setMeta)
    R.characterFaces().then(setFaces)
    loadHistory()
  }, [])
  useEffect(() => {
    setCheck(null)
    R.check(flowMode).then(setCheck, (err) => setCheck({ ready: false, error: err.message, packs: [], models: [] }))
  }, [flowMode])
  const running = history.some((j) => !DONE.includes(j.status))
  useEffect(() => {
    if (!running) return
    const h = setInterval(loadHistory, 4000)
    return () => clearInterval(h)
  }, [running])

  async function pickVideo() {
    const [file] = await window.ivstudio.files.pick('video')
    if (file) setVideo({ kind: 'video', path: file, info: await window.ivstudio.media.probe(file).catch(() => null) })
  }
  async function addPicture() {
    const files = await window.ivstudio.files.pick('picture')
    const max = mode === 'people' ? meta.maxCharacters : 1
    setPictures((p) => [...(max === 1 ? [] : p), ...files.map((path) => ({ path, role: '' }))].slice(0, max))
  }
  function useFace(f) {
    const max = mode === 'people' ? meta.maxCharacters : 1
    setPictures((p) => [...(max === 1 ? [] : p), { path: f.picture, role: '', name: f.name, characterId: f.characterId }].slice(0, max))
    if (max === 1 && f.characterId) setCharacterId(f.characterId)
  }

  async function go(kind) {
    setBusy(kind === 'mask' ? 'Checking the mask' : 'Starting')
    try {
      const m = kind === 'mask' ? 'mask' : flowMode
      const settings = {
        resolution: run.resolution,
        motion: run.motion,
        clipSeconds: run.clipSeconds,
        seed: run.seed,
        margin: run.margin,
        hatFix: run.hatFix,
        noLipSync: run.noLipSync,
        ...(mode === 'person' && { role: pictures[0]?.role || '' }),
        ...(mode === 'people' && { roles: pictures.map((p) => p.role) }),
        ...(mode === 'object' && obj),
        ...(m === 'mask' && mode === 'object' && { target: obj.target }),
        ...(m === 'faces' && { style: faceStyle }),
        ...(m === 'colours' && { detail })
      }
      await R.run({ mode: m, video: video.path, pictures: m === 'mask' || m === 'colours' ? [] : pictures.map((p) => p.path), settings, characterId: mode === 'person' ? characterId || null : null })
      notify(kind === 'mask' ? 'Mask check started: it shows what will be redrawn, in about a minute.' : 'Started. Replace renders clip by clip; it shows here when it’s done.', 'info')
      await loadHistory()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (!meta) return null
  const needsPictures = mode === 'person' || mode === 'people' || (mode === 'finish' && finish === 'faces')
  const showPictures = needsPictures || (mode === 'object' && obj.mode !== 'remove')
  const charPreset = characters.find((c) => c.id === characterId)
  const can = !!video && check?.ready && (!needsPictures || pictures.length > 0) && (mode !== 'object' || (obj.target && (obj.mode === 'remove' || obj.changeTo || pictures.length)))

  return (
    <div className="replace">
      <Hero title="Replace" kicker="Swap who's in the shot" />
      <p className="lede">
        Put your character into any video.
        <span className="lede-small dim">The camera, cuts, motion and soundtrack stay; only the person or thing you choose is redrawn by H3, clip by clip. SAM 3.1 tracks them and Qwen3-VL writes the prompts.</span>
      </p>

      <div className="mode-cards replace-modes">
        {MODES.map(([id, name, about]) => (
          <button key={id} className={`mode-card ${mode === id ? 'on' : ''}`} onClick={() => (setMode(id), setPictures([]), setCharacterId(''))}>
            <span className="mode-name">{name}</span>
            <span className="dim small">{about}</span>
          </button>
        ))}
      </div>

      {check && !check.ready && (
        <section className="group replace-missing">
          <div className="group-head">
            <h2>Needed first</h2>
          </div>
          <div className="group-body">
            {check.error && <p className="small pink">{check.error}</p>}
            {check.packs.map((p) => (
              <p key={p.url} className="small">
                Node pack{' '}
                <button className="link-btn" onClick={() => window.ivstudio.links.open(p.url)}>
                  {p.name}
                </button>{' '}
                <span className="dim mono">({p.missing.join(', ')})</span>
              </p>
            ))}
            {check.models.map((m) => (
              <p key={m.name} className="small">
                Model {m.name}, in <span className="mono">models/{m.where}</span>: download it on the Setup page.
              </p>
            ))}
          </div>
        </section>
      )}

      <section className="block">
        <p className="mono label">01 · The video</p>
        {video ? (
          <div className="voice-control">
            <MediaTile item={video} label="Source" onEdit={() => setEditing(true)} onRemove={() => setVideo(null)} />
            <span className="small dim">Click it to trim or crop. It needs a soundtrack; longer videos run in several H3 clips.</span>
          </div>
        ) : (
          <button className="btn btn-small" onClick={pickVideo}>
            + Source video
          </button>
        )}
      </section>

      {mode === 'object' && (
        <section className="block">
          <p className="mono label">02 · What changes</p>
          <div className="segmented">
            {OBJECT_MODES.map(([id, label]) => (
              <button key={id} className={obj.mode === id ? 'on' : ''} onClick={() => setObj({ ...obj, mode: id })}>
                {label}
              </button>
            ))}
          </div>
          <div className="row">
            <span className="row-label">{obj.mode === 'background' ? 'What stays' : 'What'}</span>
            <input value={obj.target} placeholder={obj.mode === 'background' ? 'person' : 'hair, the jacket, the car (commas for several)'} onChange={(e) => setObj({ ...obj, target: e.target.value })} />
          </div>
          {obj.mode !== 'remove' && (
            <div className="row">
              <span className="row-label">{obj.mode === 'background' ? 'New place' : 'Becomes'}</span>
              <input value={obj.changeTo} placeholder={obj.mode === 'background' ? 'a rainy Tokyo street at night' : 'short bleached hair'} onChange={(e) => setObj({ ...obj, changeTo: e.target.value })} />
            </div>
          )}
          {obj.mode === 'remove' && (
            <div className="row">
              <span className="row-label">Shows instead</span>
              <input value={obj.changeTo} placeholder="optional: what fills the space" onChange={(e) => setObj({ ...obj, changeTo: e.target.value })} />
            </div>
          )}
        </section>
      )}

      {mode === 'finish' && (
        <section className="block">
          <p className="mono label">02 · Finish</p>
          <div className="segmented">
            <button className={finish === 'faces' ? 'on' : ''} onClick={() => setFinish('faces')}>
              Fix faces
            </button>
            <button className={finish === 'colours' ? 'on' : ''} onClick={() => setFinish('colours')}>
              Fix colours
            </button>
          </div>
          {finish === 'faces' ? (
            <>
              <p className="small dim">H3 draws faces poorly when the person is small. This redraws the face at close-up size from a picture of them, then pastes it back.</p>
              <div className="segmented">
                <button className={faceStyle === 'photo' ? 'on' : ''} onClick={() => setFaceStyle('photo')}>
                  Match the picture
                </button>
                <button className={faceStyle === 'mouth' ? 'on' : ''} onClick={() => setFaceStyle('mouth')}>
                  Follow the mouth
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="small dim">Softens H3's harsh look without an H3 run: less fine detail contrast, then a filmic tone curve on every frame.</p>
              <div className="row">
                <span className="row-label">Detail</span>
                <input type="range" min={-1} max={1} step={0.05} value={detail} onChange={(e) => setDetail(Number(e.target.value))} />
                <span className="mono small">{detail.toFixed(2)}</span>
              </div>
            </>
          )}
        </section>
      )}

      {showPictures && (
        <section className="block">
          <p className="mono label">{mode === 'finish' ? '03 · The face' : mode === 'object' ? '03 · Or show it (optional)' : '02 · Who goes in'}</p>
          <div className="media-actions">
            <button className="btn btn-small" onClick={addPicture}>
              + Picture
            </button>
            {mode !== 'object' && faces.map((f) => (
              <button key={f.id} className="btn btn-small" onClick={() => useFace(f)}>
                {f.name}
              </button>
            ))}
          </div>
          {pictures.length > 0 && (
            <div className="media-tiles">
              {pictures.map((p, i) => (
                <div key={`${p.path}${i}`} className="media-tile">
                  <div className="media-thumb">
                    <img src={fileUrl(p.path)} alt="" />
                  </div>
                  {mode !== 'finish' && mode !== 'object' && <input className="small" value={p.role} placeholder={mode === 'people' ? 'who: the woman on the left' : 'who to replace (optional)'} onChange={(e) => setPictures(pictures.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))} />}
                  <button className="media-remove" onClick={() => setPictures(pictures.filter((_, j) => j !== i))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          {mode === 'person' && characters.length > 0 && (
            <div className="row">
              <span className="row-label">Character LoRA</span>
              <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
                <option value="">None (the picture alone)</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {charPreset && <p className="small dim">{charPreset.name}'s LoRA joins the run at {charPreset.strength}, which holds their face and voice more firmly than a picture alone.</p>}
          {mode === 'people' && pictures.length === 2 && (
            <label className="me-snap small">
              <input type="checkbox" checked={run.onePass} onChange={(e) => setRun({ ...run, onePass: e.target.checked })} /> One pass per person (better likeness, about twice as long)
            </label>
          )}
        </section>
      )}

      {mode !== 'finish' && (
        <details className="block replace-settings">
          <summary className="mono label">Settings</summary>
          <div className="row">
            <span className="row-label">Resolution</span>
            <div className="segmented">
              {meta.resolutions.map((r) => (
                <button key={r} className={run.resolution === r ? 'on' : ''} onClick={() => setRun({ ...run, resolution: r })}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="row-label">Motion detail</span>
            <div className="segmented">
              {[512, 768, 1376].map((m) => (
                <button key={m} className={run.motion === m ? 'on' : ''} onClick={() => setRun({ ...run, motion: m })}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          {run.motion > 512 && <p className="small pink">Larger motion references need much more GPU memory; on a 24 GB card 768 can slow each step to minutes.</p>}
          <div className="row">
            <span className="row-label">Clip length</span>
            <input className="mini" type="number" min={2.5} max={15} step={0.5} value={run.clipSeconds} onChange={(e) => setRun({ ...run, clipSeconds: Number(e.target.value) })} />
          </div>
          <div className="row">
            <span className="row-label">Mask edge</span>
            <div className="segmented">
              {['tight', 'normal', 'loose'].map((m) => (
                <button key={m} className={run.margin === m ? 'on' : ''} onClick={() => setRun({ ...run, margin: m })}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="row">
            <span className="row-label">Seed</span>
            <input className="mini" type="number" value={run.seed} onChange={(e) => setRun({ ...run, seed: Number(e.target.value) })} />
          </div>
          {mode !== 'object' && (
            <>
              <label className="me-snap small">
                <input type="checkbox" checked={run.noLipSync} onChange={(e) => setRun({ ...run, noLipSync: e.target.checked })} /> No lip-sync (the people don't talk or sing along)
              </label>
              <label className="me-snap small">
                <input type="checkbox" checked={run.hatFix} onChange={(e) => setRun({ ...run, hatFix: e.target.checked })} /> Hat fix (include hats in the mask)
              </label>
            </>
          )}
        </details>
      )}

      <div className="replace-go">
        {mode !== 'finish' && (
          <button className="btn btn-small" disabled={!video || !check?.ready || !!busy || (mode === 'object' && !obj.target)} onClick={() => go('mask')}>
            Check the mask
          </button>
        )}
        <button className="btn btn-primary" disabled={!can || !!busy} onClick={() => go('run')}>
          {busy ? `${busy}…` : mode === 'finish' ? (finish === 'faces' ? 'Fix the faces' : 'Fix the colours') : 'Replace'}
        </button>
      </div>

      {history.length > 0 && (
        <section className="block">
          <p className="mono label">Runs</p>
          <div className="char-clips">
            {history.map((j) => {
              const fin = j.outputs?.find((o) => o.kind === 'final')
              return (
                <div key={j.id} className="char-clip">
                  {fin ? (
                    <video className="char-video" src={fin.path ? fileUrl(fin.path) : media(fin.url)} controls preload="metadata" />
                  ) : (
                    <div className="char-pending mono small dim">{j.status === 'running' ? `Rendering${j.progress?.max ? ` ${Math.round((100 * j.progress.value) / j.progress.max)}%` : '…'}` : j.status === 'queued' ? `Queued${j.queuePosition ? ` · ${j.queuePosition}` : ''}` : j.error || j.status}</div>
                  )}
                  <div className="row-actions">
                    <span className="small">{j.projectName}</span>
                    {fin && (
                      <button className="link-btn mono" onClick={() => R.toEdit(fin, j.projectName).then(() => notify('Added to a new edit on the Edit page.', 'info'), (err) => notify(err.message))}>
                        To Edit
                      </button>
                    )}
                    {fin && (
                      <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(fin)}>
                        Show
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      <p className="small dim">
        Replace runs{' '}
        <button className="link-btn" onClick={() => window.ivstudio.links.open(meta.openjutsu.repo)}>
          OpenJutsu
        </button>
        's workflows ({meta.openjutsu.licence}). Only replace people with characters you made, or with someone's consent.
      </p>

      {editing && video && <MediaEditor item={video} hint="Keep the part to swap. Each H3 clip is up to 15 s; longer parts run as several clips." onApply={(v) => (setVideo(v), setEditing(false))} onClose={() => setEditing(false)} notify={notify} />}
    </div>
  )
}
