# Replace: swap the voice too

Status: built locally (Matthew: "Yes, build it", 2026-11-21), run for real on this PC 2026-11-22 (Matthew: "Yes, run
them"), not committed. Worktree
`C:\Users\Matthew\iv-studio-voiceswap`, branch `claude/replace-voice` from `36628a7` (1.1.24).

## Build status

- **Splitter decided: Demucs** (Meta, MIT, code and weights), not Mel-Band RoFormer: neither
  kijai/ComfyUI-MelBandRoFormer nor KimberleyJensen/Mel-Band-Roformer-Vocal-Model has a licence on GitHub. Demucs
  4.0.1 goes into the voice engine's own environment only when Replace first asks for it ("Keep the room sound", about
  120 MB), so nobody else has to set voices up again (`voiceengine.js installSplitter`, `voice_server.py separate`).
- **Built:** `src/service/remakevoice.js` (hear, who, speak, fit, mix, read back; take C helpers);
  `voice_server.py` ops `transcribe_timed` and `separate`; `mouth_track.py --motion`; `voices.js`
  `transcribeTimed`, `separate`, `sayTo`; `remake.js` (graph `audio` / `voiceRef` / `regen`, `prepare` `origin`,
  `render` `voice` / `h3voice`, `finalArgs` laying the track back on, the writer told the words); the Remake node
  (optional `ref_audio` and `regen`, pack version 2 so Setup offers the update); main IPC, preload, the Replace screen
  (a voice per person, "The voice" step, the experimental H3 option); MCP `remake_paint` (`character`, `voiceId`,
  `voice`), new `remake_voice`, `remake_render` (`voice`, `h3voice`). Also fixed: two pages listing voices at once each
  made the same ready-made voice (`characters.js attachVoices`).
- **Checked:** `test/remake-voice.mjs` 13/13 (in the CI list), including a real mix with the bundled ffmpeg; remake,
  softmouth, nodepacks, model-versions, lint, tours, cloudvoice pass; the built MCP server lists 246 tools with
  `remake_voice`; a test copy of the window on scratch data 12/12 at 1440x900 and 390x844 (voice picker defaults to the
  character's saved voice, Keep the original voice, the engine notice, no overflow, no console errors).
- **Real runs, 2026-11-22** (scratch data; the voice engine and Shinobi borrowed by junction; ComfyUI on 8188; files in
  the session scratchpad `real/out`):
  - Demucs installed into the real voice engine through `installSplitter` (19.5 s, 8 packages added, nothing changed).
  - Voice only on the Tess pottery clip in Theo's voice: split, timed Whisper, one line (0.12-5.59 s), said at the first
    seed, Whisper reads it back word for word (match 1), the new track 1.8 dB under the source. Room tone check moot:
    the H3 source is digitally silent around the words (background -59 LUFS).
  - Takes A (Theo's track), B (soft mouth + track) and C (H3 speaks the line in Theo's voice through `<Audio 1>` and
    `regen`), seed 832924 like the Example. C said exactly the words and nothing more. **Matthew: "C is easily the
    best."** So `remake.render` now uses H3 voicing by default when Replace's nodes are version 2 (`h3voice: null`),
    and the window's option became "Use the new voice track exactly as heard". The track stays the fallback.
  - The mouth-motion vs loudness measure could not tell Theo's voice from Tess's (their loudness curves correlate
    0.7-0.8; in a rebuild shot driven only by Theo it still leaned to Tess), so the verdict is Matthew's eye.
  - Remake node pack updated to version 2 through `install_node_packs` (old copy:
    `F:\ComfyUI-cu130-v0.30.0\iv-backups\ComfyUI-Viggle-Remake-v1-20261122`), ComfyUI restarted through
    ComfyUI-Manager's reboot (up in 50 s, `ref_audio` and `regen` listed).
  - Rebuild on the same clip with Theo's character: read (words heard), plan, voice, one H3 shot with its voice piece
    (5.875 s, the cut's retime undone), three previews, finish, first cut with the track on A1, export 6.6 s 1080p,
    Whisper hears the line exactly. Its frames were taken from take A by hand: Rebuild's painter (Qwen Image 2.1) hits
    the encoder mix-up on this PC (`normalized_shape=[4096]`), fixed only in the Example session's worktree.
- **Fixed by the real runs:** VoxCPM2 opens a line with 0.6-1.2 s of silence, which was fitted and placed as if it were
  speech (`speechSpan` / `speechOnly` now cut each new line to its words); a trailing silence that silencedetect closes
  a frame before the end of the file didn't pull the phrase end in (`tighten` EDGE); the timed Whisper never reported
  the language (`detect_language`); `installSplitter` reported itself still installing. Tests: remake-voice 14/14,
  rebuild-voice 7/7, the CI list 83/83, MCP smoke, the window 12/12.
- **Not checked:** the window's new track option with a real ComfyUI (the window test runs on a dead port); takes A/B
  were made before the line trim; singing.

## The problem

Replace's Swap people (Remake, kind `swap`) keeps the source soundtrack. In the Example render, Theo now stands in
Tess's pottery studio but still speaks in Tess's voice. Matthew: "we should replace the voice also ... and that needs to
all be in the same workflow".

Goal: when a person is swapped for a character, the new person says the same words in the character's voice, at the
same moments, with the room sound and music kept and the lips following the new voice. The person does nothing outside
Replace.

## What the code does today (facts this design rests on)

- `remake.js prepare()` writes `source.mp4`: the clip at 24 fps on Remake's canvas, padded to 17n+5 frames, with the
  sound at 48 kHz padded with silence to the same length.
- `remakeGraph()` feeds that file's own audio (`audio: ['8', 1]`) into `RemakeConditioning`.
- `RemakeConditioning` (our bundled `nodes.py`) encodes that audio and holds it **clean** in the target latent
  (`noise_mask` 0 for audio). H3 does not invent sound here: the take's soundtrack is the input track passed through
  H3's audio VAE (32 kHz), and the picture is generated alongside it. This is the same "clean audio, masked" setup that
  made Tess's mouth follow a supplied voice track in the Geiru test (`iv_dmad_supplied`, 2026-11-10).
- `finalFile()` trims the take back to the source length and keeps the take's (VAE round-tripped) sound.
- Soft mouth (`softmouth.js`, the checkbox in `RemakeFlow.jsx`) already blurs the source's mouths before Remake sees
  them, "so the new person doesn't mouth the source's words". It needs Shinobi's Python and the face models.
- The voice engine (`voiceengine.js`, `voice_server.py`): VoxCPM2 `speak` clones from a reference WAV plus its words;
  Whisper large-v3 turbo `transcribe` returns **text only, no timings** (captions.js notes this too).
- A character links to a voice by `voiceId` (the ready-made Tess and Theo get theirs from
  `resources/characters/*-voice.wav` via `attachVoices`). `remake:faces` does not pass `voiceId` today.
- The bundled ffmpeg (6.1.2) has `rubberband` (good time stretch, formants kept), `silencedetect`, `acrossfade`,
  `sidechaincompress` and `loudnorm`.
- Voice/background split on this PC: nothing in IV Studio or Shinobi does it. `F:\ComfyUI\ComfyUI\custom_nodes` (the
  older ComfyUI) has kijai's `ComfyUI-MelBandRoFormer` (outputs `vocals` and `instruments`), and the shared models
  folder has `diffusion_models/MelBandRoformer_fp32_MelBandRoformer_fp32.safetensors` (913 MB). The live ComfyUI
  (`F:\ComfyUI-cu130-v0.30.0`) does **not** have that node pack. `comfyui-mmaudio` is there, but MMAudio makes sound
  from video, it does not separate.

## Where the voice comes from: the character's saved voice

Characters can already have a saved voice, and Replace should just use it. Nothing new is stored.

- **The saved voice.** The character page (`CharacterProfile.jsx`) has a Voice picker that saves `voiceId` on the
  character: a voice from Audio → Voices, kept as `voices/<id>/reference.wav` (up to 20 s, mono) plus its words.
  You can make it by recording, cloning (with the consent tick) or designing it from a description. Ready-made Tess
  and Theo get theirs automatically from `resources/characters/*-voice.wav`. `speak_line`, Create and Projects
  already read `voiceId`.
- **One saved voice, both ways in.** The same `reference.wav` and its words feed both paths in this design:
  - VoxCPM2 clones from it to make the new voice track (takes A and B);
  - it goes to H3 as the `<Audio 1>` reference (take C).
  It is saved once and fed to either path.
- **Voices H3 learned.** A character can also carry a voice that H3 itself learned: a voice RefMod (`voiceRefmod`,
  as Tess has with `characters/tess_audio`) or the voice baked into their LoRA. Matthew confirmed Tess's LoRA voice
  is hers ("Yes, that's her", 2026-11-11). Take C can use either one instead of the clip. The order of preference is
  the LoRA's own voice when Replace's "use their LoRA" is on, then the RefMod, then the saved clip.
- **The gaps Replace closes:**
  - `remake:faces` and the MCP tool `remake_paint` don't pass the character's voice today. They will pass
    `voiceId`, the voice's name, `voiceRefmod`, and whether the character has a LoRA.
  - A person added as a plain picture has no voice. Their tile offers "Use a voice…" from the Voices library.
  - "Save as a character" on that tile keeps the picture and the chosen voice together for next time. It creates a
    character with the existing `save_character` fields, and only when the person clicks it.
- **No voice yet.** The character page's "Their voice, in words" (`voiceNote`) can start one: the voice tile offers
  "Make a voice from '...'". This opens Voices' designer with the note filled in. Once a candidate is kept, it is
  saved to the character's `voiceId`, so it's there for every later Replace, Create or Sequence.

## How it works, end to end

```
source.mp4 sound ─► 1 split ─► vocals.wav ─► 2 hear (Whisper, timed) ─► phrases
                        └────► background.wav                              │
                                                        3 who says each ◄──┘
                                                                │
              character voice (VoxCPM2 clone) ─► 4 speak each swapped phrase, fit to its time span
                                                                │
 background + kept original phrases + new phrases ─► 5 mix ─► voice.wav (exact source length)
                                                                │
                          6 render: voice.wav into RemakeConditioning's audio input
                                                                │
                          7 final: take's picture + voice.wav laid back on (not the VAE copy)
```

### 1. Split voice from background

Recommended: the Mel-Band RoFormer vocal model on this PC's ComfyUI, as a tiny graph (`LoadAudio`,
`MelBandRoFormerModelLoader`, `MelBandRoFormerSampler`, two `SaveAudio`). It runs where IV Studio's other GPU work
runs, through the same queue and staging, and the model is already on this PC. About 10 s for a 14 s clip.

- Setup: the node pack is added to `models.json` as an optional pinned pack (Settings → Setup installs it, like
  FaceRefine Plus), the model as an optional download. Replace's check lists it as "optional: keeps the room sound".
- **Licence to check before shipping** (decision for Matthew): the local copy of kijai's pack has no LICENSE file,
  and the vocal weights come from KimberleyJensen/Mel-Band-Roformer-Vocal-Model. If either is unclear, the fallback
  is Demucs (htdemucs, MIT code and weights) installed into the voice engine's Python, with a `separate` op in
  `voice_server.py`. That costs a voice-engine reinstall (VERSION bump) for everyone, so the ComfyUI route is first.
- Without a separator (not installed, or on the person's own cloud): the **simple mix** below. Replace says so in
  plain words ("the room sound dips while Theo talks; install the voice splitter in Setup to keep it").

### 2. Hear the words, with timings

New voice engine op `transcribe_timed` in `voice_server.py`: the same Whisper model, `generate(...,
return_timestamps=True)` for segment times (and word times through the turbo model's alignment heads if they prove
reliable; segments are enough). Run on `vocals.wav` (or the full track without a split), only over the real `n`
frames, never the backwards padding.

Then, in pure JS (`remakevoice.js`, tested):
- each segment's edges tightened with `silencedetect` on the vocal stem (-35 dB, 0.12 s), and long segments split
  at inner silences of 0.25 s or more, so a "phrase" is one breath of speech;
- Whisper's phantom lines dropped (reuse `phantom()` and `QUIET_DB` from `captions.js`);
- the person can correct the words of any phrase (Whisper mistakes, names). Changing the meaning is allowed, but a
  much longer line will not fit its slot and is flagged.

`Voices.transcribeTimed(file)` wraps it like `transcribe()`. Same language as the source; VoxCPM2 speaks it if it
can, otherwise Replace says the voice can't be swapped for that language.

### 3. Who says each phrase

- **One face in the clip** (most cases, including the Tess pottery clip): every phrase is the swapped person's.
- **Several faces, one swapped**: `mouth_track.py` gets a `--motion` mode that reports, per frame and per face, the
  mouth box and how much the mouth region moves. Each phrase goes to the face whose mouth moves most during it. The
  swapped face is the one at the position where the painted frame's best likeness to the character was found
  (`checkPaint` already finds it; we keep its box). Phrases from other faces, or with no moving mouth (off screen,
  narrator), keep their original voice.
- **Two people swapped** (Remake's max): same, each phrase gets its person's voice.
- The guess is shown as a tick per phrase ("Theo says this"), which the person can change. Without the face models,
  everything is ticked when there is one person and nothing is guessed otherwise (all phrases listed, person ticks).

### 4. Speak each phrase in the character's voice

`Voices.speak({ voiceId, text, seed })` per swapped phrase, into the session folder (cached by words, voice, seed, so
"say it again" is cheap). Then fit it to its slot (pure `fitPhrase`, tested):

- slot = the phrase's original span; it may start up to 0.10 s early and end up to 0.40 s late when the gap allows,
  never overlapping the next phrase;
- tempo = generated length / slot length. Within 0.88 to 1.12: `rubberband=tempo=x:formant=preserved` (a light
  stretch; Matthew rejected the heavy 0.60 `atempo` stretch as robotic, so we never go past 12%);
- outside that: say it again with seeds 41, 141, 241 (VoxCPM's natural pace varies by seed), keep the one nearest 1.0,
  then clamp the stretch to 12%. Still too long: it overruns into the gap and the phrase is flagged ("runs 0.4 s long:
  shorten the words or say it again"). Still too short: it starts on the original start and ends early (the mouth
  closes early, which reads naturally). Words are never cut.
- loudness of each new phrase matched to the original phrase on the vocal stem (RMS over the span, then a limiter).

**Character with no voice**: the person tile offers "Keep the original voice" (default for a picture with no
character, and for a character with no `voiceId`) or "Use a voice…" (any voice from Audio → Voices). If the character
has a `voiceNote` in their bible, a "Make a voice from 'soft Bristol West Country voice'" button opens Voices' design
with it filled in. Nothing is designed or cloned silently.

### 5. Mix the new track

ffmpeg, one filter graph built by a pure, tested function, output 48 kHz stereo WAV exactly `frames / 24` s long
(the padded length `prepare()` uses):

- **With the split**: background stem + original vocal stem with each swapped span removed (gain to 0 with 40 ms
  fades, span widened 60 ms each side) + the new phrases placed at their fitted times. Room sound and music carry on
  under the new voice; other speakers keep their own voices.
- **Simple mix (no split)**: the original track ducked to -30 dB under swapped spans (80 ms fades) + the new phrases.
  Honest label, see above.
- The new voice is dry (VoxCPM2 clones the reference's own acoustics, and Theo's reference is clean). Matching the
  room's reverb is a later improvement, not in this step.

Check built in, no ears needed: Whisper hears `voice.wav` again; each swapped phrase must read back as its intended
words (Whisper large-v3 turbo, small word-error allowed), and a phrase that fails is said again once with a new seed.
Results go on the session for the UI and MCP.

The session gets:

```
voice: { on, mode: 'split' | 'simple', people: [{ index, voiceId, name }], phrases: [{ start, end, text, swap,
         person, file, seed, tempo, at, warn, heard }], vocals, background, track, sourceKey, madeAt }
```

`sourceKey` is the hash of `source.mp4`; a new prepare (new section, soft mouth on or off) throws the voice away.

### 6. Render with the new track

`remakeGraph()` gets an optional `audio` (a ComfyUI input file name). When given, the graph adds
`aud: LoadAudio(voice.wav)` and wires `RemakeConditioning.audio` to it instead of `['8', 1]`. No video re-encode, no
change to the node. `render()` stages `voice.wav` next to the source and records `voice: true` and the track's hash in
the job's plan. Rebuild uses Remake only for its painter, so this graph change doesn't touch it; Rebuild gets its own
voice swap (see "Rebuild: the voice too" below).

### 7. The final file: H3's sound or the new track?

The new track laid back on. H3 held the audio clean, so its output sound is only `voice.wav` squeezed through its
32 kHz audio VAE: same timing, lower quality. `finalFile()` muxes the take's trimmed picture with `voice.wav` trimmed to
`n / 24` s. The plan records `sound: 'voice track'`. (Verified in step 2 by checking the take's own sound lines up with
`voice.wav` at zero offset; if it ever doesn't, we keep H3's.)

## Will the lips follow the new voice?

Likely, not certain. Two signals drive the mouth in a Remake take: the held audio (H3 is a joint audio-video model,
and a held voice track moved the mouth in the Geiru test) and `<Video 1>`, the source, whose mouth says Tess's
words. Because each new phrase sits in the same time span as the old one, even a take that copies the source mouth
opens and closes at roughly the right moments. Exact lip shapes need the audio to win.

So the step 2 test is an A/B on the Tess → Theo clip (same painted frames, same seed):

| Take | Source | Sound in |
| --- | --- | --- |
| control | as is | Tess's track (today's Example) |
| A | as is | Theo's new track |
| B | soft mouth | Theo's new track |

Measure: correlation between mouth-region motion (from `mouth_track.py --motion` on the take) and the speech envelope
of the track it should follow; B should beat A if the source mouth is fighting the audio. Then Matthew watches A and
B. The result sets the default: if B wins, ticking "Swap the voice too" also ticks Soft mouth (it must be chosen before
painting, because it changes the prepared source).

## Alternative: the voice as an H3 reference (Matthew asked, 2026-11-21)

H3 itself can take a voice clip as a reference. ComfyUI's `MiniMaxH3ReferenceToVideo` has `ref_audios`: each clip is
encoded by the audio VAE into an `{kind: 'audio', audio_latent}` block and named `<Audio j>` in the prompt
(`comfy_extras/nodes_minimax_h3.py`). IV Studio already uses this in Sequences (`voice_ref`) and Refine faces.
`RemakeConditioning` builds the same kind of reference blocks itself, so it can take one too:

- `nodes.py`: an optional `ref_audio` input, added as an audio block plus an `<Audio 1>: ` label in the text, the way
  the stock node does it.
- The catch: today Remake holds the whole soundtrack clean, so H3 never makes any sound and a voice reference would
  change nothing. For H3 to speak in Theo's voice, the audio has to be generated where Theo talks. So the node also
  gets an optional list of time spans (the swapped phrases from Whisper) where the audio's `noise_mask` is 1 (made new)
  instead of 0 (kept). Outside the spans the room, the music and other speakers stay exactly as they were.
- The prompt gets the words, with times, in H3's dialogue form
  (`<Subject 1>, in the voice of <Audio 1>, says: <d>[English] ...</d>`), so H3 knows what to say.

What it would gain over the VoxCPM2 track: lips and voice made together (the most natural sync H3 can give), the voice
sitting in the room's own sound, and no splitter needed.

What speaks against making it the main path:
- Remake's LoRA was trained only with the soundtrack held clean; it never learned to make sound. How well the merged
  model still speaks is unknown.
- Earlier evidence is mixed: in the Geiru tests (2026-11-10) a raw `ref_audios` voice and Tess's voice RefMod both
  said the line and then kept babbling through the rest of the window (6 failures in a row); her LoRA voice and a
  supplied VoxCPM2 track worked.
- No listen-before-render: the words and voice are only heard after a few minutes of render, and a bad read means a
  whole new take.
- Seams where made sound meets kept sound, and the voice's likeness depends on a short reference clip.

So it goes into the step 2 test as a fourth take, and wins only if Matthew prefers it:

| Take | Source | Sound in |
| --- | --- | --- |
| C | as is (or soft mouth, whichever won A/B) | Tess's track kept outside the spans, made new inside them, Theo's voice clip as `<Audio 1>`, words in the prompt |

Checks for C: Whisper large-v3 hears exactly the source words in the spans and nothing extra (the babble failure),
speaker likeness by ear, and the seams. If C wins, the UI stays the same; Step 4 then shows "H3 voices it during the
render" instead of a track to listen to, and the VoxCPM2 track stays as the fallback.

A middle way, if C sounds right but slips on words: hold the VoxCPM2 track as the start of the spans and let H3
redraw it only part of the way (a mask between 0 and 1), with Theo's clip as `<Audio 1>`, so H3 re-performs a line
it already has. Only worth trying after C.

## Rebuild: the voice too (Matthew, 2026-11-22: "You gotta make sure that it can be rebuilt with their voice too")

Status: speech built locally (Matthew: "Yes, build it", 2026-11-22), not committed, not run for real yet. Singing
is not built: a sung source still gets the speech pipeline, so don't voice a song until a converter is chosen.
Asked for by the Example pop-ups session after its Rebuild example (Tess singing, rebuilt with Theo) kept Tess's voice.

Built:
- `remakevoice.js`: the voice swap now runs on a host (`remakeHost` for Replace, `rebuildHost` for Rebuild), so the
  same steps cover a whole rebuild; `mix` also writes the voices alone (`voices.wav`, no room sound) for the shots.
- `rebuild.js`: the swap keeps `voiceId` / `name` (a voice change repaints no frames and keeps the approvals),
  `setSwapVoice`, `makeVoice`, `setPhrase`; `makeShots` makes the voice first when it's missing, gives each talking
  H3 shot its piece (`shotVoicePiece` / `shotVoiceArgs`) as `voiceLine` and its words in the prompt (`voicedPrompt`),
  and renders a talking shot again when its take was made for another voice; `firstCut` puts the new track on A1 and
  warns about kept shots where the new voice talks (`keptWithVoice`) and takes made before the voice.
- The Rebuild page: a "The voice" step after the plan (voice picker, then the shared `VoiceLines` panel that Replace
  now uses too). IPC `rebuild:setVoice`, `rebuild:voice`, `rebuild:setPhrase`.
- MCP: the swap takes `character` (face, name and saved voice) or `voiceId`; new `rebuild_voice`;
  `rebuild_first_cut` says what A1 is.
- Checks: `test/rebuild-voice.mjs` 7/7 (in the CI list; includes cutting a shot's piece with the bundled ffmpeg and
  `makeShots` against stand-ins), the whole CI list plus rebuild and mcp-rebuild 85/85 on scratch data, MCP tools
  build, window test copy: Rebuild voice step 12/12 at 1440 and 390, Replace 12/12.

### How Rebuild treats sound today (`src/service/rebuild.js`)

- A swap is `{ ask, picture }`, painted into each H3 shot's first and last frames.
- Each H3 shot renders in frames mode through `generatePreviews` with no voice line, so H3 makes its own sound and
  the lips follow that. The take is longer than its slot (`h3Length`, up to 1.25x) and is played faster in the cut
  (`retime`).
- `firstCut` mutes every shot's own sound and lays the source's original sound on A1, with the warning "Replace it
  before you publish". So the new person ends up with the old voice, and lips drawn to sound nobody hears.

### The design: one new voice track for the whole film, each shot's lips driven by its piece of it

1. **The voice.** The swap gets the same voice choice as Replace: `swap.voiceId` (or `swap.character`, which gives
   the face picture and the saved voice together). Keep the original voice stays possible.
2. **One track for the whole source** (up to Rebuild's 120 s), made by the same `remakevoice.js` steps as Replace:
   split, timed Whisper (it already reads 30 s at a time), who says each line, VoxCPM2 in the character's voice
   fitted to each line's span, mix, Whisper read-back. Who talks uses the source's own frames, shot by shot. The
   difference from Replace: the track covers the whole film, not one 14 s clip, and Rebuild's per-shot `reading`
   already knows the shot boundaries. Made after the plan is approved and before the shots render, with the same
   listen-before-render list (lines, words, Say it again).
3. **Each H3 shot gets its piece as a voice line.** `generatePreviews` already takes `voiceLine`, the input
   `speak_line` uses and the one that made Tess's lips follow a supplied track in the Geiru tests. For a shot:
   - take the voice-only stem of the new track (new lines plus other people's original lines, no room sound) from
     the shot's start for its slot length;
   - stretch it to the take's length (rubberband, the inverse of the speed the cut will play the take at), so that
     when `firstCut` speeds the take up, the mouth lands back on the real timing;
   - a short shot (`trimTo`) gets its piece at its real speed, padded with silence to 5.17 s;
   - the prompt gets the shot's words in H3's dialogue form, as Replace's take C does.
   The stretch can reach 25% here, but only H3 hears it: the film's sound is the unstretched track.
4. **The first cut.** A1 becomes the new full track (room sound and music kept, under the new voice) instead of the
   original guide, and the warning changes: "A1 is the new voice track". V1's own sound stays muted, as now.
5. **Shots that aren't remade.** A Keep or Still shot where the swapped person talks would show the old face with
   the new voice. `firstCut` lists them ("Shot 3 keeps the original footage, but its words are now in Theo's
   voice"), and the plan step suggests H3 for those shots.

Code: `rebuild.js` (`swap.voiceId`, a `voice` step, `voiceLine` per shot in `makeShots`, A1 in `firstCut`),
`remakevoice.js` (its steps take a whole source and its shot list, not only a Remake session), the Rebuild page,
and the MCP tools `save_rebuild_plan` / `make_rebuild_shots` / `rebuild_first_cut` (plus a `rebuild_voice` like
`remake_voice`). Tests: the voice line per shot (slice, stretch matching `retime`, short shots), A1 in the first
cut, the kept-shot warning.

### Singing (the Rebuild example is a song)

VoxCPM2 speaks; it doesn't sing. Saying the lyrics in Theo's speaking voice over the music would sound wrong. What a
song needs is the original sung vocal turned into the new voice, keeping the melody and timing exactly: singing
voice conversion. The vocal stem from the split is its input, so the rest of the plan (who sings, the voice line per
shot, A1) stays the same. The options:

| Option | Licence | What it needs | Fit |
| --- | --- | --- | --- |
| RVC (RVC-Project) | MIT | a voice model trained on about 10 minutes of the character's voice, per character | best known for singing; a training step per voice (Tess and Theo have only short clips) |
| OpenVoice v2 (MyShell) | MIT | the saved voice clip, no training | made for speech; how it holds up on singing is untested |
| Seed-VC (Plachtaa) | GPL-3.0 | the saved voice clip, no training, has a singing mode | the closest fit, but GPL: only as an optional install the person adds, never shipped with MIT IV Studio (as with Geiru) |
| H3 itself (take C) | | the voice clip as `<Audio 1>`, lyrics in the prompt | untested for singing; it babbled on speech in the Geiru tests |

Recommendation: build speech first (it covers talking clips in both Replace and Rebuild). For a song, Rebuild
detects singing (the reading's music level plus long sung vowels in the vocal stem, and the person can say so) and
offers "Keep the original singing" until a converter is chosen. Then test OpenVoice v2 and RVC on the Tess song
with Theo's voice and pick one by ear. That needs Matthew's OK for the installs and GPU time, and a decision on
whether a per-character training step (RVC) is acceptable.

## UI (RemakeFlow.jsx)

- **Step 2, Who goes in**: under each person tile, a voice line: "Voice: Theo's voice ▾" with Keep the original
  voice / Use a voice… / (a character's own voice). On by default when the character has a voice. `remake:faces`
  returns `voiceId` and `voiceName`. Turning it on also ticks Soft mouth when step 2's test says so.
- **New Step 4, The voice** (between the painted frames and Remake it), shown when a voice is swapped:
  - made automatically right after the frames are painted (ComfyUI is idle then, and the voice engine frees ComfyUI's
    memory first, as it already does), so it's ready by the time the frames are checked;
  - a player for Original and New, and a list of phrases: time, words (editable), "Theo says this" tick, play
    original, play new, Say it again, and any warning ("runs 0.4 s long");
  - "Make the voice again" after edits; the mode in one line ("Room sound kept" or "Room sound dips while Theo
    talks").
- **Remake it**: if the voice is on but not made yet (painting skipped by own pictures, say), Swap them makes it
  first, as it already writes the prompt first. Listening is offered, never required.
- Runs show "with Theo's voice" on takes rendered with a voice track.

Main process: `remake:voice` (make or remake), `remake:setPhrase`, `remake:voiceProgress` events; preload adds them
under `window.ivstudio.remake`. `Remake` gets `voices` and `comfy` in its constructor (both already exist in main and
the MCP server).

## MCP tools (src/mcp/server.js)

- `remake_paint`: new optional `character` (fills picture, name and voiceId from the character) and `voiceId`, and
  `voice: 'swap' | 'keep'` (default swap when a voice is known). The description says the voice is swapped too.
- New `remake_voice`: `session`, optional `phrases: [{ index, text?, swap?, seed? }]`. Makes or remakes the voice
  track and returns the phrases with start, end, words, who, fit warnings and what Whisper heard back, plus the track
  path. Agents can't listen, so the read-back is their check; the description tells them to show the person the track
  before rendering.
- `remake_render`: new `voice: boolean`, default true when the session has a voice track; it makes the track first if
  the session wants one and it isn't made.
- `voice_status` is unchanged; Replace's check reports the voice engine and the splitter.

## The prompt writer

`write()` is told the words and who says them ("Character 1 (Theo) speaks: 'Honestly...' 00:01.200-00:03.900"), so
`detailed_description` can say when Theo talks. The Viggle guide's "the soundtrack is unchanged" wording stays: the
audio is held clean either way, and the text barely matters to the sound.

## Tests (repo style)

- `test/remake-voice.mjs` (pure, in the CI list): phrase building from segments plus silences (splits, phantoms,
  padding ignored); attribution from per-face mouth motion; `fitPhrase` (in-range stretch, re-roll, clamp, overrun
  and short cases, no cut words); the mix filter graph for split and simple modes (spans, fades, exact length);
  `remakeGraph` with and without `audio` (LoadAudio wired, `['8', 1]` gone); `finalFile` lay-back arguments; the voice
  thrown away when `sourceKey` changes.
- Same file, with the bundled ffmpeg: a synthetic source (tone "voices" over pink noise) through the real mix; RMS in
  each span proves the old voice is gone and the background stays.
- `test/remake.mjs`: existing graph checks still pass untouched (the default graph is byte-identical).
- `test/mcp-voices.mjs` / a new MCP case: `remake_voice` and the new `remake_render` argument in the built server
  against a stand-in voice engine.
- `test/remake-voice-real.mjs`: skipped unless the voice engine and ComfyUI are up, like `image-graphs.mjs`.

## Checking it for real on this PC

A scratch test copy with **both** `IV_STUDIO_DATA` and `IV_STUDIO_USER_DATA` pointing at a scratch folder; the
voice engine (12 GB) borrowed by a junction and removed with `rmdir` after; ComfyUI pointed at the live 8188 only for
the steps Matthew approves. Never the real IV Studio window.

1. **Voice only** (about 1-2 GPU minutes, ask first): the Tess pottery clip → split, hear, Theo's voice, mix. Send
   Matthew before and after WAVs. Pass: Whisper reads back the source words; each phrase starts within 0.15 s of the
   original; loudness within 2 dB; room tone present in the gaps (split mode).
2. **Render A/B** (two takes, about 3 min each at 124 frames on the 4090, ask first): the table above, reusing the
   Example's painted frame with `remake_use_picture`. Decode, frame and audio QA, the mouth-motion numbers, then
   Matthew watches.
3. **App window** in the test copy: Step 2 voice choice, Step 4 list, Say it again, Swap them making the voice first,
   1100x720 and 1440x900 fits, no console errors.

## Decisions for Matthew

1. The voice splitter: kijai's Mel-Band RoFormer on ComfyUI (recommended, once its licence checks out), or Demucs in
   the voice engine.
2. Voice swap on by default when the character has a voice (recommended), or off.
3. OK to run the step 2 checks (voice-only, then takes A, B and C, about 3 min each) on your GPU when we get there.

## Not in this change

- The Qwen Image 2.1 painter bug (`resolveModel` in `setup.js` picking `qwen3vl_4b_fp8_scaled` for
  `qwen3vl_8b_int8_convrot`): separate fix.
- Matching the room's reverb on the new voice; new words for a scene ("say something else") beyond editing a line;
  clips longer than one Remake (14.3 s).
