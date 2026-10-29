---
name: iv-studio
description: Make MiniMax H3 videos with IV Studio through its MCP server - render shots and continuous sequences with recurring characters, hunt and finish previews, retake stretches, and cut renders together on IV Studio's timeline (trims, titles, sound, export). Use whenever the person asks for IV Studio, an H3 shot or sequence, a character video, or an edit of their IV Studio renders.
---

If the `iv-studio` MCP tools aren't available, IV Studio has to be installed and its server added: the exact command for an install is under Settings -> Agents (MCP) in the app. Download: https://github.com/hollisorg/iv-studio/releases

IV Studio is a desktop app for MiniMax H3 video on a local ComfyUI: it renders shots and continuous
sequences with recurring characters, and cuts them together on its own timeline. Its MCP server
(`iv-studio`) uses the same projects, renders and edits as the app window, so what you make shows up
there for the person, and the other way round.

## First steps

1. `check_setup`: is ComfyUI up, which GPU, are the node packs and models there? If something is
   missing, tell the person what the result says to do rather than working around it.
2. `list_characters`: the character presets (LoRA, trigger word). Prompts write `{char}` where the
   character goes; IV Studio swaps in the trigger word.
3. `list_projects`, `list_sequences`, `list_edits`, `list_renders`: what already exists.

## Render a shot

1. Draft the prompt yourself or with `write_prompt` (a free local writer; `engine: "contextir"` is
   MiniMax's paid writer, so ask the person first).
2. `plan_render` checks the request and shows sizes, frames and the finished size without rendering.
3. `generate_previews` starts 1-3 low-resolution candidates (seed, +1000, +2000) and returns a job.
4. Poll `get_job` every 20-30 s until `done`. A 5 s preview takes about 1-3 minutes on a 4090.
5. Look at the candidates: `grab_frame` with `file` and a time shows you a frame of any output.
6. `finish_candidate` with the best one (2 MP pass + DLSS, optional RTX 2x and frame generation).
   It reuses the preview's saved latent, so the picked performance stays the same. Poll `get_job`.

Modes: `text` (prompt only), `reference` (pictures, videos or audio named `<Picture 1>`,
`<Video 1>`, `<Audio 1>` in the prompt), `frames` (first and optional last frame), `continue`
(extend a video from its last frames). `voiceLine` lip-syncs the previews to a recording.

## Writing H3 prompts

- Text mode uses three fields: `integrated_multimodal_description:` (the shot: style, place,
  clothes, camera, action and lines), `overall_soundscape:` and `non_diegetic_music:` (N/A for none).
- Reference mode uses `subject_definitions:`, `retention_analysis:` (what each reference keeps),
  `detailed_description:`, `overall_soundscape:` and `non_diegetic_music:`.
- Dialogue: `{char} (S1) says: <d>[English] The line.</d>` One speaker label per person.
- Never describe the character's face or voice: the LoRA carries them. Describe clothes, place,
  camera and action.
- Say "There is no writing anywhere in the picture" unless text is wanted; H3 likes adding signs.

## Sequences (one continuous video)

- `save_sequence` with shots (10 or 15 s each). `method: "take"` renders every shot in one seamless
  take (`render_take`); `method: "shots"` hunts and finishes shot by shot (`hunt_shot`, then
  `finish_shot`), each continuing from the last.
- Join rules for every shot after the first: open holding the previous shot's closing pose, stay
  quiet about 2 s before anyone speaks, and end settled with about 2 s to spare.
  `write_shots_from_story` writes shots that follow them.
- `retake` redoes a stretch (start..end seconds) of a version; `render_out` finishes a version
  (colour smoothing across joins, DLSS, frame generation). `get_sequence` lists versions and finals.

## Edit (the timeline)

- `create_edit`, then `add_media` with `renders` keys from `list_renders` (or file paths).
  `append: true` lays them end to end on V1 (pictures and video) or A1 (sound).
- `edit_timeline` takes a list of operations, applied in order and all checked first, so a bad one
  changes nothing: `add_clip`, `add_title`, `update_clip` (move, trim with in/out, change track,
  fades, volume, mute, title text), `split_clip`, `remove_clip` (with `ripple` to close the gap),
  `remove_media`, `clear`. `get_edit` shows the clip ids and times.
- Tracks: V2 is drawn over V1, T1 holds titles, A1 and A2 are sound. Video clips play their own
  sound too unless muted.
- Check the cut with `grab_frame` (edit + timeline time), then `export_edit` and poll
  `get_edit_export`. Exports go to `Videos\IV Studio\Edits`.
- If the edit is open in the app, it reloads there; the person can undo your change with Ctrl+Z.

## Models and characters

- `list_h3_models` and `set_workflow_model` choose the H3 model per workflow (some suit realism,
  others animation). `null` goes back to the default.
- `list_choices` lists the LoRAs and RefMods ComfyUI has; `save_character` adds a preset.

## House rules

- Renders take real GPU minutes, and the person may be using ComfyUI for other work too. Only
  cancel IV Studio jobs you started (`cancel_job`); never touch anything else in the queue.
- Ask the person before deleting anything (`delete_edit`, `delete_sequence`, `delete_character`) and
  before anything that costs money (the Context IR writer).
- Characters must be invented, or real people who agreed to it. Don't make a real person say or do
  things without their consent.
- The MCP server renders on the local ComfyUI, even when the app window is set to the cloud.
- Report what you made with its file path, so the person can open it.
