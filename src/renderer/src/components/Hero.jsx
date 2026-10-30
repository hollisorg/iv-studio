// Each page's own banner art (assets/pages/<name>.webp): the eye's artwork with the eye swapped for the page's
// subject, made the same way as the closed eye (docs/art/README.md). Create keeps the eye itself.
const ART = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/pages/*.webp', { eager: true, import: 'default' })).map(([file, url]) => [file.split('/').pop().replace('.webp', ''), url])
)

// The page header from the "What If?" artwork: a heavy condensed title and a spaced kicker on the dark
// left, the page's art fading in on the right (art names one from assets/pages; none is the eye; Incognito
// shows the closed eye everywhere). children go in place of the title (editable names); back is a link
// pinned to the top left.
export default function Hero({ art, title, kicker, back, children }) {
  return (
    <header className="hero">
      <div className="hero-eye" aria-hidden="true" style={ART[art] ? { '--hero-art': `url("${ART[art]}")` } : undefined} />
      {back && (
        <button className="link-btn mono hero-back" onClick={back.onClick}>
          ← {back.label}
        </button>
      )}
      <div className="hero-text">
        {title && <h1 className="hero-title">{title}</h1>}
        {children}
        {kicker && <p className="hero-kicker">{kicker}</p>}
      </div>
    </header>
  )
}
