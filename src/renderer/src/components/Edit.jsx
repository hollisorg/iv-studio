import { useEffect, useState } from 'react'
import Hero from './Hero'
import TileDelete from './TileDelete'
import { timecode } from './edit/model'

export { default as EditEditor } from './edit/Editor'

export function EditList({ openEdit, notify }) {
  const [list, setList] = useState(null)
  useEffect(() => {
    window.ivstudio.edits.list().then(setList)
  }, [])
  async function create() {
    try {
      openEdit((await window.ivstudio.edits.create('Untitled edit')).id)
    } catch (err) {
      notify(err.message)
    }
  }
  return (
    <div className="edits">
      <Hero title="Edit" kicker="Infinite Variance" />
      <p className="lede">
        Cut your shots and sequences together.
        <span className="lede-small dim">A multi-track timeline with trims, fades, titles and sound, played live and exported as one MP4.</span>
      </p>
      <button className="btn btn-primary" onClick={create}>
        New edit
      </button>
      <div className="tiles seq-tiles">
        {list?.map((e) => (
          <div key={e.id} className="tile-wrap">
          <button className="tile" onClick={() => openEdit(e.id)}>
            <div className="tile-body">
              <span className="tile-name">{e.name}</span>
              <span className="mono dim">
                {e.clips} clip{e.clips === 1 ? '' : 's'} · {timecode(e.seconds)} · {e.exports} export{e.exports === 1 ? '' : 's'}
              </span>
              <span className="mono dim">{new Date(e.updatedAt).toLocaleString()}</span>
            </div>
          </button>
          <TileDelete name={e.name} keeps="Its media files and exported videos stay on disk." notify={notify} onDelete={async () => (await window.ivstudio.edits.delete(e.id), setList(await window.ivstudio.edits.list()))} />
          </div>
        ))}
      </div>
    </div>
  )
}
