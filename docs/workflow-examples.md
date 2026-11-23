# Workflow examples: design (for review, nothing built)

Request (Matthew, 2026-11-21): "the workflows, instead of having kind of like pictures, they need to have examples, you know, like replace, can show like video of one side and the person replaced in a very cool way. Like maybe we just add a button that does a pop-up that just says example and kind of like explains it and shows what it does."

Branch `claude/workflow-examples` from `origin/main` 36628a7 (1.1.24), worktree `C:\Users\Matthew\iv-studio-examples`. No code, renders or media changes yet.

## 1. What the person sees

Every card on Workflows (Replace, Sequences, Sizzle, Effects, Reel, Music video, Keyframes, Animal Cam, Shinobi, Rebuild) gets a small **Example** button in its bottom-right corner, beside the "Needs" line. The card art stays as it is; the example is extra, not a replacement for the art.

Clicking Example opens a pop-up:

```
┌──────────────────────────────────────────────────────────────┐
│ EXAMPLE                                       REPLACE      ×  │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │                                                          │ │
│ │        the example media (see section 2)                 │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│ One plain paragraph: what went in, what IV Studio did,       │
│ what came out, in the words of the example on screen.        │
│                                                              │
│ Made in IV Studio on one PC.          [ Close ]  [ Try it → ] │
└──────────────────────────────────────────────────────────────┘
```

- Title "Example" (the house `h2`), the workflow's name as the pink mono kicker.
- One paragraph that explains this example, not the tool in general (the card already does that). Example for Replace: "This shot was rendered in IV Studio. Replace painted snow into one frame, and H3 carried it through the whole clip: same camera move, same walk, same sound. Drag the line to compare."
- **Try it** opens the workflow's page (`go(page)`), the same as clicking the card. **Close**, ×, Esc and the backdrop close it.
- A one-line honesty note under the media: "Made in IV Studio on one PC" plus, where true, the render size (for example "864 × 480 draft"). No claims about speed or quality beyond what the clip shows.

### Card markup change (needed)

Today the whole card is a `<button>`. A button can't hold another button, so the card becomes a `<div className="workflow-card">` with:

- the existing contents inside one full-card `<button className="workflow-open">` (stretched over the card, so a click anywhere still opens the page, exactly as now), and
- a separate `<button className="workflow-example">Example</button>` placed on top in the corner.

Tab order per card: open the workflow, then Example. Hover and focus styles stay on the card (`:has(:focus-visible)`).

## 2. The right example for each workflow

Three media kinds, chosen per workflow in `workflows.js`:

- **compare**: two videos playing in sync with a draggable wipe line (Before / After labels). The line sweeps across once when the pop-up opens, then follows the pointer or the arrow keys (it is a `role="slider"`, 5% per arrow press, Home/End to the edges).
- **steps**: what went in, then what came out, shown left to right with a small arrow between: a photo or screenshot or row of pictures, then the resulting clip. On narrow pop-ups the steps stack.
- **video**: one clip, with a strip of labels under it that light up as the video plays (shot names for Sequences, song parts for Music video).

| Workflow | Kind | What it shows |
|---|---|---|
| Replace | compare, with a two-tab switch "Swap a person" / "Change the scene" | Left: the source shot. Right: the same shot with a different IV character in it (swap), or the snow version (change the scene). The wipe is the "very cool" part Matthew described. |
| Sequences | video + shot strip | A 3-shot scene rendered as one unbroken take; the strip names each shot as it plays. |
| Sizzle | steps | A screenshot of infinitevariance.ai, then about 12 s of the sizzle film made from it. |
| Effects | steps | One photo, then the 5 s clip made from it with one effect. |
| Reel | video (sound) | About 10 s: pictures cut on the beat of a song, with the slow move on each. |
| Music video | video (sound) + parts strip | About 12 s across a verse-to-chorus change: two or three scenes, the cast singing along. |
| Keyframes | steps | The row of 3 pictures, then the one video that moves through them. |
| Animal Cam | steps | Pet photo, then the reference sheet, then the phone-style clip (vertical). |
| Shinobi | steps | A strip of 4 to 5 raw clips, then about 10 s of the edit Shinobi cut from them. |
| Rebuild | compare | The original video and the rebuilt one side by side, same timing. |

Sound: no example ever plays sound by itself. Clips start muted (or paused under reduced motion) and have a "Sound on" button; Reel and Music video put that button front and centre because the song is the point.

## 3. Where the example media comes from

Rule: everything shipped must be IV's own material (IV characters such as Tess, Matthew's own site and trailer, the made-up Animal Cam cat), because the examples ship inside a public, MIT-licensed installer. That rules out the existing one-click character swaps in `output/h3_oneclick_swap` (the source footage is not ours) and the client sizzle (santacorky.com).

### Already exists (no render needed)

| Workflow | Source (Matthew's PC) | Notes |
|---|---|---|
| Replace, "Change the scene" | `%APPDATA%\IV Studio\remake\fbb6e770\source.mp4` and `fbb6e770_s1007_00001_.mp4` | 5.2 s, 864 × 480, the snow version. Already public on /studio as studio-scene-before/after. |
| Sequences | `F:\ComfyUI\ComfyUI\output\H3\sequences\kitchen_letter_407c393b_shots_final_20261028_154206.mp4` | 19.3 s, 1056 × 608, Tess at the kitchen table, looks good. Trim to about 12 s. |
| Sizzle | Shinobi render of sizzle 447338b8 (infinitevariance.ai), `%APPDATA%\IV Studio\shinobi\projects\sizzle-447338b8\.openkatana\jobs\4847fb46…\render\video.mp4`, plus the site capture in `sizzle\447338b8\site` | 33.9 s at 1920 × 1088; use a 12 s excerpt. Which of the four renders is the kept one needs Matthew's pick. |
| Keyframes | `F:\ComfyUI\ComfyUI\output\H3\final\tess_at_the_mic_keyframes_c6d4e62a_r1_20261118_054107.mp4` | The one-take Keyframes test. The 3 input pictures still need finding (or grabbing the matching frames). |
| Animal Cam | `IVAI\output\animal-cam-test\test-pet-photo.png`, `sheet-flux3.png`, `pepper-leg-day-phone.mp4` | Matthew approved these clips on 2026-11-20. 10.1 s, 1080 × 1920; trim to about 8 s. |
| Effects (maybe) | `F:\ComfyUI\ComfyUI\output\iv_studio\fx_exp\transitions_00001_.mp4` | 5 s, Tess at the bus stop bursting into light. Usable; its input photo needs finding. The cakeify test (`effects_00001_`) looks rough and is not proposed. |
| Rebuild (maybe) | `%APPDATA%\IV Studio\rebuild\fcb70aba` ("dual_role live check") | Still at "editing". Usable only if Matthew confirms the source video is his own. |

### Needs a new render or cut (all local, free, but uses the GPU; nothing starts without Matthew's OK)

| Workflow | What | GPU? | Estimate on this PC |
|---|---|---|---|
| Replace, "Swap a person" | Replace on an IV-owned shot (for example the Tess kitchen shot) with another IV character. Matthew asked for exactly this. | Yes: picture model for the painted frame, then H3 | 15 to 25 min including one retry |
| Music video | A real 2 to 3 scene Music video over a verse-to-chorus change, with a song already in his Music library | Yes: H3 per scene | 25 to 40 min (about 5 to 8 min per scene with a hunt and a finish) |
| Reel | 6 to 8 existing Tess stills cut to an existing song | No (ffmpeg only) | About 2 min of compute |
| Shinobi | A one-click style cut over 4 to 5 existing Tess finals | Light (Shinobi's engine) | 5 to 10 min |
| Effects (only if the existing clip is not good enough) | One Tess photo, one effect (for example the 360° orbit) | Yes | 5 to 10 min |
| Rebuild (only if the existing source is not his own) | Rebuild a short IV-owned clip (for example 10 s of the IV Studio trailer) | Yes: agent plan plus H3 per shot | 40 to 60 min |

Minimum GPU time if the "maybe" rows are usable: about 40 to 65 min (Replace swap and Music video). Worst case with Effects and Rebuild redone: about 2 hours. Every render is checked by eye (frames and a listen) before it is used, and the result is shown to Matthew before it goes into the app.

## 4. Files, sizes and how they ship

- Each example: H.264 MP4, no longer than 12 s, short side 480 to 720 px, CRF about 26, AAC 96 kb/s only when the sound matters, `+faststart`; plus one WebP poster (the first frame) and any still inputs as WebP at 960 px wide.
- Budget: about 1.5 to 3 MB per example, **25 MB in total**, enforced by a test. The installer today is about 204 MB, so this is about +12%.
- Encoded by one script, `scripts/make-examples.mjs`, from a manifest of source path, in and out points and crop, using the ffmpeg IV Studio already ships (`ffmpeg-ffprobe-static`). The shipped manifest (`resources/examples/examples.json`) holds only file names, durations, sizes and SHA-256; the source paths on Matthew's PC stay in the IVAI project notes, not in the public repo.

**Recommendation: bundle them in the installer** under `resources/examples/` (copied by the existing `extraResources` rule, outside app.asar so video seeking works) and play them through the existing `ivfile://` handler.

Why not download on demand: IV Studio works offline, the files are small, and electron-builder's differential updates mean unchanged example files are not downloaded again on each update. Download on demand would add a host, a cache, a failure state and a "this example could not load" path for 25 MB. If the budget ever grows past about 50 MB, revisit.

## 5. Keyboard, focus, motion, small windows

- **Focus**: opening moves focus to **Try it** (as What's new does with Got it). Tab and Shift+Tab stay inside the pop-up. Esc, ×, Close and the backdrop close it, and focus goes back to that card's Example button. `role="dialog"`, `aria-modal="true"`, labelled by the "Example" heading and described by the paragraph.
- **Videos**: play only while the pop-up is open and the window is visible; they pause and unload on close (`src` removed) so nothing keeps decoding in the background. Each video has a text alternative (the paragraph) and the compare slider announces "Before 40%, after 60%".
- **Reduced motion** (IV Studio's own Reduce motion setting or the system one, via `reducedMotion()` in `a11y.js`): nothing autoplays, the wipe does not sweep (it sits at the middle), the steps do not animate in; each video shows its poster with a Play button. Hover zoom on cards is unchanged.
- **Small windows**: the main window's minimum is 1100 × 720. The pop-up is `min(880px, 92vw)` wide and at most 90% of the window high; the media box takes what is left after the heading, paragraph and buttons and keeps its aspect ratio with `object-fit: contain`, so nothing scrolls at 1100 × 720. Vertical clips (Animal Cam) sit in a narrow column with the paragraph beside them when there is room, stacked when not. Checked at 1100 × 720, 1380 × 900 and 1920 × 1080, chat panel open and closed.

## 6. Code shape (for step 2)

- `src/renderer/src/workflows.js`: each workflow gains `example: { kind, text, media, strip? }`. New workflows without an example simply show no Example button.
- `src/renderer/src/components/WorkflowExample.jsx` (pop-up, the three kinds, the compare slider) and its styles in `studio.css` beside the existing workflow card rules.
- `Workflows.jsx`: the card markup change from section 1 and the open/close state.
- Main: one small `examples:dir` answer (or reuse `app:info`) so the window knows where `resources/examples` is in a packaged and an unpackaged build.
- Tests in the repo's style: `test/workflow-examples.mjs` (every workflow has an example, every referenced file exists, the 25 MB budget, durations within 12 s by ffprobe, no em dashes in the paragraphs, Try it maps to a real page) and a run in a test copy (IV_STUDIO_DATA and IV_STUDIO_USER_DATA both on a scratch folder): open each pop-up, play, wipe by keyboard, Esc returns focus, reduced motion shows posters, Try it opens the page, fits at 1100 × 720, no console errors.
- Nothing for agents or the MCP server: the examples are for people. (Optional later: a "Workflows → Example" place in the tours so `show_in_app` can point at it.)

## 7. Decisions for Matthew

1. Approve the pop-up and the per-workflow examples above (or change any row).
2. Bundle in the installer (recommended, about 25 MB) or download on demand.
3. Which renders to run: Replace swap and Music video at least (about 40 to 65 min of GPU, free); Effects and Rebuild only if the existing clips aren't good enough. Also: is the Rebuild "dual_role live check" source video your own?
4. Which of the four infinitevariance.ai sizzle cuts to use.

## 8. Build status (2026-11-21, approved by Matthew: "Approve, run renders")

Built on `claude/workflow-examples`, not committed.

- Code: `workflows.js` (an `example` per tool; Rebuild has none yet, so no button), `components/WorkflowExample.jsx` (new), `components/Workflows.jsx` (card is a box: a stretched open button plus Example), `studio.css` (card and pop-up styles), `src/main/index.js` (`examplesDir` in `app:info`), `scripts/make-examples.mjs` (new), `resources/examples/` (new media and `examples.json`), `test/workflow-examples.mjs` (new, in `scripts/ci-linux.sh`).
- Media: all IV's own (Tess, Theo, the IV site, the made-up cat). Sources are listed outside the repo, in the IVAI project's `docs/workflow-examples/sources.json`.
- New renders on scratch data (this PC's ComfyUI, free): Replace swap (Tess to Theo in the pottery studio, 6.6 s; the keyframes were painted with Flux 3 Klein because Remake's Qwen Image 2.1 painter got the wrong text encoder on this PC, see below) and a 2-scene Music video on the /studio song "Make the film". Reel was cut with IV Studio's own Reel (no GPU). Sizzle and Shinobi are two stretches of the same infinitevariance.ai sizzle (Shinobi cut it).
- Found while rendering, not fixed here: `resolveModel` in `src/service/setup.js` picks the first of a model's names that ComfyUI lists in alphabetical order, so on a PC with both Qwen3-VL files `qwen3vl_8b_int8_convrot` is swapped for its listed alternative `qwen3vl_4b_fp8_scaled`, and every Qwen Image 2.1 job fails in the sampler (`normalized_shape=[4096] ... 2560`, the GitHub #46 error). It should prefer `match` over `alt`.
- Not decided: Rebuild's example (is the "dual_role live check" source Matthew's own?); Keyframes' clip shows a product bottle with a garbled label.
- Music video: ComfyUI hung after scene 1's finish (no answer on 8188 from 08:55, RAM nearly full) and was restarted at Matthew's OK. A restart drops ComfyUI's queue and history, so IV Studio kept both lost jobs as "queued" for good (`refreshJob` only learns an outcome from history or the queue); the two scratch job records were set by hand (scene 1's finished file existed). Scene 2 was hunted again (seed 4242, take 2 of 3 picked) and finished in 267 s. The clip is the assembled edit's 1.1 to 13.1 s, cut at 6.0 s; the strip is "Scene 1" / "Scene 2" (the song's parts aren't labelled verse or chorus).
- Fixed while checking: closing the pop-up didn't let go of the video files, because React has already cleared the refs when the closing clean-up runs; the elements are now remembered while on screen.
- Checks: `test/workflow-examples.mjs` all pass (41 files, 7.5 MB); lint, tours, news pass. Scratch test copy at 1100x720, 1380x900 and 1920x1080: 149 checks pass. The test window was hidden for 11 of the 27 opens; there the check asks for the pause a hidden window should cause, and every example also played while the window was visible. Sound on and the strip were checked separately with the window visible.
- Follow-up worth its own fix: a job lost to a ComfyUI restart stays "queued" in IV Studio forever.
- Not listened to: the Replace swap and the Music video clips.

### Follow-up (2026-11-21, Matthew: "It's all the stuff that's still open. especially the lost job stuff.")

- **Lost jobs fixed** (`studio.js` `lostByComfy`, `LOST_JOB`; `failures.js` rule `lost`): a job in neither ComfyUI's queue nor its history is marked failed, "ComfyUI lost this render", with Try again. History is asked twice (a job finishing between the two answers is not lost). Only the ComfyUI the job went to can say so: new jobs record `server` (the ComfyUI address); a job sent to another address or to the cloud is left alone, and Comfy Cloud is never judged (its queue isn't ComfyUI's). Cancel on a lost job settles it too. A person's own cloud GPU that wakes on a new address keeps its old jobs as they were (the address differs). `test/lost-jobs.mjs` 16 checks (in the CI list), `failures.mjs` covers the new rule.
- **resolveModel fixed** (`setup.js`): a model's names are tried in the manifest's order, so the describer's own `qwen3vl_8b_int8_convrot` beats its stand-in `qwen3vl_4b_fp8_scaled` whatever ComfyUI's alphabetical order. `model-versions.mjs` has the case. Proved on this PC: a Qwen Image 2.1 picture now renders (it loaded the 8B encoder; before, every one failed with GitHub #46's error).
- **Keyframes example replaced**: three new Flux 3 Klein stills of Tess on a harbour wall at sunset (from `tess.jpg`, seed 2611), one H3 take through them (hunt seed 4242, take 3 of 3, finished 8 s), H3's own sound (no speech: Whisper with voice detection hears none). No product in it.
- **One loudness**: `make-examples.mjs` now brings every example with sound to -16 LUFS (loudnorm, two passes); they ranged from -28 (Sequences) to -11 LUFS. `test/workflow-examples.mjs` checks it. All 41 files re-encoded: 8.0 MB.
- **Sound checked by transcript** (not by ear): the Music video clip carries the song's own lyrics in order; the Replace pop-up has no sound by design (its clips are encoded silent).
- **Rebuild**: the old "dual_role live check" source is a rea-video case video, not Matthew's, so it isn't used. A new rebuild (scratch `a954da63`) reads the Music video clip (4 shots, 12 s) and plans each shot again with H3 with Theo singing (character `theo`, swap from `theo.jpg`). Its plan waits for Matthew's OK (`approve_rebuild_plan` is only for after the person says yes), then the frames need his OK too.
- **Rebuild example made** (Matthew: "Yes, render it", "Yes, redo them", "Yes, render them"): scratch rebuild `a954da63` read the 12 s Music video clip (4 shots), swapped Tess for Theo (character `theo`, `theo.jpg`). The first frames put Theo in Tess's slip dress and facing the camera, so the swap request was reworded (cream cardigan over a rust shirt, her pose and head angle) and the frames redone with Matthew's OK. Shots hunted (3 takes each), picks 2/1/2/1, finished, first cut exported. Before/after: `rebuild-before.mp4` / `rebuild-after.mp4`, silent like Replace's compare. Every card now has an example; `test/workflow-examples.mjs` requires it. 45 files, 9.6 MB. Window checks 164/164 (window visible throughout).

### Second pass (2026-11-23, Matthew)

Matthew: Sequences should show the shots back and forth (it was one angle); Effects was not telling; Reel's pictures barely move, "make that pop more, or possibly even get rid of it" (then: "drop Reel"); Keyframes "starts super weird" and should be "like a modeling shot". The other six stay.

- **Sequences:** a new 3-shot kitchen scene (Tess and a man with a letter), one take on scratch data: wide, then over her shoulder to him, then over his shoulder back to her, the camera arcing round the table with no cuts. 30.3 s (the example limit is 32 s for long examples), strip Shot 1 · Both of them / Shot 2 · Him / Shot 3 · Tess. Transcribed: all three lines in place.
- **Effects:** one Codex photo of Tess on a sunny street, then Cakeify, 360° orbit (second seed; the first stopped half way round) and Money rain back to back, 15.2 s, strip with the three names. The Wan 2.1 I2V model and its speed-up LoRA were copied from `D:\ComfyUI-models` after checking their SHA-256 (the download crawled at about 1 MB/s); Money rain and 360° orbit LoRAs came through IV Studio's installer.
- **Keyframes:** four Codex pictures of Tess as a model in a white studio (full length, over the shoulder, hands in pockets, close-up), one Keyframes take (take 2 of 3, hunted at 864 × 480). The example uses the take, not its 2 MP finish: the finish redrew her face (brown eyes, not green; more generic). That is a Keyframes finish problem to look at separately.
- **Reel:** its example and media removed; the card has no Example button. The test lists it as left without one on purpose.
- **Code:** steps examples can have a strip (`Strip` shared by both kinds); `long: true` lets Sequences and Effects run to 32 s (`make-examples.mjs`, the test).
- **Checks:** `test/workflow-examples.mjs` passes; all 86 CI tests and the build pass; in a test copy the three pop-ups play with their strips and Reel has no button.
