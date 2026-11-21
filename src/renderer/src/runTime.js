// When a shot's run finished, for its header on the Shot page (GitHub #49: a timestamp on each run, to follow prompt
// changes over a long session). In this PC's own time and date style: "Finished 20 Nov, 15:42", with the year
// only when it isn't this year. A run still going shows when it started. title: the full date and time.
export function runTime(run, { now = new Date(), locale } = {}) {
  const at = run?.finishedAt || run?.createdAt
  if (!at) return null
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return null
  const date = d.toLocaleDateString(locale, { day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
  const time = d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  return { label: `${run.finishedAt ? 'Finished' : 'Started'} ${date}, ${time}`, title: d.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'medium' }), at: d.toISOString() }
}
