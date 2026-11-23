"""What the IV Studio cloud installs and downloads, shared by the Modal app (modal_app.py), the RunPod boot
(runpod_boot.py) and the gate's model routes (gate.py). Standard library only.

Node packs: models.json's node_packs (the list Setup installs on a PC), without the Windows-only ones and those
marked "cloud": false. A pack's requirements are installed without the torch family, so no pack can swap the
pinned torch for another build.

Models: models.json's models plus cloud.json's extraModels, by id. A download is kept only when it matches its
sha256, or, when that is null, the SHA-256 Hugging Face publishes for the file (X-Linked-ETag). A file with
neither is refused. Gated Hugging Face files are fetched with the person's Hugging Face token (HF_TOKEN).
"""
import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from pathlib import Path

TORCH_FAMILY = re.compile(r"^\s*(torch|torchvision|torchaudio|xformers|triton|triton-windows)(\s*$|[^A-Za-z0-9_.-])", re.I)
MODEL_EXT = (".safetensors", ".pth", ".pt", ".ckpt", ".gguf", ".bin", ".sft")


def load(here):
    here = Path(here)
    cloud = json.loads((here / "cloud.json").read_text()) if (here / "cloud.json").exists() else {}
    manifest = json.loads((here / "models.json").read_text()) if (here / "models.json").exists() else {"models": [], "node_packs": []}
    return cloud, manifest


def cloud_packs(manifest):
    return [p for p in manifest.get("node_packs", []) if not p.get("windowsOnly") and p.get("cloud") is not False]


def pack_commands(packs, custom_nodes, pip):
    """Shell commands that install each downloaded pack into custom_nodes (bundled packs are copied by the caller).
    pip: the command that installs a requirements file, e.g. "uv pip install --system"."""
    cmds = []
    for p in packs:
        if p.get("bundled"):
            continue
        dest = f"{custom_nodes}/{p['dir']}"
        if "git" in p:
            cmds.append(f"rm -rf '{dest}' && git clone -q {p['git']} '{dest}' && git -C '{dest}' checkout -q {p['commit']}")
        else:
            # registry archives are usually zips whatever their extension says; try zip, then tar
            cmds.append(f"rm -rf '{dest}' && mkdir -p '{dest}' && curl -fsSL {p['registry']} -o /tmp/pack && (unzip -q -o /tmp/pack -d '{dest}' || tar -xzf /tmp/pack -C '{dest}') && rm /tmp/pack")
        # the requirements without the torch family (see requirements_without_torch)
        cmds.append(
            f"if [ -f '{dest}/requirements.txt' ]; then grep -viE '^[[:space:]]*(torch|torchvision|torchaudio|xformers|triton)([^A-Za-z0-9_.-]|$)' '{dest}/requirements.txt' > /tmp/req.txt || true; {pip} -r /tmp/req.txt; fi"
        )
    return cmds


def requirements_without_torch(text):
    """The same filter as pack_commands' grep, for tests."""
    return "\n".join(line for line in text.splitlines() if not TORCH_FAMILY.match(line))


def catalog(cloud, manifest):
    """Every model the cloud can download, by id."""
    out = {}
    gated = set(cloud.get("gatedRepos", []))
    for m in list(manifest.get("models", [])) + list(cloud.get("extraModels", [])):
        if m.get("url"):
            repo = re.search(r"huggingface\.co/([^/]+/[^/]+)/", m["url"])
            if not m.get("gated") and repo and repo.group(1) in gated:
                m = {**m, "gated": f"https://huggingface.co/{repo.group(1)}"}
            out[m["id"]] = m
    return out


def setup_models(cloud, manifest):
    """What setup downloads: H3's required models and the cloud's own required ones. Everything else waits for the
    first render that needs it."""
    return [m for m in manifest.get("models", []) if not m.get("optional")] + [m for m in cloud.get("extraModels", []) if m.get("required")]


def target(root, m):
    return Path(root) / m["folder"] / m["match"]


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def _hf_headers(url, token):
    return {"Authorization": f"Bearer {token}"} if token and "huggingface.co" in url else {}


def hf_sha256(url, token=None):
    """SHA-256 Hugging Face publishes for an LFS file (X-Linked-ETag), or None."""
    if "huggingface.co" not in url:
        return None
    req = urllib.request.Request(url, method="HEAD", headers=_hf_headers(url, token))
    try:
        r = urllib.request.build_opener(_NoRedirect).open(req, timeout=30)
        headers = r.headers
    except urllib.error.HTTPError as e:
        headers = e.headers
    etag = (headers.get("X-Linked-ETag") or "").strip('"')
    return etag.lower() if len(etag) == 64 else None


def refusal(m, code, token):
    """What a refused download means, in words."""
    if code in (401, 403) and m.get("gated"):
        if not token:
            return f"{m['label']} is behind a licence on Hugging Face. Add your Hugging Face token on the Cloud page, after accepting the licence at {m['gated']}."
        return f"Hugging Face refused {m['label']}. Accept its licence at {m['gated']} with the account your token belongs to, then try again."
    return f"{m['label']}: the host answered {code} for {m['url']}"


# Big files come down in CHUNK-sized pieces over CONNECTIONS connections at once: Hugging Face's CDN limits each
# connection's speed, not the machine's (one connection ~29 MB/s, eight ~235 MB/s on the same file, 2026-11-23),
# and from a busy data center one connection can fall to a few MB/s. Finished pieces are written down in
# <file>.part.json, so a download stopped part way (the pod deleted, the network gone) carries on from there.
# 16 MB pieces: with 64 MB ones, one slow connection holding the last piece could halve a file's speed (measured).
CHUNK = 16 << 20
CONNECTIONS = 16
TRIES = 6
REFRESH_GAP = 20  # seconds between asks for a fresh signed address


def _probe(url, token):
    """(the address the file is served from after redirects, its size, whether it serves byte ranges)."""
    req = urllib.request.Request(url, headers={**_hf_headers(url, token), "Range": "bytes=0-0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        cr = r.headers.get("Content-Range") or ""
        total = cr.rsplit("/", 1)[-1] if "/" in cr else ""
        if r.status == 206 and total.isdigit():
            return r.geturl(), int(total), True
        return r.geturl(), int(r.headers.get("Content-Length") or 0), False


def _single(m, url, token, part, report):
    """One connection, start to end (a host that doesn't serve ranges, or a small file)."""
    r = urllib.request.urlopen(urllib.request.Request(url, headers=_hf_headers(url, token)), timeout=60)
    with r, open(part, "wb") as f:
        total = int(r.headers.get("Content-Length") or m.get("size") or 0)
        got = 0
        while chunk := r.read(1 << 22):
            f.write(chunk)
            got += len(chunk)
            report(got, total)


class _Pieces:
    """A file fetched in byte ranges by several threads, each writing its own pieces into one .part file."""

    def __init__(self, m, cdn, size, token, part, report):
        self.m, self.cdn, self.size, self.token, self.part, self.report = m, cdn, size, token, part, report
        self.meta = part.with_name(part.name + ".json")
        self.pieces = [(s, min(s + CHUNK, size) - 1) for s in range(0, size, CHUNK)]
        self.lock = threading.Lock()
        self.done = self._resume()
        self.resumed = len(self.done)
        self.got = sum(e - s + 1 for i, (s, e) in enumerate(self.pieces) if i in self.done)
        self.resolved_at = time.time()
        self.stop = threading.Event()

    def _resume(self):
        try:
            old = json.loads(self.meta.read_text())
            if old.get("url") == self.m["url"] and old.get("size") == self.size and old.get("chunk") == CHUNK and self.part.stat().st_size == self.size:
                return set(old.get("done") or [])
        except (OSError, ValueError):
            pass
        with open(self.part, "wb") as f:
            f.truncate(self.size)
        return set()

    def _save(self):
        tmp = self.meta.with_name(self.meta.name + ".tmp")
        tmp.write_text(json.dumps({"url": self.m["url"], "size": self.size, "chunk": CHUNK, "done": sorted(self.done)}))
        tmp.replace(self.meta)

    def _refresh(self):
        """The CDN address is signed and expires: ask for a fresh one (at most every REFRESH_GAP seconds)."""
        with self.lock:
            if time.time() - self.resolved_at >= REFRESH_GAP:
                self.cdn = _probe(self.m["url"], self.token)[0]
                self.resolved_at = time.time()

    def piece(self, i):
        start, end = self.pieces[i]
        want = end + 1 - start
        problem = ""
        for attempt in range(TRIES):
            if self.stop.is_set():
                return
            wrote = 0
            try:
                req = urllib.request.Request(self.cdn, headers={**_hf_headers(self.cdn, self.token), "Range": f"bytes={start}-{end}"})
                with urllib.request.urlopen(req, timeout=60) as r, open(self.part, "r+b") as f:
                    if r.status != 206:
                        raise OSError(f"the host sent the whole file (HTTP {r.status}), not the piece asked for")
                    f.seek(start)
                    while wrote < want and not self.stop.is_set():
                        b = r.read(min(1 << 20, want - wrote))
                        if not b:
                            break
                        f.write(b)
                        wrote += len(b)
                        with self.lock:
                            self.got += len(b)
                if self.stop.is_set():
                    return
                if wrote != want:
                    raise OSError("the connection closed early")
                with self.lock:
                    self.done.add(i)
                    self._save()
                return
            except urllib.error.HTTPError as e:
                wait_s = min(60, 2**attempt)
                if e.code == 429:
                    ra = e.headers.get("Retry-After") or ""
                    wait_s = max(wait_s, int(ra) if ra.isdigit() else 10)
                elif e.code in (401, 403, 404, 410):
                    try:
                        self._refresh()
                    except Exception:
                        pass
                problem = f"HTTP {e.code}"
            except Exception as e:  # a dropped connection, a timeout: that piece again
                wait_s = min(60, 2**attempt)
                problem = str(e) or type(e).__name__
            with self.lock:
                self.got -= wrote
            if attempt < TRIES - 1:
                self.stop.wait(wait_s)
        raise RuntimeError(f"{self.m['label']}: part of the download kept failing ({problem}). What's downloaded is kept; try again to carry on.")

    def run(self):
        todo = [i for i in range(len(self.pieces)) if i not in self.done]
        pool = ThreadPoolExecutor(max_workers=max(1, min(CONNECTIONS, len(todo))))
        try:
            futures = [pool.submit(self.piece, i) for i in todo]
            while True:
                finished, pending = wait(futures, timeout=1)
                for f in finished:
                    if f.exception():
                        raise f.exception()
                self.report(self.got, self.size)
                if not pending:
                    break
        except BaseException:
            self.stop.set()
            raise
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
        self.meta.unlink(missing_ok=True)


def _sha256(path, report=None):
    h = hashlib.sha256()
    size = path.stat().st_size
    done = 0
    with open(path, "rb") as f:
        while b := f.read(1 << 24):
            h.update(b)
            done += len(b)
            if report:
                report(done, size)
    return h.hexdigest()


def fetch(models, root, token=None, progress=None):
    """Downloads each model root lacks. progress(event) gets {id, label, state: have|downloading|checking|done,
    percent, got, total, index, count}, and while downloading speed (bytes a second over the last ~10 s) and
    resumed (bytes already there from an earlier try). Returns the ids now present. Raises on a refused download or
    a checksum mismatch; a download that fails part way keeps what it has, and the next fetch carries on."""
    progress = progress or (lambda e: None)
    done = []
    for i, m in enumerate(models, 1):
        dest = target(root, m)
        base = {"id": m["id"], "label": m["label"], "index": i, "count": len(models)}
        if dest.exists():
            progress({**base, "state": "have"})
            done.append(m["id"])
            continue
        want = (m.get("sha256") or "").lower() or hf_sha256(m["url"], token)
        if not want:
            raise RuntimeError(f"{m['label']} has no published checksum, so IV Studio won't put it in your cloud storage.")
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        samples = []  # (time, bytes) over the last ~10 s, for the speed
        last = [0.0]
        extra = {}

        def report(got, total, state="downloading", force=False):
            t = time.time()
            if state == "downloading":
                samples.append((t, got))
                while len(samples) > 2 and t - samples[0][0] > 10:
                    samples.pop(0)
            if force or t - last[0] > 3:
                last[0] = t
                span = samples[-1][0] - samples[0][0] if len(samples) > 1 else 0
                speed = {"speed": int((samples[-1][1] - samples[0][1]) / span) if span > 0.5 else 0} if state == "downloading" else {}
                progress({**base, "state": state, "got": got, "total": total, "percent": int(got * 100 / total) if total else 0, **speed, **extra})

        try:
            cdn, size, ranges = _probe(m["url"], token)
        except urllib.error.HTTPError as e:  # plain text, so the reason reaches IV Studio intact
            raise RuntimeError(refusal(m, e.code, token)) from None
        if ranges and size > CHUNK:
            job = _Pieces(m, cdn, size, token, part, report)
            if job.got:
                extra["resumed"] = job.got
            job.run()
        else:
            try:
                _single(m, m["url"], token, part, report)
            except urllib.error.HTTPError as e:
                raise RuntimeError(refusal(m, e.code, token)) from None
        report(0, part.stat().st_size, "checking", force=True)
        if _sha256(part, lambda d, t: report(d, t, "checking")) != want:
            part.unlink()
            part.with_name(part.name + ".json").unlink(missing_ok=True)
            raise RuntimeError(f"{m['label']} did not match its checksum; it was removed.")
        part.replace(dest)
        got = dest.stat().st_size
        progress({**base, "state": "done", "got": got, "total": got, "percent": 100})
        done.append(m["id"])
    return done


def listing(root):
    """Every model file under root: {relative path: size}. Half-downloaded files are left out."""
    root = Path(root)
    out = {}
    if not root.exists():
        return out
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.lower().endswith(MODEL_EXT):
                p = Path(dirpath) / f
                try:
                    out[p.relative_to(root).as_posix()] = p.stat().st_size
                except OSError:
                    pass
    return out


def present(models, root):
    return [m["id"] for m in models if target(root, m).exists()]
