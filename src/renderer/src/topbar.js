// What the top bar shows, each switchable in Settings → Top bar (settings.topBar: { id: false } hides it). The IV logo,
// the ComfyUI status and a running setup always show: they say whether IV Studio can render at all.
// [id, label, hint]
export const TOP_BAR = [
  ['brand', 'Infinite Variance / Studio', 'The name beside the logo.'],
  ['arrows', 'Back and forward', 'The arrows that step through the pages you visited (Alt+Left and Alt+Right still work).'],
  ['incognito', 'Incognito', 'The switch into the private space. Hidden, it comes back here; while you’re in Incognito it always shows, so you can leave.'],
  ['agent', 'Agent status', 'Shows when your agent is working, and opens the Dashboard.'],
  ['chat', 'Chat', 'Opens the chat with your agent. Hidden, the chat still opens from the Ask buttons around the app.'],
  ['meter', 'GPU and memory', 'This PC’s graphics card and memory use, and Free memory.'],
  ['cloudMeter', 'Cloud GPU time', 'While you render in the cloud: whether the GPU is on, and for how long since IV Studio opened.'],
  ['cloudCost', 'Cloud cost', 'The estimated cost beside the cloud GPU time. Off keeps the time and hides the money.'],
  ['balance', 'Comfy credits', 'Your Comfy.org credit balance, when you have a Comfy account key.']
]
const IDS = new Set(TOP_BAR.map(([id]) => id))

// Whether the top bar shows id (everything shows until it's switched off)
export const onTopBar = (topBar, id) => topBar?.[id] !== false

// What settings.topBar may hold: true or false for the ids above, nothing else
export function cleanTopBar(v) {
  if (!v || typeof v !== 'object') return null
  const out = {}
  for (const [k, on] of Object.entries(v)) if (IDS.has(k) && typeof on === 'boolean') out[k] = on
  return out
}
