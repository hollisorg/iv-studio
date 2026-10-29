import { useEffect, useState } from 'react'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { fileUrl } from './edit/model'

// Website sizzle: a web address in, a promo film out. IV Studio captures the site; your agent writes the
// storyboard from it; you approve it; IV Studio makes the H3 shots, pictures, music and voice-over on this
// PC; then your agent cuts the film in Shinobi with the site's own screens, colours and fonts.
const Z = () => window.ivstudio.sizzle
const KIND = { h3: 'H3 shot', image: 'Picture', screen: 'Site screen', title: 'Title' }
// An H3 prompt's shot description, without its field labels and sound fields.
const shotText = (p) => String(p || '').replace(/^\s*integrated_multimodal_description:\s*/i, '').split(/\n\s*overall_soundscape:/i)[0].replace(/\s*There is no writing anywhere in the picture\.?/i, '')
const STATUS = { planning: 'Storyboard', approved: 'Approved', rendering: 'Making the pieces', ready: 'Pieces ready', editing: 'Editing in Shinobi' }

function agentMessage(s) {
  if (!s.plan)
    return `Make a sizzle video for ${s.url} with IV Studio's Website sizzle workflow (sizzle id ${s.id}).

1. Call get_guide and read "Website sizzle".
2. Look at the capture: get_sizzle, then view_sizzle_capture for any screen you might use.
3. Write a storyboard with save_sizzle_plan: about 20-40 s, a hook, the site's real screens, H3 shots and pictures that fit its look, titles from its own copy, music, and an end card with the logo and the web address.
4. Show me the storyboard and wait for my OK before anything renders.`
  if (s.status === 'ready' || s.status === 'editing')
    return `The pieces for the ${s.name} sizzle (sizzle id ${s.id}) are ready. Call sizzle_to_shinobi, read its brief, then cut the film with the shinobi tools: read_guide (agent, timeline, effects) first, preview it before rendering, render with start_render and check the result. Tell me when it's ready.`
  return `Carry on with the ${s.name} sizzle (sizzle id ${s.id}): get_sizzle shows where it is.`
}

export function SizzleList({ notify, openSizzle }) {
  const [list, setList] = useState(null)
  const [url, setUrl] = useState('')
  const [format, setFormat] = useState('16:9')
  const [busy, setBusy] = useState(null)
  useEffect(() => {
    Z().list().then(setList)
    return Z().onLog((line) => setBusy(line))
  }, [])
  async function capture() {
    setBusy('Opening the site…')
    try {
      openSizzle((await Z().create({ url: url.trim(), format })).id)
    } catch (err) {
      notify(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(null)
    }
  }
  return (
    <div className="sizzle">
      <Hero title="Sizzle" kicker="A website, made into a film" />
      <p className="lede">
        Put in a web address and get a promo film.
        <span className="lede-small dim">IV Studio captures the site as people see it. Your agent writes a storyboard from it, you approve it, and the H3 shots, pictures, music and voice-over are made on this PC. Then your agent cuts it in Shinobi with the site's own screens, colours and fonts.</span>
      </p>
      <div className="sizzle-start">
        <input value={url} placeholder="https://your-site.com" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && !busy && capture()} />
        <div className="segmented ed-seg">
          {['16:9', '9:16', '1:1'].map((f) => (
            <button key={f} className={format === f ? 'on' : ''} onClick={() => setFormat(f)}>
              {f}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" disabled={!url.trim() || !!busy} onClick={capture}>
          Capture the site
        </button>
      </div>
      {busy && <p className="mono small dim">{busy}</p>}
      <div className="tiles">
        {list?.map((s) => (
          <div key={s.id} className="tile-wrap">
            <button className="tile" onClick={() => openSizzle(s.id)}>
              <div className="tile-media">{s.final ? <video src={`${fileUrl(s.final)}#t=1`} muted preload="metadata" /> : s.cover && <img src={fileUrl(s.cover)} alt="" />}</div>
              <div className="tile-body">
                <span className="tile-name">{s.name}</span>
                <span className="mono dim small">
                  {STATUS[s.status] || s.status} · {s.scenes} scene{s.scenes === 1 ? '' : 's'}
                </span>
                <span className="mono dim small">{new URL(s.url).hostname}</span>
              </div>
            </button>
            <TileDelete name={s.name} keeps="Its renders, song and Shinobi film stay." notify={notify} onDelete={async () => (await Z().delete(s.id), setList(await Z().list()))} />
          </div>
        ))}
      </div>
    </div>
  )
}

function Piece({ sc }) {
  if (sc.kind === 'title') return <div className="sz-title">{sc.text}</div>
  if (!sc.file) return <div className="sz-wait mono small">{sc.status === 'waiting' ? '' : sc.status}</div>
  if (/\.(mp4|webm|mov)$/i.test(sc.file)) return <video src={`${fileUrl(sc.file)}#t=0.5`} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.target.play().catch(() => {})} onMouseLeave={(e) => e.target.pause()} />
  return <img src={fileUrl(sc.file)} alt="" />
}

export function SizzleProject({ sizzleId, notify, go, openShinobi }) {
  const [s, setS] = useState(null)
  const [busy, setBusy] = useState(null)
  const [copied, setCopied] = useState(false)
  const load = () => Z().get(sizzleId).then(setS, (err) => notify(err.message))
  useEffect(() => {
    load()
    return Z().onLog((line) => setBusy(line))
  }, [sizzleId])
  // while pieces are being made (or an agent is working on it), keep it current
  useEffect(() => {
    const h = setInterval(load, s?.status === 'rendering' ? 8000 : 20000)
    return () => clearInterval(h)
  }, [s?.status])
  async function act(label, fn) {
    setBusy(label)
    try {
      setS(await fn())
      if (label.startsWith('Sending')) await load()
    } catch (err) {
      notify(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(null)
    }
  }
  if (!s) return null
  const site = s.site
  const screens = site.captures.filter((c) => c.name === 'hero' || c.name.startsWith('screen-'))
  const capture = (n) => site.captures.find((c) => c.name === n)
  const msg = agentMessage(s)
  const made = s.scenes.filter((x) => x.kind === 'h3' || x.kind === 'image')
  const done = made.filter((x) => x.status === 'success').length

  return (
    <div className="sizzle">
      <Hero title={s.name} kicker="Website sizzle" />
      <button className="link-btn mono" onClick={() => go('sizzle')}>
        ← All sizzles
      </button>
      <p className="mono small dim sz-status">
        {STATUS[s.status] || s.status} · {s.url} · {s.format}
        {busy && ` · ${busy}…`}
      </p>

      <section className="block">
        <p className="mono label">01 · The site, as captured</p>
        <div className="sz-site">
          <img className="sz-hero" src={fileUrl(capture('hero').file)} alt="The top of the page" />
          <div className="sz-kit">
            <h3>{site.title}</h3>
            {site.description && <p className="small dim">{site.description}</p>}
            <div className="sz-swatches">
              {site.colors.map((c) => (
                <span key={c} className="sz-swatch" style={{ background: c }} title={c}>
                  <span className="mono">{c}</span>
                </span>
              ))}
            </div>
            <p className="mono small dim">Fonts: {site.fonts.join(', ')}</p>
            {capture('logo') && <img className="sz-logo" src={fileUrl(capture('logo').file)} alt="Logo" />}
          </div>
        </div>
        <div className="sz-strip">
          {[...screens, capture('mobile')].filter(Boolean).map((c) => (
            <figure key={c.name}>
              <img src={fileUrl(c.file)} alt={c.what} />
              <figcaption className="mono small dim">{c.name}</figcaption>
            </figure>
          ))}
          {site.images.map((im, k) => (
            <figure key={im.file}>
              <img src={fileUrl(im.file)} alt={im.alt} />
              <figcaption className="mono small dim">image-{k + 1}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="block">
        <p className="mono label">02 · Storyboard{s.plan && ` · ${s.plan.seconds} s`}</p>
        {!s.plan && <p className="small dim">Your agent writes it from the capture. Paste the message below into Claude Code, Codex or another agent connected to IV Studio (Settings → Agents).</p>}
        {s.plan && (
          <>
            <div className="sz-scenes">
              {s.scenes.map((sc, k) => (
                <div key={sc.id} className={`sz-scene ${sc.status}`}>
                  <div className="sz-media">
                    <Piece sc={sc} />
                  </div>
                  <div className="sz-text">
                    <span className="mono small">
                      {k + 1} · {KIND[sc.kind]} · {sc.seconds} s{(sc.kind === 'h3' || sc.kind === 'image') && s.status !== 'planning' && s.status !== 'approved' ? ` · ${sc.status}` : ''}
                    </span>
                    <span className="small">{sc.kind === 'title' ? `"${sc.text}"` : sc.kind === 'screen' ? sc.capture : sc.kind === 'h3' ? shotText(sc.prompt) : sc.prompt}</span>
                    {sc.note && <span className="small dim">{sc.note}</span>}
                    {sc.error && <span className="small error-text">{sc.error}</span>}
                  </div>
                </div>
              ))}
            </div>
            <p className="small">
              <span className="mono pink">Music</span> {s.plan.music.caption} <span className="dim">({s.plan.music.engine === 'ace' ? 'ACE-Step' : 'MiniMax Music 3'}{s.assets.music ? ` · ${s.assets.music.status}` : ''})</span>
            </p>
            {s.plan.voiceover && (
              <p className="small">
                <span className="mono pink">Voice-over</span> {s.plan.voiceover.lines.map((l) => `"${l}"`).join(' ')}
              </p>
            )}
            {s.plan.notes && <p className="small dim">{s.plan.notes}</p>}
            <div className="row-actions">
              {s.status === 'planning' && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Approving', () => Z().approve(s.id).then(() => Z().get(s.id)))}>
                  Approve storyboard
                </button>
              )}
              {s.status === 'approved' && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Starting the renders', () => Z().makeAssets(s.id))}>
                  Make the pieces
                </button>
              )}
              {s.status === 'rendering' && (
                <span className="mono small dim">
                  {done} of {made.length} made · music {s.assets.music?.status || 'waiting'} · H3 shots take 3-5 min each
                </span>
              )}
              {s.status === 'ready' && (
                <button className="btn btn-primary" disabled={!!busy} onClick={() => act('Sending to Shinobi', () => Z().toShinobi(s.id))}>
                  Send to Shinobi
                </button>
              )}
              {s.shinobi && (
                <button className="btn btn-small" onClick={() => openShinobi(s.shinobi.projectId)}>
                  Open in Shinobi
                </button>
              )}
            </div>
          </>
        )}
      </section>

      <section className="block">
        <p className="mono label">03 · {s.final ? 'The film' : 'Your agent'}</p>
        {s.final && <video className="sz-final" src={fileUrl(s.final)} controls playsInline />}
        <pre className="code shinobi-brief">{msg}</pre>
        <button className="btn btn-small" onClick={() => navigator.clipboard.writeText(msg).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
          {copied ? 'Copied' : 'Copy message'}
        </button>
      </section>
    </div>
  )
}
