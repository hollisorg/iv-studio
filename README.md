# IV Studio

A free Infinite Variance desktop app for making MiniMax H3 video on your own PC. It drives your own
[ComfyUI](https://github.com/comfyanonymous/ComfyUI) through the **IV Studio** workflow: write a shot,
hunt a few quick previews, pick the take you like, then finish it at full size with the same motion.

<p align="center">
  <img src="docs/images/create.png" alt="IV Studio's Create page with a prompt for Tess in a parked car" width="100%">
</p>

## How it works

1. **Create.** Pick a mode, a character and write the shot.
   - **Text:** just the prompt.
   - **References:** pictures, videos or audio guide the shot (`<Picture 1>`, `<Video 1>`, `<Audio 1>`).
   - **First / last frame:** the clip opens on a picture and can end on a second one.
   - **Continue a video:** carries a clip on from its last frames.

   Set the aspect, length, preview size and how many previews to hunt (1 to 3). Optional extras:
   a voice recording to lip-sync, RefMods, extra LoRAs and the step count.
2. **Hunt.** IV Studio queues the previews on ComfyUI and shows them as they finish.
3. **Pick and finish.** Choose a preview and set the final size (1, 1.5 or 2 MP), RTX 2× upscale,
   frame generation (30/50/60/120 fps) and the sound source. The finish reuses the preview's
   cached latent, so the motion stays the same and stage 1 doesn't run again.
4. **Shots.** Every shot keeps its runs, previews and finals. **Show in folder** opens the file.

<table>
  <tr>
    <td width="50%"><img src="docs/images/candidates.png" alt="A preview ready to pick"></td>
    <td width="50%"><img src="docs/images/finish.png" alt="The finish panel and a finished clip"></td>
  </tr>
  <tr>
    <td align="center"><sub>Pick a preview</sub></td>
    <td align="center"><sub>Finish it at full size</sub></td>
  </tr>
</table>

## Write it for me

You don't need to know H3's prompt format. Type the idea in plain words, for example "Tess in a
parked car at night admits she kept the letter", and press **Write my prompt**. You get a finished
H3 prompt back to edit, keep or undo. The writer always uses your mode, length, aspect, character
and media, and writes `{char}` where the character goes. Choose the writer under **Settings → Prompt
writer**:

- **Local (free):** a model in [Ollama](https://ollama.com) on your PC, with IV Studio's H3 rule
  sheet. The recommended model is `qwen3-vl:8b-instruct` (about 6 GB, one click to install). It can
  also look at your pictures. It loads only while writing; while ComfyUI is rendering it runs on the
  CPU, so it never takes H3's VRAM.
- **MiniMax Context IR:** MiniMax's own prompt rewriter, run through ComfyUI. It writes in the exact
  format H3 was trained on and looks at your reference media. It's paid through your Comfy.org
  account (about $0.02 a prompt, $0.05 with first/last frames, $0.06–0.11 with reference media).
  Your API key is stored encrypted on your PC.

In a sequence, every shot has its own writer, and **Write all shots from a story** turns a few
sentences into one prompt per shot that join cleanly.

## Sequences

Several shots that play as one continuous video.

- **One take:** every shot renders together in one seamless take through
  [H3 Multishot](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot)'s sampler, so there are no
  cuts, colour shifts or breaks in the sound. You can add a voice sample for the whole take to keep.
- **Shot by shot:** hunt and pick each shot in turn. Each one carries on from the end of the shot
  before. Change a shot and only the shots after it need redoing.
- **Retake:** mark a stretch of any version and redo the picture and sound, the picture only, or the
  sound only. Everything around it stays as it was.
- **Render out:** optional colour smoothing across the joins, then the DLSS pass with RTX 2× and
  frame generation.

Shots are 10 or 15 seconds, the windows H3 Multishot is tested at. Needs the H3 Multishot node pack.

## Edit

A multi-track timeline for cutting shots and sequences together: two video tracks (V2 plays over
V1), a titles track and two audio tracks. Add files from your PC or any IV Studio render (cloud
renders download first), drag clips to move them between tracks, drag their edges to trim, split at
the playhead, delete or ripple delete, and undo or redo anything. Clips snap to each other and to the
playhead. Each clip has a fade in and out and a volume; titles have their own text, size, colour,
position and an optional dark box. The preview plays live, and **Export MP4** renders the whole timeline
with ffmpeg at 1080p, 4K, vertical or square, 24/30/60 fps, into `Videos\IV Studio\Edits`.

Shortcuts: Space play/pause · S split · Delete · Shift+Delete ripple delete · Ctrl+Z / Ctrl+Shift+Z ·
← → one frame (Shift: one second) · Home / End.

## Models

**Settings → Models** picks the main H3 model for each workflow (Text, First / last frame, Continue,
References, Sequences one take and retake) from the H3 models your ComfyUI has, so a fine-tune that
suits realism or animation can be used where it fits. Text, First / last frame and Continue need an
fl2va-type model; References and Sequences need a ref2va-type model, and Settings warns when they
don't match.

## Workflows

The **Workflows** page holds tools that take a video further: **Shinobi** and **Replace**, with room for more.

## Replace

**Replace** swaps who or what is in a video while the camera, cuts, motion and soundtrack stay:

- **Person:** a picture (or one of your trained characters, optionally with their LoRA) replaces the main person.
- **Several people:** 1-4 characters, each replacing someone you describe; one pass per person for two.
- **Object:** change something (hair, a jacket, a car), remove it, or put a new background behind the person.
- **Finish:** redraw small faces at close-up size, or soften H3's look.
- **Check the mask** first shows what will be redrawn, in about a minute.

It runs [OpenJutsu](https://github.com/D3voz/openjutsu)'s ComfyUI workflows (MIT, commit `47c3724`):
SAM 3.1 tracks the people, Qwen3-VL describes the shots, MiniMax H3 redraws the masked area through the
H3 Context Loop. OpenJutsu's mode code is vendored unchanged in `src/service/replace/`; its workflows are in
`resources/workflows/replace/`. It needs OpenJutsu's node packs (the page links any that are missing) and
two models, offered on Setup: SAM 3.1 and the Qwen3-VL 8B describer. Agents use `replace_check`,
`replace_video` and `replace_history`.

## Shinobi

**Shinobi** is IV Studio's agent-driven editor. Where **Edit** is a timeline you cut by hand, Shinobi
lets an agent (or a one-click recipe) author the whole edit in code: cuts on the beat, speed ramps,
punch-ins and camera moves, typography, masks and effects, captions from speech and sound cues, even 3D
scenes. It renders on your PC with the Edge or Chrome you already have and IV Studio's ffmpeg.

- **Set up** once from the Shinobi page (about 440 MB, under a minute, inside IV Studio's own folder).
- **A film:** write a brief, add files or any IV Studio render, and either build a first cut from one of
  12 styles (beat montage, noir portrait, speed ramp and freeze, lyric type…) or copy the brief to your agent.
- **Agents** reach every Shinobi tool through IV Studio's MCP (`shinobi_tools`, `shinobi`), and get
  preview frames back as pictures. Finished renders go into Edit with one click.

Shinobi's engine is [OpenKatana](https://github.com/rk0neki/OpenKatana) by its contributors (Apache-2.0),
installed unmodified at commit `f24f60a`; its licence and notice are in `resources/licenses/`. Shinobi is not
affiliated with OpenKatana or with Higgsfield, whose Katana inspired it.

## Characters

A character is a trained MiniMax H3 LoRA plus its trigger word. Write `{char}` in the prompt where
the character goes. Everything about characters is on the **Characters** page:

- **Your characters:** each with its picture, trigger, strength and LoRA (with a check that ComfyUI has it);
  add one from a LoRA you already have, or delete one.
- **Ready-made:** IV Studio's own invented characters, Tess Marlow and Theo Lindqvist, each shown with one
  face picture (`resources/characters/`). Download one and its LoRA (about 150 MB, from the
  `characters-v1` release of this repo, checked against its SHA-256) goes into ComfyUI's loras folder and
  they join your characters. Agents use `list_ready_characters` and `install_ready_character`.
- **Train your own:** below.

**Train your own** on the **Characters** page, the method that made Tess:

1. **Design:** describe the face; Z-Image Turbo renders four candidates on your PC. Pick one, and it is
   rendered in eight scenes (different places, clothes and light) on the same seed. Keep the most alike.
   Or add your own pictures (only of an invented person, or someone who agreed).
2. **Clips:** H3 renders talking clips from two of the stills and an optional designed voice, or you add
   your own clips. Everything is fitted to Fizgig's rules (24 fps, 17n+5 frames, sides multiple of 32,
   32 kHz stereo). Captions never describe the face or voice, so they bind to the trigger word.
3. **Train:** Fizgig on your own Modal account (`resources/cloud/train_app.py`, B200 or H200), with the
   minutes and dollars shown first; Tess took 29 minutes and $3.80. It keeps training if IV Studio
   closes. Or open the dataset folder and train in Fizgig yourself.
**Likeness:** with InsightFace's face models (downloaded once from the Characters page, 289 MB; the
models are for non-commercial research use), IV Studio scores every still and clip against the picked
face (`resources/python/likeness.py`: InsightFace's SCRFD and ArcFace through ONNX Runtime, the same
numbers as InsightFace's own pipeline) and can keep the closest candidate of each scene.

4. **Pick:** chosen checkpoints are downloaded into ComfyUI's `loras\MiniMax H3\<name>\` and rendered on
   one seed side by side; the one you choose becomes a character at strength 0.8.

Designing needs Z-Image Turbo, its text encoder and VAE (optional downloads on Setup). AI_Characters'
Smartphone Snapshot v8 LoRA (Civitai) is used for a candid phone-photo look when it's installed.

## Setup

**Setup** checks ComfyUI, the GPU, every node pack and every model the workflow needs, using
ComfyUI's own `/object_info`. That way it works with any install.

- **Missing models:** they download straight into ComfyUI's models folder from their upstream
  hosts. Each download is checked against the SHA-256 that Hugging Face publishes before it's put in
  place. A paused or interrupted download resumes where it stopped.
- **Missing node packs:** these link to their GitHub pages.
- **Bundled nodes:** the IV Studio pack (latent cache and shot list) is in
  `resources/comfy-nodes/ComfyUI-IV-Studio`. Copy it into `ComfyUI/custom_nodes`.

<p align="center">
  <img src="docs/images/setup.png" alt="The Setup page" width="100%">
</p>

Requirements: Windows 10 or 11, an NVIDIA GPU (16 GB of VRAM or more recommended; 24 GB tested)
and a ComfyUI recent enough for MiniMax H3. You'll need about 60 GB free for the models.

## Agents (MCP)

IV Studio includes a local MCP server (stdio). It uses the same service, projects and results as
the window, so Claude Code or any other MCP client can do nearly everything a person can: render shots
and sequences, cut them together on the timeline and export, and manage characters and models. The
command for your install is under **Settings → Agents (MCP)**, together with a message you can paste
straight into any agent (it adds the server, reads the guide and checks your setup) and a button that adds
the IV Studio skill to Claude Code. For a development checkout:

```
claude mcp add iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "<checkout>\node_modules\electron\dist\electron.exe" "<checkout>\out\main\mcp.js"
```

Agents are told how to use it in three ways, all from `resources/agent-guide.md`: the server's
instructions on connect, the `get_guide` tool, and the Claude Code skill
([`skills/iv-studio/SKILL.md`](skills/iv-studio/SKILL.md), rebuilt with `node scripts/make-skill.mjs`).

Tools:

- **Guide:** `get_guide`.
- **Shots:** `check_setup`, `list_characters`, `list_projects`, `plan_render`, `generate_previews`,
  `finish_candidate`.
- **Sequences:** `list_sequences`, `get_sequence`, `save_sequence`, `render_take`, `hunt_shot`,
  `finish_shot`, `retake`, `render_out`.
- **Prompt writing:** `write_prompt`, `write_shots_from_story`.
- **Jobs:** `get_job`, `cancel_job`, `get_outputs`.
- **References:** `prepare_media` (crop a picture, trim and crop a video or sound).
- **Library:** `list_renders` (every render, with keys for the editor), `rename_project`, `delete_project`, `delete_sequence`.
- **Edit:** `list_edits`, `get_edit`, `create_edit`, `set_edit_settings`, `delete_edit`, `add_media`
  (files or renders, optionally appended end to end), `edit_timeline` (add, move, trim, split, ripple
  delete, fades, volume, titles, all checked before anything changes), `grab_frame` (a picture of any
  moment, so an agent can check its cut), `export_edit`, `get_edit_export`, `cancel_edit_export`.
- **Character training:** `list_character_trainings`, `get_character_training`, `create_character_training`,
  `update_character_training`, `design_faces`, `pick_face`, `design_scenes`, `pick_still`, `make_training_clips`,
  `set_training_item`, `add_training_files`, `rank_likeness`, `estimate_training`, `start_training` (paid: needs the person's OK and
  `confirm_cost`), `stop_training`, `test_checkpoints`, `adopt_checkpoint`.
- **Shinobi:** `shinobi_status`, `shinobi_setup`, `shinobi_tools`, `shinobi` (any of its 72 tools; pictures come
  back as images), `shinobi_project`.
- **Models and characters:** `list_h3_models`, `set_workflow_model`, `list_choices` (LoRAs and RefMods),
  `save_character`, `delete_character`.

An edit open in the window reloads when an agent changes it, and Ctrl+Z puts the person's version
back. The MCP server always renders on the local ComfyUI (the cloud token stays with the app).

`write_prompt` uses the local writer unless `COMFY_ORG_API_KEY` is set in the server's environment.

## Develop

```
npm install
node node_modules/electron/install.js   # npm 11 skips Electron's install script
npm run build
"Start IV Studio (dev).bat"
npm run dist                           # unsigned NSIS installer in dist/
```

Tests are in `test/`:

- `graph-parity.mjs`: the headless graph matches the ComfyUI GUI export for 32 switch states.
- `service-e2e.mjs`: renders previews and a finish on a live ComfyUI.
- `mcp-smoke.mjs`: runs the MCP server over stdio.
- `mcp-tools.mjs`: drives every editor, library, model and character tool over stdio (temporary data).
- `mcp-live.mjs`: an agent's edit reloads in an open dev window and undoes cleanly.
- `edit-export.mjs`: exports a five-clip edit with the bundled ffmpeg.
- `replace.mjs`: checks every Replace mode against the live ComfyUI, then renders a mask check and a person replace.
- `shinobi.mjs`: installs the pinned engine, builds a beat-cut from a recipe, renders it with Edge, and scores
  likeness against InsightFace's own numbers.
- `training-local.mjs`: designs faces and scenes, renders talking clips and builds a dataset that fits Fizgig's rules
  (local GPU, nothing on Modal).
- `media-prepare.mjs`: crops a picture, trims a video frame-exact and trims a sound.
- `models-download.mjs`: checks a fresh download, a resume and a rejected corrupt file.
- `sequence-graphs.mjs`: renders a two-shot take, a retake and a render out (queues real GPU renders).
- `prompt-writer.mjs`: writes a prompt and a two-shot story with the local writer.

Data (projects, jobs, characters, settings) is stored in `%APPDATA%\IV Studio`. Renders are saved
to ComfyUI's output folder under `H3\`.

## Licences

IV Studio is MIT-licensed (see `LICENSE`). Third-party notices are in `THIRD_PARTY_NOTICES.md`.
The models aren't bundled: each one downloads from its own host under its own licence. Check its
page (linked from Setup) before using it for commercial work.
