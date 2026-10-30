# IV Studio artwork: the closed eye (Incognito)

While Incognito is on, IV Studio's eye art is shut: the page banners and the foot of the sidebar show
`src/renderer/src/assets/eye-closed.webp`, and the title bar shows `iv-mark-closed.png`.

## The banner art (2026-10-29)

- Local ComfyUI on Matthew's RTX 4090, free, the same pipeline as IV Chat's and IV Downloader's art: Flux.2 Klein 9B,
  `qwen_3_8b` text encoder, `flux2-vae`, 4 steps, euler, 1536 × 800.
- Reference: IV Studio's own `eye.webp`, passed in as a reference latent, so everything around the eye stays the same.
- Prompt: `closed-eye-prompt.txt`. The exact graph: `closed-eye-workflow-seed-101.json`.
- Seeds 101, 202 and 303 were rendered; 101 was picked because its eye sits exactly where the open one does and its
  lashes read at banner size. Master: `closed-eye-master.png`; the app copy is resized to the original's 1400 × 737
  (WebP, quality 88). Raw outputs are in `F:\ComfyUI\ComfyUI\output\IV-Studio\`.

## The title-bar mark

`make_closed_mark.py` builds it from `iv-mark.png`'s own pixels: the logo's real outer outline below its middle (the
shut lid), lifted to sit across the eye's middle, with five lashes at the outline's own stroke width. The iris is
left out.

    python docs/art/make_closed_mark.py src/renderer/src/assets/iv-mark.png src/renderer/src/assets/iv-mark-closed.png

## Each page's own banner (2026-10-29)

Matthew asked for every page to have its own version of the eye art. Create keeps the eye; every other page swaps
the eye for its own subject in the same style (`src/renderer/src/assets/pages/<page>.webp`, chosen by `<Hero art>`).
Incognito still shows the closed eye on every page.

- Same recipe as the closed eye: Flux.2 Klein 9B with `eye.webp` as the reference latent, 4 steps, 1536 × 800, local
  and free. `page-art.mjs` holds each page's subject and the prompt, and renders seeds 101, 202 and 303.
- Picks (seed): shots 101 (clapperboard), sequences 202 (curling filmstrip), edit 101 (scissors through film),
  workflows 202 (cogs), shinobi 303 (katana), replace 202 (two masks), sizzle 202 (lit match), characters 101 (cameo
  profile), loras 101 (lens), cloud 202 (storm cloud), settings 202 (crossed wrenches), library 202 (fanned
  photographs), voices 101 (lips), lines 202 (ribbon microphone), music 101 (record player).
- Settings and Library were rendered a second time with new subjects; a dial knob and a stack of film cans didn't
  read at banner size.
- The app copies are 1400 × 737 WebP (quality 86), the eye's own size. Raw outputs are in ComfyUI's
  `output\IV-Studio\page-art\`. `page-art-banners.jpg` shows every page's banner in the app.
