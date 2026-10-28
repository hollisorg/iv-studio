// The page header from the "What If?" artwork: a heavy condensed title and a spaced kicker on the dark
// left, the Infinite Variance eye fading in on the right. children go in place of the title (editable
// names); back is a link pinned to the top left.
export default function Hero({ title, kicker, back, children }) {
  return (
    <header className="hero">
      <div className="hero-eye" aria-hidden="true" />
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
