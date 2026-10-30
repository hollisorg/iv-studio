import { useEffect, useMemo, useRef, useState } from 'react'
import Hero from './Hero'
import { fileUrl } from './edit/model'

// LoRAs as pictures: Civitai's H3 LoRAs (Discover) and the ones on this PC (Yours), with clips that play on
// hover. LoraPicker is the same thing in a dialog, for Create's LoRA tray and for Characters.
const L = () => window.ivstudio.loras
const MB = (b) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${Math.round(b / 1024 ** 2)} MB`)
const K = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))
export const loraTitle = (name) => String(name).split(/[\\/]/).pop().replace(/\.safetensors$/i, '').replace(/[_]+/g, ' ')
const folderOf = (name) => {
  const parts = String(name).split(/[\\/]/)
  return parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Top level'
}

// Whether mature previews show without the blur: Settings -> Civitai, only after the 18+ opt-in.
let unblurred = false
const unblurWatchers = new Set()
export function setUnblurred(on) {
  unblurred = !!on
  unblurWatchers.forEach((f) => f(unblurred))
}
window.ivstudio?.settings
  .get()
  .then((s) => setUnblurred(s.civitaiMature && s.civitaiUnblur))
  .catch(() => {})
function useUnblurred() {
  const [on, setOn] = useState(unblurred)
  useEffect(() => {
    unblurWatchers.add(setOn)
    return () => unblurWatchers.delete(setOn)
  }, [])
  return on
}

// A clip or picture that plays on hover. Mature previews stay blurred until clicked, unless the person
// chose to see them unblurred.
export function LoraThumb({ preview, label, mature = false, className = '' }) {
  const [clicked, setShown] = useState(false)
  const unblur = useUnblurred()
  const shown = !mature || clicked || unblur
  const ref = useRef(null)
  const src = preview?.url || (preview?.file ? fileUrl(preview.file) : null)
  if (!src)
    return (
      <div className={`lora-thumb empty ${className}`}>
        <span>{String(label || '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 2) || '?'}</span>
      </div>
    )
  return (
    <div
      className={`lora-thumb ${shown ? '' : 'veiled'} ${className}`}
      onMouseEnter={() => shown && ref.current?.play?.().catch(() => {})}
      onMouseLeave={() => ref.current?.pause?.()}
      onClick={(e) => {
        if (!shown) {
          e.stopPropagation()
          setShown(true)
        }
      }}
    >
      {preview.type === 'video' ? <video ref={ref} src={src} muted loop playsInline preload="metadata" /> : <img src={src} alt="" loading="lazy" />}
      {!shown && <span className="lora-veil mono">Mature · click to show</span>}
    </div>
  )
}

function useProgress() {
  const [dl, setDl] = useState({})
  useEffect(() => {
    L().downloads().then(setDl, () => {})
    return L().onProgress((u) => setDl((all) => ({ ...all, [u.versionId]: u })))
  }, [])
  return dl
}

// ---------- Discover: Civitai ----------
function Discover({ meta, onOpen, compact = false }) {
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState('Most Downloaded')
  const [items, setItems] = useState([])
  const [next, setNext] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const typed = useRef(null)
  async function load(more = false) {
    setBusy(true)
    setError(null)
    try {
      const page = await L().search({ query, tag, sort, cursor: more ? next : null, limit: compact ? 18 : 24 })
      setItems((x) => (more ? [...x, ...page.items] : page.items))
      setNext(page.next)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    clearTimeout(typed.current)
    typed.current = setTimeout(() => load(false), query ? 450 : 0)
    return () => clearTimeout(typed.current)
  }, [query, tag, sort])
  return (
    <div className="lora-discover">
      <div className="lora-bar">
        <input className="lora-search" value={query} placeholder="Search H3 LoRAs: cinematic, anime, POV, turbo…" onChange={(e) => setQuery(e.target.value)} />
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          {(meta?.sorts || []).map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <div className="lora-tags">
        {(meta?.tags || []).map(([id, label]) => (
          <button key={id || 'all'} className={`lora-tag ${tag === id ? 'on' : ''}`} onClick={() => setTag(id)}>
            {label}
          </button>
        ))}
        {meta?.mature && <span className="mono small pink lora-mode">Mature on · civitai.red</span>}
      </div>
      {error && <p className="notice">{error}</p>}
      <div className={`lora-grid ${compact ? 'compact' : ''}`}>
        {items.map((m) => (
          <button key={m.id} className={`lora-card ${m.installed ? 'installed' : ''}`} onClick={() => onOpen(m)}>
            <LoraThumb preview={m.previews[0]} label={m.name} mature={m.mature || m.previews[0]?.mature} />
            <span className="lora-card-body">
              <span className="lora-name">{m.name}</span>
              <span className="mono small dim">
                {[m.file && MB(m.file.size), `${K(m.downloads)} downloads`, m.creator].filter(Boolean).join(' · ')}
              </span>
            </span>
            {m.installed && <span className="lora-badge mono">Installed</span>}
          </button>
        ))}
      </div>
      {!busy && !error && items.length === 0 && <p className="dim">Nothing matches. Try another word or tag.</p>}
      <div className="lora-more">{busy ? <span className="mono dim">Loading…</span> : next && <button className="btn btn-small" onClick={() => load(true)}>Show more</button>}</div>
      <p className="small dim">From Civitai. Each LoRA keeps its maker's licence, shown before you download. LoRAs of real people aren't shown.</p>
    </div>
  )
}

// One Civitai LoRA: its clips, trigger words, licence and notes, with Download and Use.
function Details({ id, meta, onClose, onUse, go }) {
  const [m, setM] = useState(null)
  const [error, setError] = useState(null)
  const [version, setVersion] = useState(null)
  const [busy, setBusy] = useState(false)
  const dl = useProgress()
  useEffect(() => {
    L()
      .model(id)
      .then((x) => (setM(x), setVersion(x.versions[0]?.id || null)), (err) => setError(err.message))
  }, [id])
  const v = m?.versions.find((x) => x.id === version)
  const state = v ? dl[v.id] : null
  async function download() {
    setBusy(true)
    try {
      const r = await L().download({ modelId: m.id, versionId: v.id })
      setM((x) => ({ ...x, versions: x.versions.map((y) => (y.id === v.id ? { ...y, installed: true, lora: r.lora } : y)) }))
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }
  const pct = state?.total ? Math.floor((state.received / state.total) * 100) : 0
  const installedName = v?.lora || state?.lora
  return (
    <div className="lora-details">
      <div className="lora-details-head">
        <span className="mono small dim">Civitai</span>
        <button className="link-btn mono" onClick={onClose}>
          Close ×
        </button>
      </div>
      {error && <p className="small pink">{error}</p>}
      {!m && !error && <p className="mono dim">Loading…</p>}
      {m && (
        <>
          <h2 className="lora-details-title">{m.name}</h2>
          <p className="mono small dim">
            {m.creator ? `by ${m.creator} · ` : ''}
            {K(m.downloads)} downloads · {K(m.likes)} likes
          </p>
          <div className="lora-gallery">
            {(v?.previews.length ? v.previews : m.previews).map((p, i) => (
              <LoraThumb key={i} preview={p} label={m.name} mature={p.mature} />
            ))}
          </div>
          {m.versions.length > 1 && (
            <div className="row tight">
              <span className="row-label">Version</span>
              <select value={version || ''} onChange={(e) => setVersion(Number(e.target.value))}>
                {m.versions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {x.installed ? ' · installed' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {v?.trainedWords.length > 0 && (
            <div className="lora-words">
              <span className="mono small dim">Trigger words</span>
              {v.trainedWords.map((w) => (
                <span key={w} className="lora-word mono">
                  {w}
                </span>
              ))}
            </div>
          )}
          <div className="lora-licence">
            <span className={`lora-pill ${m.licence.commercial ? 'ok' : 'warn'}`}>{m.licence.commercial ? 'Commercial use allowed' : 'Not for commercial use'}</span>
            {m.licence.creditNeeded && <span className="lora-pill">Credit the maker</span>}
            {v?.file && <span className="lora-pill">SHA-256 checked</span>}
          </div>
          {v?.file && (
            <div className="lora-actions">
              {v.installed || installedName ? (
                <>
                  <span className="mono small cloud-ok">● Installed</span>
                  {onUse && installedName && (
                    <button className="btn btn-primary" onClick={() => onUse({ name: installedName, words: v.trainedWords, title: m.name })}>
                      Use in a shot
                    </button>
                  )}
                </>
              ) : state && ['downloading', 'verifying'].includes(state.status) ? (
                <div className="dl">
                  <div className="bar">
                    <span style={{ width: `${pct}%` }} />
                  </div>
                  <span className="mono dim">{state.status === 'verifying' ? 'Checking…' : `${pct}% of ${MB(state.total)}`}</span>
                </div>
              ) : meta?.hasKey ? (
                <button className="btn btn-primary" disabled={busy} onClick={download}>
                  Download · {MB(v.file.size)}
                </button>
              ) : (
                <p className="small">
                  Downloading needs your own free Civitai API key.{' '}
                  {go ? (
                    <button className="link-btn" onClick={() => go('settings')}>
                      Add it in Settings
                    </button>
                  ) : (
                    'Add it in Settings → Civitai.'
                  )}
                </p>
              )}
            </div>
          )}
          {(v?.notes || m.description) && <p className="lora-desc small">{v?.notes || m.description}</p>}
          <button className="link-btn mono small" onClick={() => window.ivstudio.links.open(m.url)}>
            Open on Civitai ↗
          </button>
        </>
      )}
    </div>
  )
}

// ---------- Yours: the LoRAs on this PC ----------
export function useYours() {
  const [items, setItems] = useState(null)
  const reload = () => L().yours().then(setItems, () => setItems([]))
  useEffect(() => {
    reload()
  }, [])
  return [items, setItems, reload]
}

// family: { label, test(name) } narrows the list to one image family's LoRAs (Create -> Image) instead of H3's.
function Yours({ items, setItems, onPick, onOpenCivitai, compact = false, notify, family = null }) {
  const [all, setAll] = useState(false)
  const [q, setQ] = useState('')
  const [looking, setLooking] = useState(null)
  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const mine = (x) => (family ? family.test(x.name) : x.h3)
    return (items || []).filter((x) => (all || mine(x)) && words.every((w) => `${x.name} ${x.civitai?.name || ''}`.toLowerCase().includes(w)))
  }, [items, all, q, family])
  const groups = useMemo(() => {
    const map = new Map()
    for (const x of [...shown].sort((a, b) => (b.prefs.favourite ? 1 : 0) - (a.prefs.favourite ? 1 : 0))) {
      const g = x.prefs.favourite ? '★ Favourites' : folderOf(x.name)
      if (!map.has(g)) map.set(g, [])
      map.get(g).push(x)
    }
    return [...map.entries()]
  }, [shown])
  const unknown = shown.filter((x) => !x.checked)
  async function identify(list) {
    for (const [i, x] of list.entries()) {
      setLooking({ name: x.name, n: i + 1, of: list.length })
      try {
        const r = await L().identify(x.name)
        setItems((all) => all.map((y) => (y.name === x.name ? { ...y, ...r } : y)))
      } catch (err) {
        notify?.(err.message)
      }
    }
    setLooking(null)
  }
  async function fav(x) {
    const prefs = await L().prefs(x.name, { favourite: !x.prefs.favourite })
    setItems((all) => all.map((y) => (y.name === x.name ? { ...y, prefs } : y)))
  }
  return (
    <div className="lora-yours">
      <div className="lora-bar">
        <input className="lora-search" value={q} placeholder="Search your LoRAs" onChange={(e) => setQ(e.target.value)} />
        <div className="segmented">
          <button className={all ? '' : 'on'} onClick={() => setAll(false)}>
            {family ? family.label : 'H3'} · {(items || []).filter((x) => (family ? family.test(x.name) : x.h3)).length}
          </button>
          <button className={all ? 'on' : ''} onClick={() => setAll(true)}>
            All · {(items || []).length}
          </button>
        </div>
        {unknown.length > 0 && (
          <button className="btn btn-small" disabled={!!looking} onClick={() => identify(unknown)}>
            {looking ? `Looking up ${looking.n} of ${looking.of}…` : `Find ${unknown.length} on Civitai`}
          </button>
        )}
      </div>
      {items === null && <p className="mono dim">Reading ComfyUI's LoRAs…</p>}
      {groups.map(([g, list]) => (
        <div key={g} className="lora-group">
          <p className="mono small dim lora-group-name">
            {g} · {list.length}
          </p>
          <div className={`lora-grid ${compact ? 'compact' : ''}`}>
            {list.map((x) => (
              <div key={x.name} className="lora-card mine" onClick={() => onPick?.(x)} role={onPick ? 'button' : undefined}>
                <LoraThumb preview={x.prefs.picture ? { file: x.prefs.picture, type: 'image' } : x.civitai?.preview} label={loraTitle(x.name)} mature={x.civitai?.mature} />
                <span className="lora-card-body">
                  <span className="lora-name" title={x.name}>
                    {x.civitai?.name || loraTitle(x.name)}
                  </span>
                  <span className="mono small dim">
                    {x.size ? MB(x.size) : ''}
                    {x.civitai?.trainedWords?.length ? ` · ${x.civitai.trainedWords[0]}` : ''}
                  </span>
                </span>
                <span className="lora-card-tools">
                  <button className={`lora-fav ${x.prefs.favourite ? 'on' : ''}`} title={x.prefs.favourite ? 'Remove from favourites' : 'Add to favourites'} onClick={(e) => (e.stopPropagation(), fav(x))}>
                    ★
                  </button>
                  {!x.checked && (
                    <button className="link-btn mono small" disabled={!!looking} onClick={(e) => (e.stopPropagation(), identify([x]))}>
                      Find
                    </button>
                  )}
                  {x.civitai && onOpenCivitai && (
                    <button className="link-btn mono small" onClick={(e) => (e.stopPropagation(), onOpenCivitai(x.civitai.modelId))}>
                      Info
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {items && shown.length === 0 && <p className="dim">{q ? 'Nothing matches.' : 'No H3 LoRAs in ComfyUI yet. Find some in Discover.'}</p>}
    </div>
  )
}

// ---------- the page ----------
export function LorasPage({ notify, go, addLoraToCreate }) {
  const [tab, setTab] = useState('discover')
  const [meta, setMeta] = useState(null)
  const [open, setOpen] = useState(null)
  const [items, setItems, reload] = useYours()
  useEffect(() => {
    L().meta().then(setMeta)
  }, [])
  const use = (l) => addLoraToCreate?.(l)
  return (
    <div className="loras">
      <Hero art="loras" title="LoRAs" kicker="Looks, moves and styles" />
      <p className="lede">
        Change how H3 looks and moves.
        <span className="lede-small dim">Find LoRAs on Civitai and download them straight into ComfyUI, or browse the ones you already have. Add one to a shot from Create's LoRA tray.</span>
      </p>
      <div className="lora-tabs segmented">
        <button className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}>
          Discover
        </button>
        <button className={tab === 'yours' ? 'on' : ''} onClick={() => (setTab('yours'), reload())}>
          Yours{items ? ` · ${items.filter((x) => x.h3).length}` : ''}
        </button>
      </div>
      <div className={`lora-layout ${open ? 'with-details' : ''}`}>
        <div>
          {tab === 'discover' ? (
            <Discover meta={meta} onOpen={(m) => setOpen(m.id)} />
          ) : (
            <Yours items={items} setItems={setItems} notify={notify} onOpenCivitai={(id) => setOpen(id)} onPick={(x) => use({ name: x.name, words: x.prefs.triggers || x.civitai?.trainedWords || [], title: x.civitai?.name || loraTitle(x.name) })} />
          )}
        </div>
        {open && <Details key={open} id={open} meta={meta} go={go} onClose={() => setOpen(null)} onUse={(l) => (reload(), use(l))} />}
      </div>
    </div>
  )
}

// The same in a dialog: Yours first, Discover a tab away. onPick({name, words, title}).
// family (Create -> Image): only this PC's LoRAs, narrowed to the family; Civitai's tab searches H3's.
export function LoraPicker({ onPick, onClose, notify, go, family = null }) {
  const [tab, setTab] = useState('yours')
  const [meta, setMeta] = useState(null)
  const [open, setOpen] = useState(null)
  const [items, setItems, reload] = useYours()
  useEffect(() => {
    L().meta().then(setMeta)
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])
  return (
    <div className="lora-picker-backdrop" onClick={onClose}>
      <div className="lora-picker" onClick={(e) => e.stopPropagation()}>
        <div className="lora-picker-head">
          <div className="segmented">
            <button className={tab === 'yours' ? 'on' : ''} onClick={() => (setTab('yours'), reload())}>
              Your LoRAs
            </button>
            {!family && (
              <button className={tab === 'discover' ? 'on' : ''} onClick={() => setTab('discover')}>
                Find on Civitai
              </button>
            )}
          </div>
          <button className="link-btn mono" onClick={onClose}>
            Close ×
          </button>
        </div>
        <div className={`lora-layout ${open ? 'with-details' : ''}`}>
          <div>
            {tab === 'yours' ? (
              <Yours compact family={family} items={items} setItems={setItems} notify={notify} onOpenCivitai={(id) => setOpen(id)} onPick={(x) => onPick({ name: x.name, words: x.prefs.triggers || x.civitai?.trainedWords || [], title: x.civitai?.name || loraTitle(x.name) })} />
            ) : (
              <Discover compact meta={meta} onOpen={(m) => setOpen(m.id)} />
            )}
          </div>
          {open && <Details key={open} id={open} meta={meta} go={go && ((p) => (onClose(), go(p)))} onClose={() => setOpen(null)} onUse={(l) => onPick(l)} />}
        </div>
      </div>
    </div>
  )
}
