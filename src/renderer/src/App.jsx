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
import Setup from './components/Setup'
import Shot from './components/Shot'

const PAGES = [
  ['create', 'Create'],
  ['library', 'Shots'],
  ['sequences', 'Sequences'],
  ['edits', 'Edit'],
  ['workflows', 'Workflows'],
  ['characters', 'Characters'],
  ['setup', 'Setup'],
  ['cloud', 'Cloud'],
  ['settings', 'Settings']
]

export default function App() {
  const [page, setPage] = useState('create')
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

  const openShot = (id) => {
    setProjectId(id)
    setPage('shot')
  }

  const openSequence = (id) => {
    setSequenceId(id)
    setPage('sequence')
  }

  const openShinobi = (id) => {
    setShinobiId(id)
    setPage('shinobi-film')
  }

  const openCharacter = (id) => {
    setTrainingId(id)
    setPage('character')
  }

  const openEdit = (id) => {
    setEditId(id)
    setPage('edit')
  }

  const ready = setup?.ready
  const ctx = { setup, caps: setup?.caps, remote: !!setup?.remote, recheck, checking, characters, setCharacters, notify, openShot, openSequence, openEdit, openCharacter, openShinobi, jobs, setJobs, info, go: setPage }
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
        {PAGES.map(([id, label], i) => (
          <button key={id} className={`nav-item ${page === id || (id === 'library' && page === 'shot') || (id === 'sequences' && page === 'sequence') || (id === 'edits' && page === 'edit') || (id === 'characters' && page === 'character') || (id === 'workflows' && ['shinobi', 'shinobi-film', 'replace'].includes(page)) ? 'on' : ''}`} onClick={() => setPage(id)}>
            <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
            {label}
            {id === 'setup' && missing > 0 && <span className="nav-dot" />}
          </button>
        ))}
        <div className="nav-foot mono">
          <span>v{info?.version}</span>
          <button className="link-btn mono nav-site" onClick={() => window.ivstudio.links.open(info?.links?.website || 'https://infinitevariance.ai')}>
            infinitevariance.ai ↗
          </button>
        </div>
      </nav>
      <main className={`page ${page === 'edit' ? 'page-editor' : ''}`}>
        {page === 'create' && <Create {...ctx} />}
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
