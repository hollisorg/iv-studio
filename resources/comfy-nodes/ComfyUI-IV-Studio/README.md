# ComfyUI-IV-Studio (local)

Two helper nodes written on 2026-10-28 for the IV Studio MiniMax H3 workflow
(`user/default/workflows/Models/MiniMax H3/IV Studio.json`). No dependencies beyond ComfyUI itself.

- **IV Latent Cache**: saves a latent to `output/iv_latent_cache/<fingerprint>.pt`. The fingerprint is a hash of
  every node upstream of it in the prompt (class types and inputs). On a later run with identical upstream
  settings it loads the file and the upstream sampler is skipped (lazy input). Delete the folder to clear it.
- **IV Shot List**: picks shot N from a script whose shots are separated by `---` lines.

Rollback: when ComfyUI is idle, move this folder out of `custom_nodes` and restart with the usual launcher.
