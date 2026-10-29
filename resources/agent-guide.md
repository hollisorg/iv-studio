# Using IV Studio from an agent

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
`prepare_media` crops pictures and trims videos and sounds first (first/last frames should be
cropped to the shot's aspect, because they're stretched to fit).

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

## Shinobi: edits you cut as an agent

Shinobi is IV Studio's agent-driven editor (its engine is OpenKatana). Where Edit is a hand-made timeline,
Shinobi lets you author a whole edit in code: cuts on the beat, speed ramps, punch-ins and camera moves,
typography, masks and effects, captions from speech, sound cues, even 3D scenes, rendered on this PC.

1. `shinobi_status`; if it isn't set up, ask the person, then `shinobi_setup` (about 440 MB, once).
2. `shinobi_tools` lists every tool. Call one with `shinobi` {tool, arguments}. Read the engine's guides
   first: `shinobi` read_guide with topic agent, timeline and effects. Don't guess timeline fields.
3. `create_project` (or use one from the Shinobi page: `shinobi_project` shows its media, saved edit,
   renders and the person's brief), then `import_media` with IV Studio render paths (`list_renders`) or files.
4. Look before cutting: `preview_source` and `source_contact_sheet` return pictures. For music,
   `analyze_audio` and `plan_music_edit`; `build_recipe` gives a starting point in one of 12 styles.
5. `save_timeline` with the revision from `get_project`, then `preview_timeline` (pictures) at the opening,
   cuts and titles. `start_render` with a new request id, then poll `get_render`.
6. Tell the person; the render shows on the Shinobi page, where it can go into Edit.

## Replace: swap who or what is in a video

Replace (OpenJutsu's workflows) redraws only the person or thing you choose, clip by clip with H3, and keeps
the camera, cuts, motion and soundtrack. `replace_check` says what the ComfyUI still needs.
1. Trim the source first if needed (`prepare_media`); it needs a soundtrack.
2. Run `replace_video` mode mask with the same target to see what will be redrawn (about a minute).
3. Then person (one picture, optional characterId so the character's LoRA joins), people (1-4 pictures with
   a role each), or object (change, remove, background). Finish with faces (small faces redrawn from a
   picture) or colours. Poll `get_job`; the result is the output with kind final.
Only put invented characters, or people who agreed, into a video.

## Train a new character

The Characters page (and these tools) turn an invented person into a character preset:
1. `create_character_training` (name, who), then `design_faces` with a face description (age, face
   shape, eyes, skin, hair). Look at the four candidates and `pick_face`.
2. `design_scenes` renders that face in eight places and outfits (four candidates each); `pick_still` the
   most alike in each (or leave one out), or let `rank_likeness` with pick do it by face score. Captions never
   describe the face, so the face binds to the trigger word.
3. Optionally set a voice sample (`update_character_training` voice), then `make_training_clips`:
   H3 talking clips from the face and the stills. `rank_likeness` scores them; render weak ones again
   (`make_training_clips` redo) or drop them (`set_training_item` keep false). Aim for 0.45+.
4. `estimate_training`, tell the person the minutes and dollars, and `start_training` only after they
   agree (it bills their Modal account; Tess took 29 minutes and $3.80 on a B200).
5. When `train.state` is `done`: `test_checkpoints` with 2-4 epochs (late ones often win), compare the
   renders, and `adopt_checkpoint` the best. It's then a character like any other.

## House rules

- Renders take real GPU minutes, and the person may be using ComfyUI for other work too. Only
  cancel IV Studio jobs you started (`cancel_job`); never touch anything else in the queue.
- Ask the person before deleting anything (`delete_edit`, `delete_sequence`, `delete_character`) and
  before anything that costs money (the Context IR writer).
- Characters must be invented, or real people who agreed to it. Don't make a real person say or do
  things without their consent.
- The MCP server renders on the local ComfyUI, even when the app window is set to the cloud.
- Report what you made with its file path, so the person can open it.
