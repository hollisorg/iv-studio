import { useEffect, useRef, useState } from 'react'
import Hero from './Hero'
import { ask } from './Confirm'
import { fileUrl } from './edit/model'

const M = () => window.ivstudio.music
const DONE = ['success', 'error', 'cancelled']
const ACTIVE_DL = ['queued', 'downloading', 'verifying']
const GB = (b) => `${(b / 1024 ** 3).toFixed(1)} GB`
const LENGTHS = [30, 60, 120, 180]
const LANGUAGES = [
  ['en', 'English'],
  ['es', 'Spanish'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ja', 'Japanese'],
  ['ko', 'Korean'],
  ['zh', 'Chinese'],
  ['ru', 'Russian'],
  ['unknown', 'Other']
]
const STYLE_EXAMPLE = 'Warm neo-soul, slow and loose. Live drums behind the beat, Rhodes chords, round bass. A soft female lead vocal, close and breathy. Late night, intimate.'
const LYRICS_EXAMPLE = '[Verse]\nLate night glow on the window pane\nCity hums and it calls my name\n\n[Chorus]\nStay right here, don\'t pull it straight\nI love the way we arrive late'
const blank = { name: '', caption: '', lyrics: '', instrumental: false, seconds: 60, seed: '', bpm: 120, key: 'C major', timesignature: '4', language: 'en' }

function state(s) {
  if (s.status === 'queued') return s.queuePosition ? `Waiting · ${s.queuePosition} in ComfyUI's queue` : 'Waiting'
  if (s.status === 'running') return s.progress?.max ? `Making it · ${Math.floor((s.progress.value / s.progress.max) * 100)}%` : 'Making it…'
  if (s.status === 'error') return 'Failed'
  if (s.status === 'cancelled') return 'Cancelled'
  return null
}

// The models an engine still needs, each with a Download button that uses IV Studio's checked downloads.
function NeededModels({ engine, dl, onDone }) {
  const ids = engine.missing.map((m) => m.id)
  const busy = ids.some((id) => ACTIVE_DL.includes(dl[id]?.status))
  const bytes = engine.missing.reduce((n, m) => n + (m.size || 0), 0)
  useEffect(() => {
    if (ids.length && ids.every((id) => dl[id]?.status === 'done')) onDone()
  }, [dl])
  return (
    <div className="music-needed">
      <p className="small">
        {engine.label} needs {engine.missing.length === 1 ? 'one model' : `${engine.missing.length} models`} first ({GB(bytes)}). They download into ComfyUI's models folder and are checked against the SHA-256 Hugging Face publishes.
      </p>
      {engine.missing.map((m) => {
        const s = dl[m.id]
        const pct = s?.total ? Math.floor((s.received / s.total) * 100) : null
        return (
          <div key={m.id} className="music-model">
            <span>{m.label}</span>
            <span className="mono dim">models/{m.folder}</span>
            {s && ACTIVE_DL.includes(s.status) ? (
              <div className="dl">
                <div className="bar">
                  <span style={{ width: `${pct ?? 6}%` }} className={pct == null ? 'indeterminate' : ''} />
                </div>
                <span className="mono dim">{s.status === 'queued' ? 'Queued' : s.status === 'verifying' ? 'Checking…' : `${pct}%`}</span>
              </div>
            ) : s?.status === 'error' ? (
              <span className="small pink">{s.error}</span>
            ) : s?.status === 'done' ? (
              <span className="mono cloud-ok">✓</span>
            ) : (
              <span className="mono dim">{GB(m.size)}</span>
            )}
          </div>
        )
      })}
      {engine.missingNodes?.length > 0 && <p className="small pink">This ComfyUI has no {engine.missingNodes.join(', ')} node. Update ComfyUI (0.33 or newer has it).</p>}
      <button className="btn btn-primary" disabled={busy} onClick={() => window.ivstudio.models.download(ids)}>
        {busy ? 'Downloading…' : `Download · ${GB(bytes)}`}
      </button>
    </div>
  )
}

function SongRow({ song, edits, notify, sendToCreate, openEdit, reuse, reload }) {
  const [name, setName] = useState(song.name)
  const [target, setTarget] = useState('')
  useEffect(() => setName(song.name), [song.name])
  const busy = state(song)
  async function rename() {
    if (name.trim() && name.trim() !== song.name) await M().rename(song.id, name.trim()).catch((err) => notify(err.message))
    reload()
  }
  async function toEdit() {
    try {
      const e = await M().toEdit(song.id, target || null)
      openEdit(e.id)
    } catch (err) {
      notify(err.message)
    }
  }
  async function remove() {
    const going = !DONE.includes(song.status)
    if (!(await ask({ title: `Delete “${song.name}”?`, message: going ? 'It is still being made: this stops it.' : 'Its file in the music folder goes too. The copy in ComfyUI\'s output folder stays.', confirm: 'Delete', danger: true }))) return
    await M().delete(song.id).catch((err) => notify(err.message))
    reload()
  }
  return (
    <div className="song-row">
      <div className="song-head">
        <input className="song-name" value={name} onChange={(e) => setName(e.target.value)} onBlur={rename} onKeyDown={(e) => e.key === 'Enter' && e.target.blur()} />
        <span className="mono small dim">
          {song.engine === 'minimax' ? 'MiniMax Music 3' : 'ACE-Step 1.5'} · {song.duration ? `${Math.round(song.duration)}s` : `${song.seconds}s`} · seed {song.seed}
          {song.instrumental ? ' · instrumental' : ''}
          {song.seconds_taken ? ` · made in ${song.seconds_taken}s` : ''}
        </span>
      </div>
      <p className="small dim song-style">{song.caption}</p>
      {song.status === 'success' && song.file ? (
        <audio controls preload="none" src={fileUrl(song.file)} />
      ) : (
        <p className={`mono small ${song.status === 'error' ? 'pink' : 'dim'}`}>
          {busy}
          {song.error ? `: ${song.error}` : ''}
        </p>
      )}
      <div className="line-actions song-actions">
        {song.status === 'success' && song.file && (
          <>
            <button className="btn btn-small btn-primary" onClick={() => sendToCreate({ kind: 'music', file: song.file, text: '', name: song.name })}>
              Use in a shot
            </button>
            <div className="song-edit">
              <select value={target} onChange={(e) => setTarget(e.target.value)} title="Which edit">
                <option value="">New edit</option>
                {edits.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" onClick={toEdit}>
                Add to edit
              </button>
            </div>
            <button className="link-btn mono" onClick={() => window.ivstudio.files.reveal(song.file)}>
              Show file
            </button>
          </>
        )}
        {!DONE.includes(song.status) && (
          <button className="link-btn mono" onClick={async () => (await M().cancel(song.id).catch((err) => notify(err.message)), reload())}>
            Stop
          </button>
        )}
        <button className="link-btn mono" onClick={() => reuse(song)}>
          Make another
        </button>
        <button className="link-btn mono" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  )
}

export function MusicPage({ notify, sendToCreate, openEdit }) {
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState(null)
  const [engine, setEngine] = useState('minimax')
  const [form, setForm] = useState(blank)
  const [songs, setSongs] = useState([])
  const [edits, setEdits] = useState([])
  const [dl, setDl] = useState({})
  const [busy, setBusy] = useState(false)
  const top = useRef(null)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const check = () => M().status().then(setStatus, (err) => setStatus({ error: err.message, engines: [] }))
  const reload = () => M().list().then(setSongs, (err) => notify(err.message))
  useEffect(() => {
    M().meta().then(setMeta)
    check()
    reload()
    window.ivstudio.edits.list().then(setEdits, () => {})
    window.ivstudio.models.status().then(setDl)
    return window.ivstudio.models.onUpdate((u) => setDl((all) => ({ ...all, [u.id]: u })))
  }, [])
  // while a song is being made, keep its state fresh
  const making = songs.some((s) => !DONE.includes(s.status))
  useEffect(() => {
    if (!making) return
    const t = setInterval(reload, 3000)
    return () => clearInterval(t)
  }, [making])

  const spec = status?.engines?.find((e) => e.id === engine)
  const max = meta?.engines.find((e) => e.id === engine)?.maxSeconds || 300
  async function make() {
    setBusy(true)
    try {
      await M().create({ engine, ...form, seconds: Number(form.seconds), seed: form.seed === '' ? null : Number(form.seed), bpm: Number(form.bpm) })
      set({ seed: '' })
      reload()
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy(false)
    }
  }
  function reuse(s) {
    setEngine(s.engine)
    setForm({ ...blank, name: s.name, caption: s.caption, lyrics: s.lyrics, instrumental: s.instrumental, seconds: s.seconds, bpm: s.bpm ?? 120, key: s.key || 'C major', timesignature: s.timesignature || '4', language: s.language || 'en' })
    top.current?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <div className="voices music" ref={top}>
      <Hero art="music" title="Music" kicker="Audio" />
      <p className="lede">
        Songs and scores, made on this PC.
        <span className="lede-small dim">Describe the music, add lyrics or keep it instrumental, and use the result under an edit or as the song a character sings in a shot. Every song is kept here.</span>
      </p>
      {status?.remote && <p className="notice">Music runs on this PC's ComfyUI. Switch to "This PC" in Settings to make music.</p>}
      {status?.error && <p className="notice">{status.error}</p>}

      <section className="group">
        <div className="group-head">
          <h2>New song</h2>
        </div>
        <div className="group-body">
          <div className="row">
            <span className="row-label">Engine</span>
            <div className="segmented">
              {(meta?.engines || []).map((e) => (
                <button key={e.id} className={engine === e.id ? 'on' : ''} onClick={() => (setEngine(e.id), form.seconds > e.maxSeconds && set({ seconds: e.maxSeconds }))}>
                  {e.label} <span className="dim">· {e.short}</span>
                </button>
              ))}
            </div>
          </div>
          {spec && (
            <p className="dim small seed-note">
              {spec.note} <span className="music-licence">{spec.licence}</span>
            </p>
          )}
          {spec && !spec.ready && !status?.remote && <NeededModels engine={spec} dl={dl} onDone={check} />}

          <div className="row">
            <span className="row-label">Name</span>
            <input value={form.name} placeholder="Optional. The style's first words otherwise." onChange={(e) => set({ name: e.target.value })} />
          </div>
          <label className="music-field">
            <span className="mono label">Style</span>
            <textarea rows={3} value={form.caption} placeholder={STYLE_EXAMPLE} onChange={(e) => set({ caption: e.target.value })} />
            <span className="dim small">Genre, mood, instruments, the voice and how it sings, tempo, how the song builds.</span>
          </label>
          <label className="consent">
            <input type="checkbox" checked={form.instrumental} onChange={(e) => set({ instrumental: e.target.checked })} />
            <span>Instrumental, no singing</span>
          </label>
          {!form.instrumental && (
            <label className="music-field">
              <span className="mono label">Lyrics</span>
              <textarea rows={8} value={form.lyrics} placeholder={LYRICS_EXAMPLE} onChange={(e) => set({ lyrics: e.target.value })} />
              <span className="dim small">Mark the parts: [Intro], [Verse], [Chorus], [Bridge], [Instrumental], [Outro]. Empty lyrics make an instrumental.</span>
            </label>
          )}
          <div className="row">
            <span className="row-label">Length</span>
            <div className="music-length">
              <div className="segmented">
                {LENGTHS.filter((n) => n <= max).map((n) => (
                  <button key={n} className={Number(form.seconds) === n ? 'on' : ''} onClick={() => set({ seconds: n })}>
                    {n < 60 ? `${n}s` : `${n / 60} min`}
                  </button>
                ))}
              </div>
              <input className="mini" type="number" min={5} max={max} value={form.seconds} onChange={(e) => set({ seconds: e.target.value })} />
              <span className="dim small">seconds, up to {max}</span>
            </div>
          </div>
          {engine === 'minimax' && <p className="dim small seed-note">MiniMax sets the length from the lyrics and treats this as a limit: two short sections give a song of about 15 seconds. Write more verses and choruses for a longer one.</p>}
          {engine === 'ace' && (
            <>
              <div className="row">
                <span className="row-label">Tempo</span>
                <div className="music-length">
                  <input className="mini" type="number" min={30} max={300} value={form.bpm} onChange={(e) => set({ bpm: e.target.value })} />
                  <span className="dim small">BPM</span>
                </div>
              </div>
              <div className="row">
                <span className="row-label">Key</span>
                <div className="music-length">
                  <select value={form.key} onChange={(e) => set({ key: e.target.value })}>
                    {(meta?.keys || []).map((k) => (
                      <option key={k}>{k}</option>
                    ))}
                  </select>
                  <div className="segmented">
                    {['2', '3', '4', '6'].map((n) => (
                      <button key={n} className={form.timesignature === n ? 'on' : ''} onClick={() => set({ timesignature: n })}>
                        {n}/4
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="row">
                <span className="row-label">Language</span>
                <select value={form.language} onChange={(e) => set({ language: e.target.value })}>
                  {LANGUAGES.map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="row">
            <span className="row-label">Seed</span>
            <input className="mini seed-input" type="number" value={form.seed} placeholder="Random" onChange={(e) => set({ seed: e.target.value })} />
          </div>
          <p className="dim small seed-note">The same settings and seed give the same song; a new seed gives a new take.</p>
          <button className="btn btn-primary" disabled={busy || !spec?.ready || !form.caption.trim()} onClick={make}>
            {busy ? 'Queuing…' : 'Make it'}
          </button>
        </div>
      </section>

      {songs.length > 0 && (
        <section className="group">
          <div className="group-head">
            <h2>Songs</h2>
            <p className="dim small">Newest first. Kept in IV Studio's music folder.</p>
          </div>
          <div className="group-body">
            <div className="line-list">
              {songs.map((s) => (
                <SongRow key={s.id} song={s} edits={edits} notify={notify} sendToCreate={sendToCreate} openEdit={openEdit} reuse={reuse} reload={reload} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
