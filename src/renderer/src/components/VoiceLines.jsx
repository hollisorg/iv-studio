import { fileUrl } from './edit/model'

// The voice swap's new track (remakevoice.js), for Replace and Rebuild: the original and the new sound, how the room
// sound is kept, and every line heard, with its words (editable), whether the new voice says it, Say it again and
// what Whisper heard back. voice: the session's or rebuild's .voice. names: index -> the person's name.
export default function VoiceLines({ voice: v, busy, step, names = [], onMake, onPhrase, onSetupSplitter, settingUp }) {
  return (
    <>
      {step && <p className="small dim">The voice: {step}…</p>}
      {!v?.track && !step && (
        <button className="btn" disabled={!!busy} onClick={() => onMake()}>
          Make the voice
        </button>
      )}
      {v?.track && (
        <>
          <div className="remake-voice-players">
            <label className="small dim">
              Original
              <audio controls src={fileUrl(v.original)} />
            </label>
            <label className="small dim">
              New
              <audio controls src={`${fileUrl(v.track)}?v=${encodeURIComponent(v.madeAt || '')}`} />
            </label>
          </div>
          <p className="small dim">
            {v.mode === 'split' ? 'Room sound and music kept under the new voice.' : 'The room sound dips while the new voice talks.'}
            {v.mode !== 'split' && onSetupSplitter && (
              <>
                {' '}
                <button className="link-btn mono" disabled={!!busy} onClick={onSetupSplitter}>
                  {settingUp ? 'Setting up…' : 'Keep the room sound (a one-time 120 MB setup)'}
                </button>
              </>
            )}
          </p>
          {!v.phrases?.length && <p className="small pink">No spoken words were heard, so there is nothing to say in the new voice.</p>}
          <div className="remake-lines">
            {v.phrases?.map((ph, i) => (
              <div key={`${i}-${ph.start}`} className={`remake-line ${ph.swap ? '' : 'kept'}`}>
                <span className="mono small dim">
                  {ph.start.toFixed(1)}–{ph.end.toFixed(1)} s
                </span>
                <input className="small" defaultValue={ph.text} disabled={!!busy} aria-label={`Line ${i + 1}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== ph.text && onPhrase(i, { text: e.target.value })} />
                <label className="small">
                  <input type="checkbox" checked={!!ph.swap} disabled={!!busy} onChange={(e) => onPhrase(i, { swap: e.target.checked })} /> {(ph.person != null && (v.people?.[ph.person]?.name || names[ph.person])) || 'They'} say this
                </label>
                {ph.file && (
                  <button className="link-btn mono" disabled={!!busy} onClick={() => onPhrase(i, { again: true })}>
                    Say it again
                  </button>
                )}
                {ph.warn && <span className="small pink">{ph.warn}</span>}
                {ph.match != null && ph.match < 0.75 && <span className="small pink">Heard back as “{ph.heard}”.</span>}
              </div>
            ))}
          </div>
          <button className="btn btn-small" disabled={!!busy} onClick={() => onMake({ rehear: true })}>
            Hear the words again
          </button>
        </>
      )}
    </>
  )
}
