import Hero from './Hero'

// Create makes a video (a shot, Create.jsx) or an image (below); this switch sits under Create's banner on
// both. Its look is Settings | Setup's.
export function CreateKind({ kind, onKind }) {
  return (
    <div className="section-switch settings-tabs" role="tablist" aria-label="Video or image">
      {[
        ['video', 'Video'],
        ['image', 'Image']
      ].map(([id, label]) => (
        <button key={id} role="tab" aria-selected={kind === id} className={kind === id ? 'on' : ''} onClick={() => onKind(id)}>
          {label}
        </button>
      ))}
    </div>
  )
}

// Create -> Image: making and editing pictures. A placeholder until its first tools are built.
export default function Images({ kindSwitch }) {
  return (
    <div className="images-page">
      <Hero title="What if?" kicker="New image" />
      {kindSwitch}
      <p className="lede">
        Make and edit pictures, right next to your shots.
        <span className="lede-small dim">Coming next: this is where IV Studio’s picture tools will live.</span>
      </p>
    </div>
  )
}
