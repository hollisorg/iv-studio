import { useEffect, useState } from 'react'
import { media } from '../media'

export default function Library({ openShot, go }) {
  const [projects, setProjects] = useState(null)

  useEffect(() => {
    window.ivstudio.projects.list().then(setProjects)
  }, [])

  return (
    <div className="library">
      <h1 className="page-title">
        <span className="accent">Shots</span>
      </h1>
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
          <button key={p.id} className="tile" onClick={() => openShot(p.id)}>
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
        ))}
      </div>
    </div>
  )
}
