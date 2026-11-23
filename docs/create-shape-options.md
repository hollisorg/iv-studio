# Create: Shape and size options (2026-11-23)

Three changes to Create's "Shape and size" step and the H3 finish. Branch `claude/create-shape-options`, from 1.1.25 (`1d04de2`). Not released.

## Same as photo

- In First / last frame mode a **Photo** tile sits before the aspect tiles. It is off until a first frame is added, and its icon shows that picture's shape.
- Picked, the shot is made at the first frame's own shape instead of being stretched to 16:9 or another tile. The note under the tiles gives the photo's size and the take's size (for example `1178 × 2096, made at 480 × 864`).
- Shapes wider than 21:9 (or taller than 9:21) are made at 21:9, the widest H3 has been tried at.
- How: the request carries `photoSize` ({ width, height }); `plan.js` sizes the take from that ratio and writes the exact width and height into every node that reads the ResolutionSelector (`SIZE_NODES`). The request's `aspect` becomes the nearest standard one (`nearestAspect`), so the editor, sequences and the rest still get a known aspect. The finish keeps the shape, because the latent upscaler sizes from the take.
- LTX 2.5 frames shots take the photo's shape too (`ltx.js`). Seedance already follows the picture in frame mode.

## One final (no hunt)

- H3 gets a **How** switch: *Hunt previews* (as before) or *One final*. One final renders one take and finishes it straight away. There are no previews to pick from.
- One final's settings: **Final size** (1, 1.5 or 2 MP; 2 is the default), **Enhancer** (None, DLSS 5 or SeedVR2; None is the default), the first pass size, quality and seed. The speed presets and the previews count are hidden.
- How: the request carries `autoFinish`; `studio.js` keeps it on the previews job (`plan.autoFinish`). When the take finishes, `refreshJob` starts `finishCandidate` once (`autoFinishJob`, or `autoFinishError` if it couldn't start). The main process watches that finish the same way it watches a SeedVR2 enhance step. The finish reuses the take's latent, so the take isn't sampled again.
- The shot page says the run is a One final and shows whether its finish started or why it couldn't.

## No enhancer on the finish

- The H3 Finish panel's Enhancer row has **None** next to DLSS 5 and SeedVR2. None gives the full-size pass as it is, at 24 fps, with no 2× and no extra frames. The row now shows on every ComfyUI; SeedVR2 still shows only where it did before.
- How: `plan.js` accepts `enhancer: 'none'`; `skipsDlss()` covers None and SeedVR2. A finish that skips DLSS has its DLSS node swapped for a plain save (`remote.js adaptGraph`, the same path SeedVR2 finishes and the cloud use), and no enhance step follows it.
- A None final is labelled `Final · take n · 2 MP, no enhancer`.

## The Finish pop-up explains itself

- Matthew (2026-11-23): "under sound, where it says generated ... we need to explain that better on that pop-up in general."
- The pop-up opens with one line on what a finish is (H3 draws the take again at full size; the movement stays the same). Final size, Enhancer, SeedVR2 size, RTX upscale, Frame rate and Sound each have a line under them that changes with the choice.
- Sound's buttons are now **New sound** (was Generated: H3 makes the sound again with the full-size picture, so words and voices can come out a little different), **The take's sound** (was Preview's: the sound of the picked take, exactly as heard) and **My recording**.
- The speed preset note under Final size no longer squeezes into the label column.

## A picture-led finish keeps the face

- Found while remaking the Keyframes example: finishing the studio-shoot take at 2 MP turned Tess's green eyes brown and made her face more generic. The take itself was right.
- Why: the 2 MP pass draws the take again for 2 steps at strength 0.4 (node 25). In First / last frame mode, which Keyframes uses too, its guide is the words alone (node 26 -> 1104 -> 404 -> 205); only the take is guided by the pictures (node 204). With no character LoRA, nothing holds the face, so 0.4 redraws it.
- Measured on the same take (last frame, face at 1:1): 0.4 brown eyes and a different face; 0.2 freckles back but hazel eyes; 0.1 green eyes, freckles and the same face as the take, with coat and knit texture as sharp as 0.4.
- Fix (`plan.js`): a finish of a First / last frame or Keyframes shot with no character LoRA uses `refineDenoise` 0.1 (`FRAMES_REFINE`) unless it sets its own; everything else keeps 0.4. `refineDenoise` (0.05 to 0.6) can also be passed to any finish. A real finish through the default path recorded 0.1 and gave the same graph as the explicit 0.1 run (ComfyUI reused its output).
- Not changed: Continue mode's 2 MP pass is also guided without its source clip (node 611, not 612); nobody has reported a face change there, so it stays as it is.
- Test: `test/frames-finish.mjs` (6 checks, in the CI list).

## Checks

- `node test/shape-options.mjs`: 6 of 6. Covers photo sizing and the size nodes, the aspect fallback outside frames mode, photoRatio and nearestAspect, LTX, the None finish graph (no DLSS node left; node 51 still reports the final), and the One final chain (it starts once, and a failed start is recorded).
- `graph-parity`, `continue-full`, `core-upscaler`, `ltx`, `speed`, `timing`, `keyframes`, `refmods`, `sampler-choice`, `seedance`, `cloudprep`, `comfycloud`, `hardware`, `starters`, `bible`, `words`, `library-facts`, `nodepacks`: all pass. `electron-vite build` passes.
- Test copy (scratch `IV_STUDIO_DATA` and user data, ComfyUI pointed at a dead address) at 1440 and 1100 wide: the Photo tile with a portrait photo, One final with each enhancer, and the Finish panel with None.
- Real render (2026-11-23, this PC's ComfyUI, test copy on scratch data): a 4:5 photo of Tess (768 × 960) in First / last frame with Same as photo, One final at 2 MP with no enhancer. The take (576 × 736) took 88 s; its finish started by itself and took 140 s. Final: 1280 × 1632, 24 fps, 124 frames (5.17 s), h264 with AAC sound; the first frame matches the photo's framing with nothing squashed, and a local transcription reads "This one is finally ready for the kiln.", the line in the prompt. The run card said "being finished" after the final was done; fixed to read the finish's state.
