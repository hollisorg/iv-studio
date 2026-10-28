"""IV Studio in the cloud, on the user's own Modal account.

IV Studio deploys this for the user (they never need to read it):
  modal deploy modal_app.py                       # builds the image once, publishes the ComfyUI address
  modal run modal_app.py::fetch_models            # CPU: the H3 models into the iv-studio-models volume, once
  modal volume put iv-studio-models <file> <path> # the user's character LoRAs and RefMods

What runs:
  comfy          ComfyUI behind gate.py (the token gate) as a web server. It starts on the first request,
                 keeps running while IV Studio is using it and shuts itself down after IV_IDLE_SECONDS
                 with nothing to do, so the GPU is billed only while rendering.
  fetch_models   downloads every model in models.json that the volume doesn't have yet, each one checked
                 against the SHA-256 Hugging Face publishes.
Volumes: iv-studio-models (models, read by ComfyUI through extra_model_paths.yaml) and iv-studio-data
(ComfyUI's input and output folders, so uploads and renders outlive a container).
The token lives in the Modal secret iv-studio-token, which IV Studio creates.
"""
import hashlib
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import modal

HERE = Path(__file__).parent
CLOUD = json.loads((HERE / "cloud.json").read_text()) if (HERE / "cloud.json").exists() else {}
APP_NAME = os.environ.get("IV_APP_NAME", "iv-studio")
GPU = os.environ.get("IV_GPU", "L40S")
IDLE = int(os.environ.get("IV_IDLE_SECONDS", "300"))

models_vol = modal.Volume.from_name("iv-studio-models", create_if_missing=True)
data_vol = modal.Volume.from_name("iv-studio-data", create_if_missing=True)


def _pack_commands():
    cmds = []
    for p in CLOUD.get("packs", []):
        dest = f"/comfy/custom_nodes/{p['dir']}"
        if "git" in p:
            cmds.append(f"git clone {p['git']} {dest} && git -C {dest} checkout {p['commit']}")
        else:
            ext = "tar.gz" if p["registry"].endswith(".tar.gz") else "zip"
            unpack = f"tar -xzf /tmp/pack.{ext} -C {dest}" if ext == "tar.gz" else f"unzip -q /tmp/pack.zip -d {dest}"
            cmds.append(f"mkdir -p {dest} && curl -fsSL {p['registry']} -o /tmp/pack.{ext} && {unpack} && rm /tmp/pack.{ext}")
        cmds.append(f"if [ -f {dest}/requirements.txt ]; then pip install -r {dest}/requirements.txt; fi")
    return cmds


comfy_cfg = CLOUD.get("comfyui", {"repo": "https://github.com/Comfy-Org/ComfyUI", "tag": "v0.42.5"})
torch_cfg = CLOUD.get("torch", {"index": "https://download.pytorch.org/whl/cu128", "packages": ["torch", "torchvision", "torchaudio"]})

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl", "unzip", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(*torch_cfg["packages"], index_url=torch_cfg["index"])
    .run_commands(
        f"git clone --depth 1 --branch {comfy_cfg['tag']} {comfy_cfg['repo']} /comfy",
        "pip install -r /comfy/requirements.txt aiohttp",
    )
    .run_commands(*_pack_commands())
    .env({"PYTHONUNBUFFERED": "1", "HF_HUB_DISABLE_TELEMETRY": "1"})
    .add_local_dir(str(HERE / "ComfyUI-IV-Studio"), "/comfy/custom_nodes/ComfyUI-IV-Studio", copy=True)
    .add_local_file(str(HERE / "extra_model_paths.yaml"), "/opt/iv/extra_model_paths.yaml", copy=True)
    .add_local_file(str(HERE / "gate.py"), "/opt/iv/gate.py", copy=True)
)

app = modal.App(APP_NAME)


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/models": models_vol, "/data": data_vol},
    secrets=[modal.Secret.from_name("iv-studio-token")],
    timeout=24 * 3600,
    scaledown_window=IDLE,
    max_containers=1,
)
@modal.concurrent(max_inputs=200)
@modal.web_server(8189, startup_timeout=600)
def comfy():
    for d in ("/data/input", "/data/output"):
        os.makedirs(d, exist_ok=True)
    subprocess.Popen(
        "python /comfy/main.py --listen 127.0.0.1 --port 8188 --disable-auto-launch --preview-method none "
        "--input-directory /data/input --output-directory /data/output "
        "--extra-model-paths-config /opt/iv/extra_model_paths.yaml",
        shell=True,
    )
    subprocess.Popen("python /opt/iv/gate.py", shell=True)


# ---------- models ----------

def _hf_sha256(url):
    """SHA-256 Hugging Face publishes for an LFS file (X-Linked-ETag), or None."""
    req = urllib.request.Request(url, method="HEAD")
    opener = urllib.request.build_opener(_NoRedirect)
    try:
        r = opener.open(req, timeout=30)
        headers = r.headers
    except urllib.error.HTTPError as e:
        headers = e.headers
    etag = (headers.get("X-Linked-ETag") or "").strip('"')
    return etag if len(etag) == 64 else None


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


@app.function(image=modal.Image.debian_slim(python_version="3.12"), volumes={"/models": models_vol}, timeout=6 * 3600, cpu=4)
def download_models(models):
    """Downloads the models the volume lacks. Prints one progress line per few percent."""
    done = []
    for m in models:
        dest = Path("/models") / m["folder"] / m["match"]
        if dest.exists():
            print(f"have {m['label']}", flush=True)
            done.append(m["id"])
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_suffix(dest.suffix + ".part")
        want = _hf_sha256(m["url"]) if "huggingface.co" in m["url"] else None
        print(f"downloading {m['label']}", flush=True)
        h = hashlib.sha256()
        with urllib.request.urlopen(m["url"], timeout=60) as r, open(part, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            got, last = 0, -5
            while chunk := r.read(1 << 22):
                f.write(chunk)
                h.update(chunk)
                got += len(chunk)
                pct = int(got * 100 / total) if total else 0
                if pct >= last + 5:
                    print(f"progress {m['id']} {pct}% of {total}", flush=True)
                    last = pct
        if want and h.hexdigest() != want:
            part.unlink()
            raise RuntimeError(f"{m['label']} did not match its published checksum; it was removed.")
        part.rename(dest)
        models_vol.commit()
        print(f"done {m['label']}{' (checksum verified)' if want else ''}", flush=True)
        done.append(m["id"])
    return done


@app.function(image=modal.Image.debian_slim(python_version="3.12"), volumes={"/models": models_vol})
def models_present(models):
    return [m["id"] for m in models if (Path("/models") / m["folder"] / m["match"]).exists()]


@app.local_entrypoint()
def fetch_models():
    """Run by IV Studio: `modal run modal_app.py::fetch_models` with models.json next to this file."""
    manifest = json.loads((HERE / "models.json").read_text())
    models = manifest["models"] + CLOUD.get("extraModels", [])
    t0 = time.time()
    done = download_models.remote(models)
    print(f"models ready: {len(done)}/{len(models)} in {int(time.time() - t0)} s", flush=True)
