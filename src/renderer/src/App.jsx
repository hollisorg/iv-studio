import { useCallback, useEffect, useRef, useState } from 'react'
import { CharacterList, CharacterTrainer } from './components/Characters'
import Create from './components/Create'
import ivMark from './assets/iv-mark.png'
import { ConfirmHost } from './components/Confirm'
import Library from './components/Library'
import Cloud from './components/Cloud'
import { EditEditor, EditList } from './components/Edit'
import { SequenceEditor, SequenceList } from './components/Sequences'
import Settings from './components/Settings'
import { ShinobiList, ShinobiProject } from './components/Shinobi'
import Replace from './components/Replace'
import Workflows from './components/Workflows'
import { LinesPage, VoicesPage } from './components/Voices'
import { MusicPage } from './components/Music'
import MediaLibrary from './components/MediaLibrary'
import { LorasPage } from './components/Loras'
import Setup from './components/Setup'
import Shot from './components/Shot'

// The sidebar's two halves, switched at its foot. Characters and Settings are in both; the Library (everything
// made, page 'media') sits above the switch and belongs to neither.
const SECTIONS = {
  video: [
    ['create', 'Create'],
    ['library', 'Shots'],
    ['sequences', 'Sequences'],
    ['edits', 'Edit'],
    ['workflows', 'Workflows'],
    ['characters', 'Characters'],
    ['loras', 'LoRAs'],
    ['setup', 'Setup'],
    ['cloud', 'Cloud'],
    ['settings', 'Settings']
  ],
  audio: [
    ['voices', 'Voices'],
    ['lines', 'Lines'],
    ['music', 'Music'],
    ['characters', 'Characters'],
    ['settings', 'Settings']
  ]
}
const SUBPAGES = { library: ['shot'], sequences: ['sequence'], edits: ['edit'], characters: ['character'], workflows: ['shinobi', 'shinobi-film', 'replace'] }
const savedSection = () => {
  try {
    return localStorage.getItem('iv.section') === 'audio' ? 'audio' : 'video'
  } catch {
    return 'video'
  }
}

export default function App() {
  const [section, setSection] = useState(savedSection)
  const [page, setPage] = useState(() => (savedSection() === 'audio' ? 'voices' : 'create'))
  // a spoken line or a song on its way to Create's voice line (Lines or Music > Use in a shot)
  const [lineForCreate, setLineForCreate] = useState(null)
  // a LoRA on its way to Create's LoRA tray (LoRAs > Use in a shot)
  const [loraForCreate, setLoraForCreate] = useState(null)
  const [projectId, setProjectId] = useState(null)
  const [sequenceId, setSequenceId] = useState(null)
  const [editId, setEditId] = useState(null)
  const [trainingId, setTrainingId] = useState(null)
  const [shinobiId, setShinobiId] = useState(null)
  const [setup, setSetup] = useState(null)
  const [checking, setChecking] = useState(false)
  const [characters, setCharacters] = useState([])
  const [info, setInfo] = useState(null)
  const [toast, setToast] = useState(null)
  const [jobs, setJobs] = useState({})
  const toastTimer = useRef(null)

  const notify = useCallback((text, kind = 'error') => {
    setToast({ text, kind })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 7000)
  }, [])

  const recheck = useCallback(async () => {
    setChecking(true)
    try {
      setSetup(await window.ivstudio.setup.check())
    } catch (err) {
      setSetup({ ready: false, items: [{ id: 'comfyui', label: 'ComfyUI', status: 'missing', detail: err.message }] })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    recheck()
    window.ivstudio.characters.list().then(setCharacters)
    window.ivstudio.app.info().then(setInfo)
    return window.ivstudio.jobs.onUpdate((job) => setJobs((all) => ({ ...all, [job.id]: job })))
  }, [recheck])


  const openShinobi = (id) => {
    setShinobiId(id)
    setPage('shinobi-film')
  }

  const openCharacter = (id) => {
    setTrainingId(id)
    setPage('character')
  }

  const switchSection = (next) => {
    if (next === section) return
    setSection(next)
    try {
      localStorage.setItem('iv.section', next)
    } catch {}
    if (page !== 'media' && !SECTIONS[next].some(([id]) => id === page || SUBPAGES[id]?.includes(page))) setPage(SECTIONS[next][0][0])
  }
  // Shots, Sequences and Edit are on the Video side; the Library and Music open them from anywhere
  const openShot = (id) => {
    setProjectId(id)
    switchSection('video')
    setPage('shot')
  }
  const openSequence = (id) => {
    setSequenceId(id)
    switchSection('video')
    setPage('sequence')
  }
  const openEdit = (id) => {
    setEditId(id)
    switchSection('video')
    setPage('edit')
  }
  const addLoraToCreate = (lora) => {
    setLoraForCreate(lora)
    switchSection('video')
    setPage('create')
  }
  const sendToCreate = (line) => {
    setLineForCreate(line)
    switchSection('video')
    setPage('create')
  }

  const ready = setup?.ready
  const ctx = { setup, caps: setup?.caps, remote: !!setup?.remote, recheck, checking, characters, setCharacters, notify, openShot, openSequence, openEdit, openCharacter, openShinobi, jobs, setJobs, info, go: setPage, sendToCreate, addLoraToCreate }
  const missing = setup?.items?.filter((i) => i.status === 'missing').length || 0

  return (
    <div className="app">
      <header className="titlebar">
        <img className="brand-logo" src={ivMark} alt="Infinite Variance" />
        <span className="mono">Infinite Variance</span>
        <span className="mono dim">/ Studio</span>
        {info?.testCopy && <span className="mono test-copy">Test copy · separate data</span>}
        <div className={`engine-badge ${setup ? (ready ? 'ready' : 'error') : ''}`}>
          <span className="dot" />
          {setup?.remote && <span className="mono cloud-badge">Cloud</span>}
          <span className="mono">{!setup ? 'Checking ComfyUI' : ready ? 'ComfyUI ready' : `${missing} to fix`}</span>
          {setup?.items?.find((i) => i.id === 'gpu') && <span className="mono dim">{setup.items.find((i) => i.id === 'gpu').detail}</span>}
        </div>
      </header>
      <nav className="nav">
        {SECTIONS[section].map(([id, label], i) => (
          <button key={id} className={`nav-item ${page === id || SUBPAGES[id]?.includes(page) ? 'on' : ''}`} onClick={() => setPage(id)}>
            <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
            {label}
            {id === 'setup' && missing > 0 && <span className="nav-dot" />}
          </button>
        ))}
        <div className="nav-foot mono">
          <button className={`nav-library ${page === 'media' ? 'on' : ''}`} onClick={() => setPage('media')}>
            Library
          </button>
          <div className="section-switch" role="tablist" aria-label="Video or audio">
            {['video', 'audio'].map((id) => (
              <button key={id} role="tab" aria-selected={section === id} className={section === id ? 'on' : ''} onClick={() => switchSection(id)}>
                {id === 'video' ? 'Video' : 'Audio'}
              </button>
            ))}
          </div>
          <span>v{info?.version}</span>
          <button className="link-btn mono nav-site" onClick={() => window.ivstudio.links.open(info?.links?.website || 'https://infinitevariance.ai')}>
            infinitevariance.ai ↗
          </button>
        </div>
      </nav>
      <main className={`page ${page === 'edit' ? 'page-editor' : ''}`}>
        {page === 'create' && <Create {...ctx} incomingLine={lineForCreate} clearIncomingLine={() => setLineForCreate(null)} incomingLora={loraForCreate} clearIncomingLora={() => setLoraForCreate(null)} />}
        {page === 'loras' && <LorasPage {...ctx} />}
        {page === 'voices' && <VoicesPage {...ctx} />}
        {page === 'lines' && <LinesPage {...ctx} />}
        {page === 'music' && <MusicPage {...ctx} />}
        {page === 'media' && <MediaLibrary {...ctx} />}
        {page === 'library' && <Library {...ctx} />}
        {page === 'shot' && projectId && <Shot key={projectId} projectId={projectId} {...ctx} />}
        {page === 'sequences' && <SequenceList {...ctx} />}
        {page === 'sequence' && sequenceId && <SequenceEditor key={sequenceId} sequenceId={sequenceId} {...ctx} />}
        {page === 'edits' && <EditList {...ctx} />}
        {page === 'edit' && editId && <EditEditor key={editId} editId={editId} {...ctx} />}
        {page === 'workflows' && <Workflows {...ctx} />}
        {page === 'replace' && <Replace {...ctx} />}
        {page === 'shinobi' && <ShinobiList {...ctx} />}
        {page === 'shinobi-film' && shinobiId && <ShinobiProject key={shinobiId} projectId={shinobiId} {...ctx} />}
        {page === 'characters' && <CharacterList {...ctx} />}
        {page === 'character' && trainingId && <CharacterTrainer key={trainingId} trainingId={trainingId} {...ctx} />}
        {page === 'setup' && <Setup {...ctx} />}
        {page === 'cloud' && <Cloud {...ctx} />}
        {page === 'settings' && <Settings {...ctx} />}
      </main>
      <ConfirmHost />
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
