import Hero from './Hero'

// Tools that take a video further. Each is its own page; new ones are added to TOOLS.
const TOOLS = [
  { page: 'sizzle', name: 'Sizzle', tag: 'A website, made into a film', about: 'Put in a web address. Your agent storyboards a promo film from the real site, then H3 shots, pictures, music and the site’s own screens are cut together with motion and typography.', credit: 'Capture, H3, Z-Image, MiniMax Music, Shinobi' },
  { page: 'shinobi', name: 'Shinobi', tag: 'Edits your agent cuts', about: 'Hand footage to an agent (or a one-click style) and get a finished edit: cuts on the beat, speed ramps, typography, effects and sound.', credit: 'Engine: OpenKatana' },
  { page: 'replace', name: 'Replace', tag: 'Swap who is in the shot', about: 'Put your character in place of someone in a video, swap several people, change or remove an object, or restore small faces. The camera, motion and soundtrack stay.', credit: 'Workflows: OpenJutsu' }
]

export default function Workflows({ go }) {
  return (
    <div className="workflows">
      <Hero art="workflows" title="Workflows" kicker="Take a video further" />
      <p className="lede">
        Tools for what comes after a render.
        <span className="lede-small dim">Each one works with your IV Studio renders and characters, and agents can use them through IV Studio's MCP.</span>
      </p>
      <div className="workflow-cards">
        {TOOLS.map((t) => (
          <button key={t.page} className="workflow-card" onClick={() => go(t.page)}>
            <span className="mono pink">{t.tag}</span>
            <span className="workflow-name">{t.name}</span>
            <span className="small dim">{t.about}</span>
            <span className="mono small dim">{t.credit}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
