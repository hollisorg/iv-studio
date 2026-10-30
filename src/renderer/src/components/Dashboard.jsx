import { useEffect, useState } from 'react'
import { fileUrl } from './edit/model'
import Hero, { ART } from './Hero'
import { Tile, toSets, Viewer } from './MediaLibrary'

// The home page: start something in one click, pick up the latest renders, and the cast with their voices.
// Each quick-start card shows its page's own banner art.
const QUICK = [
  ['shot', 'New shot', 'An idea in plain words becomes H3 previews.', 'shots'],
  ['picture', 'New picture', 'Make or edit a picture on six image models.', 'library'],
  ['sequence', 'Longer scene', 'Several shots as one continuous video.', 'sequences'],
  ['edit', 'Cut an edit', 'Your renders, music and titles on a timeline.', 'edit'],
  ['music', 'New song', 'A song or a score, made on this PC.', 'music'],
  ['line', 'Voice line', "Words in a character's own voice.", 'lines'],
  ['sizzle', 'Website film', 'A web address becomes a promo film.', 'sizzle'],
  ['character', 'New character', 'Design and train a recurring actor.', 'characters']
]
const RECENT = 8

export default function Dashboard(ctx) {
  const { characters, start, startShotWith, go, notify } = ctx
  const [items, setItems] = useState(null)
  const [edits, setEdits] = useState([])
  const [voices, setVoices] = useState([])
  const [ready, setReady] = useState([])
  const [open, setOpen] = useState(null)
  useEffect(() => {
    window.ivstudio.library.all().then(setItems, (err) => (notify(err.message), setItems([])))
    window.ivstudio.edits.list().then(setEdits, () => {})
    window.ivstudio.voices.list().then(setVoices, () => {})
    window.ivstudio.characters.catalog().then(setReady, () => {})
  }, [])
  const sets = items ? toSets(items).slice(0, RECENT) : []
  const face = (c) => c.picture || ready.find((r) => r.id === c.id)?.picture
  const voiceOf = (c) => voices.find((v) => v.id === c.voiceId)

  return (
    <div className="dashboard">
      <Hero title="What if?" kicker="Infinite Variance Studio" />

      <section className="block">
        <p className="mono label">01 · Start something</p>
        <div className="quick-cards">
          {QUICK.map(([id, title, blurb, art]) => (
            <button key={id} className="quick-card" onClick={() => start(id)}>
              <span className="quick-art" style={ART[art] ? { backgroundImage: `url("${ART[art]}")` } : undefined} aria-hidden="true" />
              <span className="quick-text">
                <span className="quick-title">{title}</span>
                <span className="small dim">{blurb}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="dash-head">
          <p className="mono label">02 · Recent</p>
          <button className="link-btn mono" onClick={() => go('media')}>
            Everything in the Library →
          </button>
        </div>
        {items === null && <p className="dim mono">Loading…</p>}
        {items && sets.length === 0 && <p className="dim">Nothing made yet. Start with a shot or a picture above.</p>}
        <div className="lib-grid dash-recent">
          {sets.map((s, i) => (
            <Tile key={s.key} set={s} onOpen={() => setOpen([i, 0])} />
          ))}
        </div>
        {open && sets[open[0]] && <Viewer sets={sets} at={open} setAt={setOpen} onClose={() => setOpen(null)} edits={edits} {...ctx} />}
      </section>

      <section className="block">
        <div className="dash-head">
          <p className="mono label">03 · Your cast</p>
          <button className="link-btn mono" onClick={() => go('characters')}>
            All characters →
          </button>
        </div>
        {characters.length === 0 && <p className="dim">No characters yet. Download Tess or Theo, or train your own, on the Characters page.</p>}
        <div className="cast-cards">
          {characters.map((c) => {
            const v = voiceOf(c)
            return (
              <div key={c.id} className="cast-card">
                <div className="cast-face">{face(c) ? <img src={fileUrl(face(c))} alt="" /> : <span>{c.name.slice(0, 1)}</span>}</div>
                <div className="cast-body">
                  <span className="cast-name">{c.name}</span>
                  <span className="mono small dim">{v ? `Voice · ${v.name}` : 'No voice yet'}</span>
                  <div className="cast-actions">
                    <button className="btn btn-small btn-primary" onClick={() => startShotWith(c.id)}>
                      New shot
                    </button>
                    {v && (
                      <button className="btn btn-small" onClick={() => start('line')}>
                        Say a line
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
