import { ask } from './Confirm'

// The small × on a list tile. Asks first; what stays on disk is in the question.
export default function TileDelete({ name, keeps = 'Rendered videos stay on disk.', onDelete, notify }) {
  return (
    <button
      className="tile-delete"
      title={`Delete ${name}`}
      onClick={async (e) => {
        e.stopPropagation()
        if (!(await ask({ title: `Delete “${name}”?`, message: keeps, confirm: 'Delete', danger: true }))) return
        try {
          await onDelete()
        } catch (err) {
          notify?.(err.message)
        }
      }}
    >
      ×
    </button>
  )
}
