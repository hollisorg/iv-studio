import { useEffect, useState } from 'react'
import { media } from '../media'
import { Progress } from './Shot'
import Failure from './Failure'
import { FirstRenders } from './Speed'
import Stage from './Stage'
import { ToolShelf, ShelfTile, WorkflowNeeds } from './FlowKit'
import { fileUrl } from './edit/model'
import TileDelete from './TileDelete'
import './animalcam.css'
import { track } from '../renders'

// Animal Cam (src/service/animalcam.js): animal videos that look filmed on a phone, in seven steps. Each step saves as
// you go; the checklist on the last step points back at the step that controls each miss. The parts borrow the Music
// video and Keyframes editors' styles (studio.css .mv-*, .kf-*) plus .ac-*.
const DONE = ['success', 'error', 'cancelled']
const api = () => window.ivstudio.animalcam
const STEPS = [
  ['Your animal', 'Who it is, how big, what it wears'],
  ['The idea', 'One line, a genre, a length'],
  ['Who’s filming', 'The unseen person holding the phone'],
  ['Place and people', 'Where, a size anchor, everyone else'],
  ['What happens', 'The action, in timed beats'],
  ['Sound', 'Only these sounds'],
  ['Check and film', 'The checklist, then takes']
]
const SPECIES = [['cat', 'Cat'], ['dog', 'Dog'], ['rabbit', 'Rabbit'], ['hamster', 'Hamster'], ['parrot', 'Parrot'], ['horse', 'Horse'], ['pig', 'Pig'], ['goat', 'Goat'], ['duck', 'Duck'], ['other', 'Other']]
const SIZE = { cat: 30, dog: 50, rabbit: 20, hamster: 6, parrot: 30, horse: 160, pig: 60, goat: 70, duck: 35 }
const PITCH = { cat: 'a short low strained meow', dog: 'one short deep bark', rabbit: 'a soft short grunt', hamster: 'a tiny high squeak', parrot: 'one sharp loud squawk', horse: 'a short high whinny', pig: 'a low throaty grunt', goat: 'a short wavering bleat', duck: 'two short quacks' }
const STATES = [['dry', 'Dry'], ['soaked', 'Soaked'], ['muddy', 'Muddy'], ['snowy', 'Snowy'], ['dusty', 'Dusty']]
const GENRES = [
  ['gym', 'Gym and sport', 'A tiny animal against a load far too big for it.'],
  ['comedy', 'Everyday comedy', 'Played straight; people react a beat late; a deadpan ending.'],
  ['secret', 'Caught on camera', 'Filmed through a door gap; nobody looks at the lens.'],
  ['horror', 'Horror', 'Long true quiet, then one loud sound exactly at the scare.'],
  ['wholesome', 'Wholesome', 'A small warm moment that feels like it really happened.']
]
const DISTANCES = [
  ['close', 'Close', 'About 2 m away, no zoom. Home, street, kitchen.'],
  ['audience', 'Audience', 'Further back in a crowd. The only one that zooms, like a phone does.'],
  ['secret', 'Secret', 'Peeking from behind a door; the door edge soft in the foreground.']
]
const MOVES = [
  ['none', 'No special move', 'Just handheld drift. The safest choice.'],
  ['flinch', 'Flinch', 'A crash: the filmer flinches, the frame tilts, one correction.'],
  ['whip', 'Whip pan', 'A sound to one side: one fast pan, a slight overshoot.'],
  ['zoom', 'Phone zoom', 'The peak, seen from far away: the zoom snaps in.'],
  ['focus', 'Focus grab', 'Someone walks past the lens: focus jumps, then back.']
]
const LOADS = [['none', 'Nothing heavy'], ['light', 'Light for it'], ['heavy', 'Far too heavy']]
// The order a sheet's picture model is offered in (the first ready one is picked), from the sheet test of 2026-11-20
// (one pet photo, one sheet each, docs/animal-cam.md): Flux 3 Klein kept the cat and wore the outfit in every panel
// (40 s); ChatGPT Images kept the likeness but put the hat on the floor in one panel (40 s); Krea 2 drifted in eye
// colour and dropped a strap (4 min); Qwen Image failed on this PC's text encoder (GitHub #46). Flux.2 Klein untested.
const SHEET_ORDER = ['flux3', 'chatgpt', 'flux2', 'krea2', 'qwen21', 'h3image']
const pick = async (kind) => {
  const files = await window.ivstudio.files.pick(kind)
  return (Array.isArray(files) ? files : files ? [files] : []).map((f) => f.path || f)
}
const when = (t) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function AnimalCam(props) {
  const [open, setOpen] = useState(null)
  // Open it from the render hub's reveal (App's openTarget): this page with that one open
  useEffect(() => {
    const pick = (e) => e.detail?.page === 'animalcam' && e.detail.id && setOpen(e.detail.id)
    window.addEventListener('iv:open-item', pick)
    return () => window.removeEventListener('iv:open-item', pick)
  }, [])
  return open ? <Wizard key={open} id={open} back={() => setOpen(null)} {...props} /> : <List openOne={setOpen} {...props} />
}

function List({ openOne, notify, go }) {
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [making, setMaking] = useState(false)
  useEffect(() => {
    api().list().then(setList)
  }, [])
  async function create(genre) {
    setMaking(true)
    try {
      openOne((await api().create({ genre })).id)
    } catch (err) {
      notify(err.message)
    } finally {
      setMaking(false)
    }
  }
  const shown = (list || []).filter((x) => !q.trim() || `${x.name} ${x.animal}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="animalcam flow-page">
      <Stage effect="film" art="sequences" title="Animal Cam" kicker="Animal videos that look filmed on a phone" back={go && { label: 'Workflows', onClick: () => go('workflows') }}>
        <div className="stage-panel ac-new">
          <span className="stage-drop-text">Pick a genre to start:</span>
          <div className="ac-genre-row">
            {GENRES.map(([k, label]) => (
              <button key={k} className="btn btn-small" disabled={making} onClick={() => create(k)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <p className="stage-note small">Make it look like a stranger filmed it on a phone, not like a movie: one handheld take at real speed, real sounds, and someone nearby who doesn’t care. Seven steps, then H3 films it on this PC.</p>
        <WorkflowNeeds page="animalcam" />
      </Stage>
      <ToolShelf label="Your animal cams" count={shown.length} q={q} setQ={setQ} empty="None yet. Pick a genre above.">
        {shown.map((x) => (
          <ShelfTile
            key={x.id}
            onOpen={() => openOne(x.id)}
            media={x.cover ? <img src={fileUrl(x.cover)} alt="" /> : <span className="shelf-empty-art">{x.species}</span>}
            status={`${x.seconds} s · ${x.finished ? 'filmed' : 'in progress'}`}
            name={x.name}
            meta={[x.animal, when(x.updatedAt)].filter(Boolean)}
            del={<TileDelete name={x.name} notify={notify} onDelete={async () => (await api().remove(x.id), setList(await api().list()))} />}
          />
        ))}
      </ToolShelf>
    </div>
  )
}

// A text field that saves when it loses focus (only when it changed).
function Field({ label, value, onSave, rows = 0, placeholder = '', hint = null, type = 'text', wide = false }) {
  const v = value ?? ''
  const k = `${label}:${v}`
  const props = { defaultValue: v, placeholder, onBlur: (e) => e.target.value !== String(v) && onSave(type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value) }
  return (
    <label className={`ac-field ${wide ? 'wide' : ''}`}>
      <span className="mono small dim">{label}</span>
      {rows ? <textarea key={k} rows={rows} {...props} /> : <input key={k} type={type} step={type === 'number' ? 0.1 : undefined} {...props} />}
      {hint && <span className="small dim">{hint}</span>}
    </label>
  )
}
function Choice({ items, value, onPick, disabled }) {
  return (
    <div className="kf-joins ac-choices" role="radiogroup">
      {items.map(([k, label, about]) => (
        <button key={k} className={`kf-join ${value === k ? 'on' : ''}`} disabled={disabled} onClick={() => k !== value && onPick(k)} aria-pressed={value === k}>
          <strong>{label}</strong>
          {about && <span className="small dim">{about}</span>}
        </button>
      ))}
    </div>
  )
}
function Pills({ items, value, onPick, disabled }) {
  return (
    <div className="mv-shape ac-pills">
      {items.map(([k, label]) => (
        <button key={k} className={`mv-shape-btn ${value === k ? 'on' : ''}`} disabled={disabled} onClick={() => k !== value && onPick(k)} aria-pressed={value === k}>
          <span className="mono small">{label}</span>
        </button>
      ))}
    </div>
  )
}

function Wizard({ id, back, notify, jobs: live = {}, openEdit, characters = [] }) {
  const [v, setV] = useState(null)
  const [busy, setBusy] = useState('')
  const [step, setStep] = useState(0)
  const load = () =>
    api()
      .get(id)
      .then(setV)
      .catch((err) => notify(err.message))
  useEffect(() => {
    load()
  }, [id])
  const sheetsBusy = !!v?.sheets?.some((s) => !DONE.includes(s.status))
  const rendering = !!v?.state?.busy
  useEffect(() => {
    if (!rendering && !sheetsBusy) return
    const t = setInterval(load, 4000)
    return () => clearInterval(t)
  }, [rendering, sheetsBusy])
  const ours = [v?.state?.previews?.id, v?.state?.finish?.id].filter(Boolean)
  const doneKey = ours.map((j) => `${j}:${live[j]?.status || ''}`).join(',')
  useEffect(() => {
    if (ours.some((j) => DONE.includes(live[j]?.status))) load()
  }, [doneKey])

  async function run(label, fn) {
    setBusy(label)
    try {
      const r = await fn()
      if (r?.animal) setV(r)
      else await load()
      return r
    } catch (err) {
      notify(err.message)
    } finally {
      setBusy('')
    }
  }
  if (!v) return <div className="animalcam flow-page"><p className="dim">Loading…</p></div>
  const save = (patch) => run('save', () => api().save(id, patch))
  const part = (k) => (patch) => save({ [k]: patch })
  const missesAt = (i) => v.check.items.filter((x) => !x.ok && x.step === i).length
  const go = (i) => setStep(Math.max(0, Math.min(STEPS.length - 1, i)))
  const panels = [Animal, Idea, Filmer, Scene, Action, Sound, Film]
  const Panel = panels[step]

  return (
    <div className="animalcam mv-editor flow-page">
      <header className="mv-top">
        <div className="mv-back-row">
          <button className="link-btn mono small mv-back" onClick={back}>
            ← Animal Cam
          </button>
        </div>
        <div className="mv-title">
          <input className="ac-name" key={`name:${v.name}`} defaultValue={v.name} aria-label="Name" onBlur={(e) => e.target.value !== v.name && save({ name: e.target.value })} />
          <span className="mono small dim">
            {v.animal.name || 'Your animal'} · {GENRES.find((g) => g[0] === v.genre)?.[1]} · {v.seconds} s (H3 renders {v.real.toFixed(2)} s) · 9:16
          </span>
        </div>
        <div className="mv-progress">
          <span className="mv-progress-n">
            {v.check.items.length - v.check.misses}
            <span className="dim">/{v.check.items.length}</span>
          </span>
          <span className="mono small dim">checklist</span>
          <span className="mv-meter">
            <span style={{ width: `${(100 * (v.check.items.length - v.check.misses)) / Math.max(1, v.check.items.length)}%` }} />
          </span>
        </div>
      </header>

      <nav className="ac-steps" aria-label="Steps">
        {STEPS.map(([label], i) => (
          <button key={label} className={`ac-step ${i === step ? 'on' : ''}`} onClick={() => go(i)} aria-current={i === step ? 'step' : undefined}>
            <span className="ac-step-n mono">{i + 1}</span>
            <span className="ac-step-label">{label}</span>
            {missesAt(i) > 0 && <span className="ac-step-miss" title={`${missesAt(i)} to fix`}>{missesAt(i)}</span>}
          </button>
        ))}
      </nav>

      <section className="mv-card ac-panel">
        <div className="ac-panel-head">
          <h2 className="mv-h">
            {step + 1}. {STEPS[step][0]}
          </h2>
          <span className="small dim">{STEPS[step][1]}</span>
        </div>
        <Panel v={v} id={id} save={save} part={part} run={run} busy={busy} notify={notify} live={live} go={go} characters={characters} openEdit={openEdit} />
        <div className="ac-nav">
          <button className="btn btn-small" disabled={step === 0} onClick={() => go(step - 1)}>
            ← Back
          </button>
          {step < STEPS.length - 1 && (
            <button className="btn btn-small btn-primary" onClick={() => go(step + 1)}>
              Next: {STEPS[step + 1][0]} →
            </button>
          )}
        </div>
      </section>
    </div>
  )
}

// ---------- 1. Your animal ----------
function Animal({ v, id, save, part, run, busy, notify, characters }) {
  const a = v.animal
  const set = part('animal')
  const [families, setFamilies] = useState(null)
  const [model, setModel] = useState('')
  useEffect(() => {
    window.ivstudio.images
      .status()
      .then((st) => setFamilies(st?.families || []))
      .catch(() => setFamilies([]))
  }, [])
  const fromPhoto = !!a.photo
  const usable = (families || []).filter((f) => f.ready && (fromPhoto ? f.edit : true) && f.models?.length).sort((x, y) => (SHEET_ORDER.indexOf(x.id) + 99) % 99 - (SHEET_ORDER.indexOf(y.id) + 99) % 99)
  const options = usable.flatMap((f) => f.models.map((m) => [m, `${f.label} · ${String(m).split(/[\\/]/).pop()}`]))
  const chosen = options.some(([m]) => m === model) ? model : options[0]?.[0] || ''
  const lookable = characters.filter((c) => c.lora || c.refmod || c.picture)
  const sheetFiles = (v.sheets || []).flatMap((s) => s.files.map((f) => ({ f, set: s })))
  return (
    <div className="ac-step-body">
      <div className="ac-grid2">
        <Field label="Its name" value={a.name} placeholder="Shadow" onSave={(name) => set({ name })} />
        <label className="ac-field">
          <span className="mono small dim">Or use a character</span>
          <select value={a.characterId || ''} onChange={(e) => set({ characterId: e.target.value || null })}>
            <option value="">None: use a reference sheet</option>
            {lookable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.lora ? ' · H3 LoRA' : c.refmod ? ' · RefMod' : ' · picture'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Pills items={SPECIES} value={a.species} onPick={(species) => set({ species })} disabled={!!busy} />

      <div className="ac-sheet">
        <div className="ac-sheet-now">
          <span className="mono small dim">Reference sheet</span>
          {a.sheet ? <img src={fileUrl(a.sheet)} alt="The reference sheet" /> : <span className="ac-empty small dim">No sheet yet. A sheet with the face, the front with its outfit and the back keeps it the same in every frame.</span>}
          <div className="ac-row">
            <button className="link-btn mono small" onClick={async () => {
              const [f] = await pick('picture')
              if (f) run('sheet', () => api().setSheet(id, f))
            }}>
              Use a sheet I have
            </button>
            {a.sheet && (
              <button className="link-btn mono small" disabled={!!busy} onClick={() => run('character', () => api().saveCharacter(id)).then((r) => r && notify(`${r.animal.name || 'It'} is saved in Characters.`, 'info'))}>
                Save as a character
              </button>
            )}
          </div>
        </div>
        <div className="ac-sheet-make">
          <span className="mono small dim">Make one here</span>
          <div className="ac-row">
            {a.photo ? <img className="ac-photo" src={fileUrl(a.photo)} alt="Your animal’s photo" /> : null}
            <button className="btn btn-small" onClick={async () => {
              const [f] = await pick('picture')
              if (f) run('photo', () => api().setPhoto(id, f))
            }}>
              {a.photo ? 'Another photo' : 'A photo of your pet'}
            </button>
            {a.photo && (
              <button className="link-btn mono small" onClick={() => run('photo', () => api().setPhoto(id, null))}>
                Use words instead
              </button>
            )}
          </div>
          {!a.photo && <Field label="Or describe it" value={a.describe} rows={2} placeholder="A grey British Shorthair with copper eyes" onSave={(describe) => set({ describe })} />}
          <label className="ac-field">
            <span className="mono small dim">Picture model</span>
            <select value={chosen} onChange={(e) => setModel(e.target.value)} disabled={!options.length}>
              {!options.length && <option value="">{families ? (fromPhoto ? 'No picture model here can edit a photo' : 'No picture model is set up') : 'Looking…'}</option>}
              {options.map(([m, label]) => (
                <option key={m} value={m}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-small btn-primary" disabled={!!busy || !chosen || (!a.photo && !a.describe)} onClick={() => run('make', () => api().makeSheet(id, { model: chosen, count: 2 }))}>
            {busy === 'make' ? 'Starting…' : 'Make two sheets'}
          </button>
        </div>
      </div>
      {(v.sheets || []).some((s) => !DONE.includes(s.status)) && <p className="small dim">Making sheets…</p>}
      {(v.sheets || []).filter((s) => s.error).slice(-1).map((s) => <p key={s.id} className="small pink">{s.error}</p>)}
      {sheetFiles.length > 0 && (
        <div className="ac-sheets">
          {sheetFiles.map(({ f, set: s }) => (
            <button key={f} className="ac-sheet-pick" onClick={() => run('sheet', () => api().setSheet(id, f))} title={`${s.family}: use this one`}>
              <img src={fileUrl(f)} alt="" />
              <span className="mono small">Use this</span>
            </button>
          ))}
        </div>
      )}

      <div className="ac-grid2">
        <Field label="Everything it wears (comma between items)" value={a.outfit.join(', ')} placeholder="a straw hat, red suspenders, printed shorts" hint="Every item goes on the sheet too: anything not on the sheet drifts." onSave={(t) => set({ outfit: t.split(',').map((x) => x.trim()).filter(Boolean) })} />
        <Field label={`Real size in cm (${a.species === 'parrot' || a.species === 'duck' ? 'standing' : 'shoulder'} height)`} type="number" value={a.cm ?? ''} placeholder={SIZE[a.species] ? String(SIZE[a.species]) : ''} hint={SIZE[a.species] ? `Left empty: about ${SIZE[a.species]} cm.` : 'Give its real size.'} onSave={(cm) => set({ cm })} />
      </div>
      <span className="mono small dim">In this scene it is</span>
      <Pills items={STATES} value={a.state} onPick={(state) => set({ state })} disabled={!!busy} />
    </div>
  )
}

// ---------- 2. The idea ----------
function Idea({ v, id, save, run, busy }) {
  const [ideas, setIdeas] = useState([])
  return (
    <div className="ac-step-body">
      <Field label="The idea, in one line" value={v.idea} rows={2} placeholder="My cat does one heavy rep on a leg press" wide onSave={(idea) => save({ idea })} />
      <div className="ac-row">
        <button className="btn btn-small" disabled={!!busy} onClick={async () => {
          const r = await run('ideas', () => api().ideas(id))
          if (Array.isArray(r)) setIdeas(r)
        }}>
          {busy === 'ideas' ? 'Thinking…' : 'Spark some ideas'}
        </button>
        <span className="small dim">The prompt writer in Settings suggests a few for this genre.</span>
      </div>
      {ideas.length > 0 && (
        <div className="ac-ideas">
          {ideas.map((x) => (
            <button key={x} className="ac-idea" onClick={() => (save({ idea: x }), setIdeas([]))}>
              {x}
            </button>
          ))}
        </div>
      )}
      <span className="mono small dim">Genre (fills in the place and sound where they’re empty)</span>
      <Choice items={GENRES} value={v.genre} onPick={(genre) => save({ genre })} disabled={!!busy} />
      <span className="mono small dim">Length</span>
      <Pills items={[[5, '5 s'], [10, '10 s'], [15, '15 s']]} value={v.seconds} onPick={(seconds) => save({ seconds })} disabled={!!busy} />
    </div>
  )
}

// ---------- 3. Who’s filming ----------
function Filmer({ v, part, busy }) {
  const f = v.filmer
  const set = part('filmer')
  return (
    <div className="ac-step-body">
      <p className="small dim">Someone you never see is holding the phone. Decide who they are before anything happens.</p>
      <Choice items={DISTANCES} value={f.distance} onPick={(distance) => set({ distance })} disabled={!!busy} />
      <div className="ac-grid2">
        <Field label="Where the filmer stands" value={f.side} placeholder="on the machine’s right side" onSave={(side) => set({ side })} />
        <label className="ac-field">
          <span className="mono small dim">Which way the animal faces</span>
          <Pills items={[['frame left', 'Frame left'], ['frame right', 'Frame right'], ['the camera', 'The camera']]} value={f.facing} onPick={(facing) => set({ facing })} disabled={!!busy} />
        </label>
      </div>
      <span className="mono small dim">One special camera move, only with a reason in the scene</span>
      <Choice items={MOVES} value={f.move} onPick={(move) => set({ move })} disabled={!!busy} />
      {f.move !== 'none' && (
        <div className="ac-grid2">
          <Field label="What causes it" value={f.trigger} placeholder="a gym bag drops off the bench with a crash" onSave={(trigger) => set({ trigger })} />
          <Field label="At (seconds)" type="number" value={f.at ?? ''} placeholder={String(Math.round(v.real / 2))} onSave={(at) => set({ at })} />
        </div>
      )}
    </div>
  )
}

// ---------- 4. Place and people ----------
function Scene({ v, part, busy }) {
  const s = v.scene
  const set = part('scene')
  const extras = s.extras
  const setExtra = (i, patch) => set({ extras: extras.map((x, k) => (k === i ? { ...x, ...patch } : x)) })
  return (
    <div className="ac-step-body">
      <div className="ac-grid2">
        <Field label="The place" value={s.place} onSave={(place) => set({ place })} />
        <Field label="The floor" value={s.floor} onSave={(floor) => set({ floor })} />
        <Field label="The light" value={s.light} onSave={(light) => set({ light })} />
        <Field label="Time of day" value={s.time} onSave={(time) => set({ time })} />
      </div>
      <Field label="Size anchor: the animal against something in the shot" value={s.anchor} wide placeholder="the foot plate is wider than his whole body" hint="Without it the animal slowly grows or shrinks." onSave={(anchor) => set({ anchor })} />
      <span className="mono small dim">The people in the background: one task each, on one named thing (up to 3)</span>
      {extras.map((x, i) => (
        <div key={i} className="ac-extra">
          <Field label="Who" value={x.who} placeholder="a man in a grey T-shirt" onSave={(who) => setExtra(i, { who })} />
          <Field label="One task" value={x.task} placeholder="walks with both hands on the side rails" onSave={(task) => setExtra(i, { task })} />
          <Field label="On what" value={x.thing} placeholder="a treadmill" onSave={(thing) => setExtra(i, { thing })} />
          <button className="kf-pic-x ac-extra-x" onClick={() => set({ extras: extras.filter((_, k) => k !== i) })} aria-label={`Remove person ${i + 1}`}>
            ×
          </button>
        </div>
      ))}
      {extras.length < 3 && (
        <button className="link-btn mono small" disabled={!!busy} onClick={() => set({ extras: [...extras, { who: '', task: '', thing: '' }] })}>
          + A person in the background
        </button>
      )}
      <Field label="Someone who doesn’t care" value={s.bystander} wide placeholder="A woman by the water cooler keeps her eyes on her phone the whole time" hint="Every real clip has one." onSave={(bystander) => set({ bystander })} />
      <div className="ac-grid2">
        <Field label="Someone who notices late (optional)" value={s.reactor} placeholder="the woman at the rack freezes mid-curl, eyebrows up" onSave={(reactor) => set({ reactor })} />
        <Field label="At (seconds)" type="number" value={s.reactAt ?? ''} onSave={(reactAt) => set({ reactAt })} />
      </div>
    </div>
  )
}

// ---------- 5. What happens ----------
function Action({ v, id, part, run, busy }) {
  const a = v.action
  const set = part('action')
  const setBeat = part('beats')
  const feet = { parrot: 'feet', horse: 'hooves', pig: 'trotters', goat: 'hooves', duck: 'webbed feet' }[v.animal.species] || 'paws'
  return (
    <div className="ac-step-body">
      <Field label="What happens" value={a.what} rows={2} wide placeholder="one heavy rep on a 45-degree leg press" onSave={(what) => set({ what })} />
      <div className="ac-grid2">
        <Field label="The equipment and its parts" value={a.equipment} placeholder="a 45-degree leg press, two plates a side" onSave={(equipment) => set({ equipment })} />
        <Field label={`Where its ${feet} are`} value={a.paws} placeholder="hind paws flat on the foot plate, forepaws on the side handles" hint={`${feet.charAt(0).toUpperCase()}${feet.slice(1)} press and push. Write “grips” and H3 grows fingers.`} onSave={(paws) => set({ paws })} />
        <Field label="What the object does back" value={a.object} placeholder="the sled slides down its rails, the cushion dips" onSave={(object) => set({ object })} />
        <label className="ac-field">
          <span className="mono small dim">How heavy for it</span>
          <Pills items={LOADS} value={a.load} onPick={(load) => set({ load })} disabled={!!busy} />
        </label>
      </div>
      <div className="ac-row">
        <button className="btn btn-small btn-primary" disabled={!!busy} onClick={() => run('beats', () => api().draftBeats(id, { overwrite: false }))}>
          {busy === 'beats' ? 'Writing…' : 'Draft the beats'}
        </button>
        <button className="link-btn mono small" disabled={!!busy} onClick={() => run('beats', () => api().draftBeats(id, { overwrite: true }))}>
          Rewrite them all
        </button>
        <span className="small dim">The prompt writer in Settings fills the empty beats from steps 1 to 5. Write what is seen and heard, never what isn’t: H3 shows every thing you name.</span>
      </div>
      <div className="ac-beats">
        {v.beatTimes.map((b) => (
          <div key={b.key} className="ac-beat">
            <div className="ac-beat-head">
              <strong>{{ hook: 'Hook', build: 'Build', progress: 'Progress', check: 'Check', payoff: 'Payoff', ending: 'Ending' }[b.key]}</strong>
              <span className="mono small dim">
                {b.from.toFixed(1)}–{b.to.toFixed(1)} s
              </span>
            </div>
            {b.key === 'check' ? (
              <p className="small dim">IV Studio repeats the outfit, the size anchor and which way it faces here. Add anything else that must stay the same.</p>
            ) : null}
            <textarea rows={3} key={`${b.key}:${v.beats[b.key] || ''}`} defaultValue={v.beats[b.key] || ''} placeholder={BEAT_HINT[b.key]} onBlur={(e) => e.target.value !== (v.beats[b.key] || '') && setBeat({ [b.key]: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  )
}
const BEAT_HINT = {
  hook: 'A striking action with a sharp real sound, and where it’s looking.',
  build: 'Exact mechanics: where each paw is, what it presses, the effort starting.',
  progress: 'What the object or surface does back.',
  check: 'Optional: anything else that must stay the same.',
  payoff: 'The strongest moment, at normal speed.',
  ending: 'A lingering look, a late reaction, something still wobbling.'
}

// ---------- 6. Sound ----------
function Sound({ v, part, busy }) {
  const s = v.sound
  const set = part('sound')
  const pitch = PITCH[v.animal.species]
  return (
    <div className="ac-step-body">
      <p className="small dim">List the only sounds in the clip. H3 hears this as the whole soundtrack, with no music.</p>
      <div className="ac-grid2">
        <Field label="Hook sound (first 1.5 s)" value={s.hook} placeholder="a sharp metallic clack" onSave={(hook) => set({ hook })} />
        <Field label="At (seconds)" type="number" value={s.hookAt ?? ''} onSave={(hookAt) => set({ hookAt })} />
        <Field label="The place’s room tone" value={s.room} onSave={(room) => set({ room })} />
        <span />
        <Field label="Its sound, with kind and pitch" value={s.animal} placeholder={pitch || 'a short low grunt'} hint="The payoff opens its mouth as this peaks." onSave={(animal) => set({ animal })} />
        <Field label="Peaks at (seconds)" type="number" value={s.animalAt ?? ''} onSave={(animalAt) => set({ animalAt })} />
        <Field label="One random real sound" value={s.random} placeholder="a distant phone chime" hint="No story purpose. Everyone ignores it." onSave={(random) => set({ random })} />
        <Field label="At (seconds)" type="number" value={s.randomAt ?? ''} onSave={(randomAt) => set({ randomAt })} />
      </div>
      {pitch && !s.animal && (
        <button className="link-btn mono small" onClick={() => set({ animal: pitch })}>
          Use “{pitch}”
        </button>
      )}
      <Field label="Other sounds (one per line): footsteps, the equipment, the floor" value={s.more.join('\n')} rows={3} wide onSave={(t) => set({ more: t.split('\n').map((x) => x.trim()).filter(Boolean) })} />
      <label className="kf-check">
        <input type="checkbox" checked={s.breathing} disabled={!!busy} onChange={() => set({ breathing: !s.breathing })} />
        The filmer’s quiet breathing and the phone being handled
      </label>
    </div>
  )
}

// ---------- 7. Check and film ----------
function Film({ v, id, save, run, busy, notify, live, go, openEdit }) {
  const [showPrompt, setShowPrompt] = useState(false)
  const [picked, setPicked] = useState(1)
  const [broke, setBroke] = useState(null)
  const s = v.state
  const pj = s.previews && (live[s.previews.id] || s.previews)
  const fj = s.finish && (live[s.finish.id] || s.finish)
  const takes = pj?.outputs?.filter((o) => o.kind === 'preview') || []
  const misses = v.check.items.filter((x) => !x.ok)
  async function assemble() {
    const r = await run('assemble', () => api().assemble(id))
    if (!r) return
    notify(`It’s in Edit: ${r.seconds.toFixed(1)} s, vertical. Export it there.`, 'info')
    openEdit?.(r.editId)
  }
  return (
    <div className="ac-step-body">
      <ul className="ac-checklist">
        {v.check.items.map((x) => (
          <li key={x.key} className={x.ok ? 'ok' : 'miss'}>
            <span className="ac-tick" aria-hidden="true">{x.ok ? '✓' : '!'}</span>
            <span>
              {x.label}
              {!x.ok && (
                <>
                  <br />
                  <span className="small dim">{x.why} </span>
                  <button className="link-btn mono small" onClick={() => go(x.step)}>
                    Go to step {x.step + 1}
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <button className="link-btn mono small" onClick={() => setShowPrompt(!showPrompt)}>
        {showPrompt ? 'Hide' : 'Show'} the H3 prompt
      </button>
      {showPrompt && <pre className="ac-prompt">{v.check.prompt || 'The prompt needs your animal first (step 1).'}</pre>}
      <label className="kf-check">
        <input type="checkbox" checked={v.phone} disabled={!!busy} onChange={() => save({ phone: !v.phone })} />
        Phone finish: the edit gets a 1080×1920 file with a phone-like bit rate and a faint grain
      </label>
      <FirstRenders compact label="Takes" />
      <div className="ac-row">
        <button className="btn btn-primary" disabled={!!busy || s.busy || !!misses.length} onClick={() => run('hunt', () => track(api().hunt(id, {}), { open: { page: 'animalcam', id }, what: 'video' }))}>
          {s.busy ? 'Rendering…' : s.previews ? 'Hunt new takes' : 'Film it: hunt takes'}
        </button>
        {misses.length > 0 && (
          <button className="link-btn mono small" disabled={!!busy || s.busy} onClick={() => run('hunt', () => track(api().hunt(id, { anyway: true }), { open: { page: 'animalcam', id }, what: 'video' }))}>
            Film it anyway ({misses.length} to fix)
          </button>
        )}
        {s.changed && <span className="small pink">Changed since these takes.</span>}
      </div>
      <Progress job={pj} />
      <Progress job={fj} />
      {pj?.status === 'error' && <Failure job={pj} notify={notify} />}
      {fj?.status === 'error' && <Failure job={fj} notify={notify} />}
      {takes.length > 0 && !s.fresh && (
        <div className="mv-takes">
          <span className="mono small dim">Watch them like a stranger would. Pick the one that looks most real, then finish it.</span>
          <div className={`candidates n${takes.length} ac-takes`}>
            {takes.map((o) => (
              <figure key={o.candidate} className={`candidate ${picked === o.candidate ? 'on' : ''}`} onClick={() => setPicked(o.candidate)}>
                <video src={media(o.url)} controls loop preload="metadata" />
                <figcaption>
                  <span className="mono">#{o.candidate}</span>
                  <span className="mono small">{picked === o.candidate ? 'Picked' : 'Pick'}</span>
                </figcaption>
              </figure>
            ))}
          </div>
          <button className="btn btn-primary" disabled={!!busy || (fj && !DONE.includes(fj.status))} onClick={() => run('finish', () => track(api().finish(id, { candidate: picked }), { open: { page: 'animalcam', id }, what: 'video' }))}>
            {fj && !DONE.includes(fj.status) ? 'Finishing…' : `Finish take #${picked}`}
          </button>
        </div>
      )}
      {s.clip && (
        <div className="mv-final ac-final">
          <span className="mono small dim">{s.fresh ? 'Finished' : 'The last finish (changed since)'}</span>
          <video src={media(s.clip.url)} controls preload="metadata" />
          <div className="ac-row">
            <button className="btn btn-primary" disabled={!!busy || !s.fresh} onClick={assemble}>
              {busy === 'assemble' ? 'Making the edit…' : 'Make the edit →'}
            </button>
            {v.phoneFile && (
              <button className="link-btn mono small" onClick={() => window.ivstudio.files.reveal(v.phoneFile)}>
                Show the phone file
              </button>
            )}
          </div>
        </div>
      )}
      {(takes.length > 0 || s.clip) && (
        <div className="ac-broke">
          <span className="mono small dim">What broke? Change only the one thing that controls it, then hunt again.</span>
          <div className="ac-ideas">
            {FIXES.map((f) => (
              <button key={f.key} className={`ac-idea ${broke === f.key ? 'on' : ''}`} onClick={() => setBroke(broke === f.key ? null : f.key)}>
                {f.label}
              </button>
            ))}
          </div>
          {broke && (() => {
            const f = FIXES.find((x) => x.key === broke)
            return (
              <p className="small">
                {f.tip}{' '}
                <button className="link-btn mono small" onClick={() => go(f.step)}>
                  Go to step {f.step + 1}
                </button>
              </p>
            )
          })()}
        </div>
      )}
    </div>
  )
}
// the same list as animalcam.js FIXES (the window doesn't import service code)
const FIXES = [
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
