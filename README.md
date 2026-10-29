<p align="center">
  <img src="docs/images/banner.png" alt="IV Studio: AI films with recurring actors, on your own PC" width="100%">
</p>

<p align="center">
  <a href="https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-Setup.exe"><b>Download for Windows</b></a>
  &nbsp;·&nbsp;
  <a href="#what-you-need">What you need</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/hollisorg/iv-studio/releases/latest">Release notes</a>
  &nbsp;·&nbsp;
  <a href="https://infinitevariance.ai">Infinite Variance</a>
</p>

# IV Studio

A free Infinite Variance desktop app for making short films with
[MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3) on your own PC. Give a recurring actor a face
and a voice, write a shot, hunt a few quick previews and finish the best one at full size. Then add
music, cut it all together and export. IV Studio drives your own
[ComfyUI](https://github.com/comfyanonymous/ComfyUI); nothing leaves your machine unless you choose the
cloud.

<p align="center">
  <img src="docs/images/candidates.png" alt="A shot of Tess at the potter's wheel with two preview takes to pick from" width="100%">
</p>

## What it does

- **Shots.** Write a shot (or type the idea in plain words and let **Write it for me** write the H3
  prompt), hunt one to three quick previews, pick one and finish it at 1 to 2 MP with DLSS, an RTX 2×
  upscale and frame generation. Four modes: text, reference pictures, video and audio, first and last
  frame, and continuing a video.
- **Characters.** Recurring actors as trained H3 LoRAs with a trigger word. Use the ready-made Tess and
  Theo, add a LoRA you have, or design, clip and train your own on your Modal account.
- **Voices.** Give each character a voice: design one from a description, or save one from a recording.
  Type a line and **Speak it**: the character says it on screen, lip-synced. Runs on your PC with
  VoxCPM2 and Whisper.
- **Music.** Songs with sung lyrics, or instrumentals, from a style and lyrics: MiniMax Music 3 for full
  songs up to five minutes, ACE-Step 1.5 for a draft in seconds. Put a song under an edit, or have a
  character sing it.
- **Sequences.** Several shots that play as one continuous video, rendered as one take or shot by shot,
  with retakes of any stretch.
- **Edit.** A multi-track timeline: two video tracks, titles and two audio tracks, with fades, volume,
  snapping, undo and MP4 export at 1080p, 4K, vertical or square.
- **Workflows.** **Replace** swaps a person or an object in a video while the camera, motion and sound
  stay. **Shinobi** lets an agent cut a whole edit in code.
- **Library.** Every shot, sequence, export, song and spoken line in one place, ready to drop onto an
  edit or into a shot.
- **Agents.** A local MCP server with 86 tools gives Claude Code or any MCP client nearly everything a
  person can do in the window.

<table>
  <tr>
    <td width="50%"><img src="docs/images/create.png" alt="Create: Tess, a Write it for me idea and the H3 prompt"></td>
    <td width="50%"><img src="docs/images/finish.png" alt="A finished 1 MP shot of Tess at the potter's wheel"></td>
  </tr>
  <tr>
    <td align="center"><sub>Write the shot, or describe it and let it be written</sub></td>
    <td align="center"><sub>Finish the take you like at full size</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/characters.png" alt="Characters: Tess with her LoRA and voice, and the ready-made Theo"></td>
    <td width="50%"><img src="docs/images/voices.png" alt="Voices: a designed voice and Tess's voice, each given to a character"></td>
  </tr>
  <tr>
    <td align="center"><sub>Recurring characters, ready-made or trained</sub></td>
    <td align="center"><sub>A voice for every character</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/music.png" alt="Music: an ACE-Step instrumental and a MiniMax Music 3 song"></td>
    <td width="50%"><img src="docs/images/lines.png" alt="Lines: lines spoken in Tess's voice, ready to use in a shot"></td>
  </tr>
  <tr>
    <td align="center"><sub>Songs and scores, made on your PC</sub></td>
    <td align="center"><sub>Say it in their voice</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/images/edit.png" alt="Edit: a finished shot on V1 and its song on A1"></td>
    <td width="50%"><img src="docs/images/library.png" alt="Library: every shot, song and line in one place"></td>
  </tr>
  <tr>
    <td align="center"><sub>Cut it together and export</sub></td>
    <td align="center"><sub>Everything you've made, in one place</sub></td>
  </tr>
</table>

## What you need

- **Windows 10 or 11** (64-bit).
- **An NVIDIA GPU.** 24 GB of VRAM is what IV Studio is tested on (an RTX 4090); 16 GB works with smaller
  previews and finals. 64 GB of system RAM is recommended.
- **[ComfyUI](https://github.com/comfyanonymous/ComfyUI)**, version 0.33 or newer, running on the same PC.
  IV Studio talks to it at `http://127.0.0.1:8188` (change it in Settings).
- **Disk space.** About 60 GB for the H3 models. Music adds about 14 GB (MiniMax Music 3) or 10 GB
  (ACE-Step); voices add about 12 GB. Each is a one-click download inside the app.
- **Optional:** [Ollama](https://ollama.com) for the free local prompt writer, and a
  [Modal](https://modal.com) account for cloud rendering and character training.

## Install

1. [Download `IV-Studio-Setup.exe`](https://github.com/hollisorg/iv-studio/releases/latest/download/IV-Studio-Setup.exe)
   (about 180 MB).
2. Run it. The installer isn't code-signed yet, so Windows may show **"Windows protected your PC"**.
   Click **More info → Run anyway**. It installs for your user only; no admin rights needed.
3. Start ComfyUI, then IV Studio. The **Setup** page checks ComfyUI, your GPU, the node packs and every
   model, downloads missing models straight into ComfyUI's models folder (each checked against the
   SHA-256 its host publishes) and links any node pack you still need.
4. For voices, open **Audio → Voices** and press **Set up voices** once. For music, open
   **Audio → Music** and download the engine you want.

Your projects, voices and songs are kept in `%APPDATA%\IV Studio`; renders are saved in ComfyUI's
output folder under `H3\`.

<p align="center">
  <img src="docs/images/setup.png" alt="The Setup page" width="100%">
</p>

## How a shot works

1. **Create.** Pick a mode, a character and write the shot.
   - **Text:** just the prompt.
   - **References:** pictures, videos or audio guide the shot (`<Picture 1>`, `<Video 1>`, `<Audio 1>`).
     Click a reference to crop or trim it; videos snap to H3's lengths.
   - **First / last frame:** the clip opens on a picture and can end on a second one.
   - **Continue a video:** carries a clip on from its last frames.

   Set the aspect, length, preview size and how many previews to hunt (1 to 3). Optional extras: a voice
   line to lip-sync, RefMods, extra LoRAs and the step count.
2. **Hunt.** IV Studio queues the previews on ComfyUI and shows them as they finish.
3. **Pick and finish.** Choose a preview and set the final size (1, 1.5 or 2 MP), RTX 2× upscale, frame
   generation (30/50/60/120 fps) and the sound source. The finish starts from the preview's own latent,
   so the motion stays the same.
4. **Shots.** Every shot keeps its runs, previews and finals. **Show in folder** opens the file.

### Write it for me

You don't need to know H3's prompt format. Type the idea in plain words, for example "Tess in a parked
car at night admits she kept the letter", and press **Write my prompt**. You get a finished H3 prompt
back to edit, keep or undo. It always uses your mode, length, aspect, character and media. Choose the
writer under **Settings → Prompt writer**:

- **Local (free):** a model in Ollama on your PC with IV Studio's H3 rule sheet. The recommended model is
  `qwen3-vl:8b-instruct` (about 6 GB, one click to install). It can look at your pictures, and while
  ComfyUI is rendering it runs on the CPU, so it never takes H3's VRAM.
- **MiniMax Context IR:** MiniMax's own prompt rewriter through ComfyUI, paid through your Comfy.org
  account (about $0.02 to $0.11 a prompt). Your API key is stored encrypted on your PC.

## Characters

A character is a trained MiniMax H3 LoRA plus its trigger word; write `{char}` in the prompt where the
character goes. On the **Characters** page:

- **Your characters:** each with its picture, trigger, strength, LoRA (checked against ComfyUI) and voice.
- **Ready-made:** IV Studio's own invented characters, Tess Marlow and Theo Lindqvist. Download one and
  its LoRA (about 150 MB, from this repo's `characters-v1` release, checked against its SHA-256) goes into
  ComfyUI, and their bundled voice comes with them.
- **Train your own,** the method that made Tess:
  1. **Design:** describe the face; Z-Image Turbo renders four candidates on your PC. The one you pick is
     rendered in eight scenes on the same seed. Or add your own pictures, only of an invented person or
     someone who agreed.
  2. **Clips:** H3 renders talking clips from the stills and the character's voice, or you add your own.
     Everything is fitted to Fizgig's rules (24 fps, 17n+5 frames, 32 kHz stereo).
  3. **Train:** Fizgig on your own Modal account, with the minutes and dollars shown first. Theo took
     56 minutes and about $4.10 on an H200.
  4. **Pick:** checkpoints are rendered side by side on one seed; the one you choose becomes a character,
     keeping the voice its clips were made with.

  **Likeness:** with InsightFace's face models (a one-time 289 MB download; non-commercial licence), IV
  Studio scores every still and clip against the picked face and can keep the closest of each scene.

## Voices

**Audio → Voices** keeps a voice for every character, and **Audio → Lines** says anything in any of them.

- **Design a voice** from a description ("a woman in her forties from Glasgow, low, warm and a little
  gravelly"): three takes to choose from.
- **From a recording:** a clean 10 to 20 seconds of one person talking. Only your own voice, an invented
  one, or someone who agreed, and IV Studio asks you to confirm.
- **Speak it:** in **Create**, a character with a voice gets a **Speak it** box. Type the line; it becomes
  the shot's voice line, and the same words go into the prompt so H3 lip-syncs them.
- **Lines** keeps every line you've spoken, ready to use in a shot or drop on an edit. A new seed gives a
  new read of the same words.

The speaking runs on your PC in IV Studio's own Python environment (set up once, about 12 GB):
[VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (OpenBMB, Apache-2.0) designs, clones and speaks, and
[Whisper large-v3 turbo](https://huggingface.co/openai/whisper-large-v3-turbo) (OpenAI, MIT) reads the
words in a recording. A line takes about 4 seconds once the model is loaded. The voice engine is stopped
before every render, so it never shares the GPU with H3.

## Music

**Audio → Music** makes songs and instrumentals on your PC through ComfyUI's own nodes:

- **MiniMax Music 3:** full songs up to five minutes with the clearest sung words of the open models.
  Describe the style and write lyrics with `[Verse]`, `[Chorus]` and other section tags; the song's length
  follows the lyrics. About a minute or two per song on an RTX 4090.
- **ACE-Step 1.5 Turbo:** a song in seconds, with tempo, key, time signature and language. Best for drafts,
  background music and instrumentals.

Every song is kept in IV Studio's music folder. **Add to edit** puts it on A1 of a new or existing edit;
**Use in a shot** makes it the voice line, so a character sings it (trim it to the shot first).

## Sequences

Several shots that play as one continuous video.

- **One take:** every shot renders together in one seamless take through
  [H3 Multishot](https://github.com/jlucasmcrell/ComfyUI-H3-Multishot)'s sampler, so there are no cuts,
  colour shifts or breaks in the sound.
- **Shot by shot:** hunt and pick each shot in turn; each carries on from the end of the one before.
- **Retake:** mark a stretch of any version and redo the picture and sound, the picture only, or the sound
  only. Everything around it stays.
- **Render out:** optional colour smoothing across the joins, then DLSS with RTX 2× and frame generation.

Shots are 10 or 15 seconds, the lengths H3 Multishot is tested at.

## Edit

A multi-track timeline for cutting shots, sequences, songs and lines together: two video tracks (V2 plays
over V1), a titles track and two audio tracks. Drag clips between tracks, trim their edges, split, delete or
ripple delete, and undo anything. Each clip has fades and volume; titles have their own text, size, colour,
position and box. **Export MP4** renders the timeline at 1080p, 4K, vertical or square, 24/30/60 fps, into
`Videos\IV Studio\Edits`.

Shortcuts: Space play · S split · Delete · Shift+Delete ripple delete · Ctrl+Z / Ctrl+Shift+Z ·
← → one frame (Shift: one second) · Home / End.

## Library

The **Library** button above the Video | Audio switch opens everything you've made: shot finals and
previews, sequences, Replace runs, Edit exports, songs and spoken lines, newest first. Filter by type or
search, then add any of them to an edit or use a sound as a shot's voice line.

## Workflows

### Replace

Swaps who or what is in a video while the camera, cuts, motion and soundtrack stay:

- **Person:** a picture (or one of your trained characters, with their LoRA) replaces the main person.
- **Several people:** one to four characters, each replacing someone you describe.
- **Object:** change something (hair, a jacket, a car), remove it, or put a new background behind the person.
- **Finish:** redraw small faces at close-up size, or soften H3's look.
- **Check the mask** first shows what will be redrawn, in about a minute.

It runs [OpenJutsu](https://github.com/D3voz/openjutsu)'s ComfyUI workflows (MIT, commit `47c3724`): SAM 3.1
tracks the people, Qwen3-VL describes the shots, and MiniMax H3 redraws the masked area.

### Shinobi

IV Studio's agent-driven editor. Where **Edit** is cut by hand, Shinobi lets an agent (or a one-click recipe
from 12 styles) author the whole edit in code: cuts on the beat, speed ramps, punch-ins, typography, masks,
captions from speech and sound cues. It renders on your PC with the Edge or Chrome you already have.
Shinobi's engine is [OpenKatana](https://github.com/rk0neki/OpenKatana) (Apache-2.0), installed unmodified;
Shinobi isn't affiliated with OpenKatana or with Higgsfield, whose Katana inspired it.

## Models and the GPU

- **Settings → Models** picks the main H3 model for each workflow from the ones your ComfyUI has, so a
  fine-tune that suits realism or animation can be used where it fits.
- **One model family at a time.** Before every job, IV Studio stops its own voice engine and, when the job
  before used a different family (H3 video, music or design pictures), asks ComfyUI to unload first. Jobs
  of the same family keep their models loaded.

## Cloud

The **Cloud** page renders on your own [Modal](https://modal.com) account instead of your PC: it installs
Modal's client, signs you in on Modal's own page and deploys IV Studio's ComfyUI app there. GPUs bill by the
second and stop on their own when idle, and new Modal accounts get free monthly credit. Cloud renders use a
2× AI upscale and RIFE frame interpolation in place of DLSS, which is Windows-only. Voices and music run on
your PC.

## Agents (MCP)

IV Studio includes a local MCP server (stdio) with 86 tools. It uses the same projects, characters, voices
and songs as the window, so Claude Code or any MCP client can render shots and sequences, speak lines, make
music, cut them together and export. **Settings → Agents (MCP)** has the command for your install, a
message to paste into any agent, and a button that adds the IV Studio skill to Claude Code. For a
development checkout:

```
claude mcp add iv-studio -e ELECTRON_RUN_AS_NODE=1 -- "<checkout>\node_modules\electron\dist\electron.exe" "<checkout>\out\main\mcp.js"
```

Agents learn how to use it from `resources/agent-guide.md`: the server's instructions on connect, the
`get_guide` tool, and the Claude Code skill ([`skills/iv-studio/SKILL.md`](skills/iv-studio/SKILL.md)).

<details>
<summary>All tools</summary>

- **Guide:** `get_guide`.
- **Shots:** `check_setup`, `list_characters`, `list_projects`, `plan_render`, `generate_previews`,
  `finish_candidate`.
- **Sequences:** `list_sequences`, `get_sequence`, `save_sequence`, `render_take`, `hunt_shot`,
  `finish_shot`, `retake`, `render_out`.
- **Prompt writing:** `write_prompt`, `write_shots_from_story`.
- **Jobs:** `get_job`, `cancel_job`, `get_outputs`.
- **References:** `prepare_media` (crop a picture, trim and crop a video or sound).
- **Library:** `list_renders`, `rename_project`, `delete_project`, `delete_sequence`.
- **Edit:** `list_edits`, `get_edit`, `create_edit`, `set_edit_settings`, `delete_edit`, `add_media`,
  `edit_timeline` (add, move, trim, split, ripple delete, fades, volume, titles, all checked before anything
  changes), `grab_frame`, `export_edit`, `get_edit_export`, `cancel_edit_export`.
- **Voices:** `voice_status`, `setup_voices`, `list_voices`, `design_voice`, `create_voice`, `update_voice`,
  `delete_voice`, `speak_line`, `list_lines`, `delete_line`, `release_voice_engine`.
- **Music:** `music_status`, `make_music`, `list_music`, `get_music`, `cancel_music`, `rename_music`,
  `delete_music`.
- **Characters:** `list_ready_characters`, `install_ready_character`, `save_character`, `delete_character`,
  `list_choices` (LoRAs and RefMods).
- **Character training:** `list_character_trainings`, `get_character_training`,
  `create_character_training`, `update_character_training`, `design_faces`, `pick_face`, `design_scenes`,
  `pick_still`, `make_training_clips`, `set_training_item`, `add_training_files`, `rank_likeness`,
  `estimate_training`, `start_training` (paid: needs the person's OK and `confirm_cost`), `stop_training`,
  `test_checkpoints`, `adopt_checkpoint`.
- **Replace:** `replace_check`, `replace_video`, `replace_history`.
- **Shinobi:** `shinobi_status`, `shinobi_setup`, `shinobi_tools`, `shinobi`, `shinobi_project`.
- **Models:** `list_h3_models`, `set_workflow_model`.

An edit open in the window reloads when an agent changes it, and Ctrl+Z puts the person's version back.
The MCP server always renders on the local ComfyUI.

</details>

## Use it well

- **Model licences.** IV Studio doesn't bundle any model weights; each one downloads from its own host under
  its own licence, linked from Setup. Read them before commercial work. In particular:
  - **MiniMax H3** is under the MiniMax H3 Community Licence, which covers use worldwide *except* the EU,
    the UK, South Korea and the USA. Use in those places needs a licence from MiniMax.
  - **MiniMax Music 3** is under the MiniMax-Music3 Community Licence: commercial use is allowed if the
    product shows "MiniMax-Music3", with MiniMax's written permission above $20M a year.
  - **ACE-Step 1.5**, **VoxCPM2** and **Qwen3-VL** are Apache-2.0; **Whisper** is MIT.
  - **InsightFace's** face models (only for likeness scoring) are for non-commercial research use.
- **People.** Characters and voices must be invented, your own, or of someone who agreed. Don't make a real
  person say or do things without their consent, and don't clone a voice from a recording you found.
- **Music.** Write your own lyrics and describe a style rather than imitating a named artist.

---

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
- `mcp-smoke.mjs`, `mcp-tools.mjs`, `mcp-live.mjs`: the MCP server over stdio, every editor, library,
  model and character tool, and an agent's edit reloading in an open dev window.
- `mcp-voices.mjs`: every voice tool against a set-up voice engine (pass its folder).
- `mcp-music.mjs`: every music tool against the local ComfyUI (`--minimax` adds a MiniMax song).
- `edit-export.mjs`: exports a five-clip edit with the bundled ffmpeg.
- `replace.mjs`, `shinobi.mjs`, `training-local.mjs`, `sequence-graphs.mjs`: Replace, Shinobi, character
  design and sequences on real hardware (the last one queues GPU renders).
- `media-prepare.mjs`, `models-download.mjs`, `prompt-writer.mjs`: media trims, checked downloads and the
  local prompt writer.

## Licences

IV Studio is MIT-licensed (see [LICENSE](LICENSE)); the Infinite Variance eye artwork is Infinite Variance's
own and isn't covered by the MIT licence. Third-party notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The bundled FFmpeg build is GPL.

Screenshots show Tess Marlow, an invented IV Studio character, in renders made with IV Studio.
