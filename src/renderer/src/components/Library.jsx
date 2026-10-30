import { useEffect, useState } from 'react'
import { media } from '../media'
import Hero from './Hero'
import TileDelete from './TileDelete'

export default function Library({ openShot, go, notify }) {
  const [projects, setProjects] = useState(null)

  useEffect(() => {
    window.ivstudio.projects.list().then(setProjects)
  }, [])

  return (
    <div className="library">
      <Hero art="shots" title="Shots" kicker="Infinite Variance" />
      <p className="lede">
        Every shot you've made.
        <span className="lede-small dim">Open one to watch its previews, pick the best, finish it at full size, or try again from the same settings.</span>
      </p>
      {projects?.length === 0 && (
        <p className="dim">
          Nothing yet.{' '}
          <button className="link-btn" onClick={() => go('create')}>
            Make your first shot
          </button>
        </p>
      )}
      <div className="tiles">
        {projects?.map((p) => (
          <div key={p.id} className="tile-wrap">
          <button className="tile" onClick={() => openShot(p.id)}>
            <div className="tile-media">{p.cover ? <video src={media(p.cover)} muted preload="metadata" /> : <span className="mono dim">No output yet</span>}</div>
            <div className="tile-body">
              <span className="tile-name">{p.name}</span>
              <span className="mono dim">
                {p.jobCount} run{p.jobCount === 1 ? '' : 's'} · {p.finals} final{p.finals === 1 ? '' : 's'}
                {p.running ? ' · rendering' : ''}
              </span>
              <span className="mono dim">{new Date(p.updatedAt).toLocaleString()}</span>
            </div>
          </button>
          <TileDelete name={p.name} keeps="Its videos stay in ComfyUI's output folder." notify={notify} onDelete={async () => (await window.ivstudio.projects.delete(p.id), setProjects(await window.ivstudio.projects.list()))} />
          </div>
        ))}
      </div>
    </div>
  )
}
