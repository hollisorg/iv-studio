import { useCallback, useEffect, useRef, useState } from 'react'
import Create from './components/Create'
import Library from './components/Library'
import Cloud from './components/Cloud'
import { EditEditor, EditList } from './components/Edit'
import { SequenceEditor, SequenceList } from './components/Sequences'
import Settings from './components/Settings'
import Setup from './components/Setup'
import Shot from './components/Shot'

const PAGES = [
  ['create', 'Create'],
  ['library', 'Shots'],
  ['sequences', 'Sequences'],
  ['edits', 'Edit'],
  ['setup', 'Setup'],
  ['cloud', 'Cloud'],
  ['settings', 'Settings']
]

export default function App() {
  const [page, setPage] = useState('create')
  const [projectId, setProjectId] = useState(null)
  const [sequenceId, setSequenceId] = useState(null)
  const [editId, setEditId] = useState(null)
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

  const openEdit = (id) => {
    setEditId(id)
    setPage('edit')
  }

  const ready = setup?.ready
  const ctx = { setup, caps: setup?.caps, remote: !!setup?.remote, recheck, checking, characters, setCharacters, notify, openShot, openSequence, openEdit, jobs, setJobs, info, go: setPage }
  const missing = setup?.items?.filter((i) => i.status === 'missing').length || 0

  return (
    <div className="app">
      <header className="titlebar">
        <span className="brand-mark">IV</span>
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
          <button key={id} className={`nav-item ${page === id || (id === 'library' && page === 'shot') || (id === 'sequences' && page === 'sequence') || (id === 'edits' && page === 'edit') ? 'on' : ''}`} onClick={() => setPage(id)}>
            <span className="mono dim">{String(i + 1).padStart(2, '0')}</span>
            {label}
            {id === 'setup' && missing > 0 && <span className="nav-dot" />}
          </button>
        ))}
        <div className="nav-foot mono dim">v{info?.version}</div>
      </nav>
      <main className={`page ${page === 'edit' ? 'page-editor' : ''}`}>
        {page === 'create' && <Create {...ctx} />}
        {page === 'library' && <Library {...ctx} />}
        {page === 'shot' && projectId && <Shot key={projectId} projectId={projectId} {...ctx} />}
        {page === 'sequences' && <SequenceList {...ctx} />}
        {page === 'sequence' && sequenceId && <SequenceEditor key={sequenceId} sequenceId={sequenceId} {...ctx} />}
        {page === 'edits' && <EditList {...ctx} />}
        {page === 'edit' && editId && <EditEditor key={editId} editId={editId} {...ctx} />}
        {page === 'setup' && <Setup {...ctx} />}
        {page === 'cloud' && <Cloud {...ctx} />}
        {page === 'settings' && <Settings {...ctx} />}
      </main>
      {toast && (
        <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>
          {toast.text}
        </div>
      )}
    </div>
  )
}
