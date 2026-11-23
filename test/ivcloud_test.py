"""resources/cloud/ivcloud.py, without a cloud: run by test/cloudprep.mjs as
    python test/ivcloud_test.py <a free port>
It serves files from a local HTTP server and checks downloads, checksums, refusals, listings and the pack list."""
import hashlib
import json
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "resources" / "cloud"))
import ivcloud  # noqa: E402

passed = failed = 0


def ok(cond, what):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {what}")
    else:
        failed += 1
        print(f"  FAIL {what}")


BODY = bytes((i * 13) % 256 for i in range(3 * 1024 * 1024))
SHA = hashlib.sha256(BODY).hexdigest()
# a bigger file served in byte ranges, as Hugging Face's CDN does: fetched in pieces over several connections
BIG = bytes((i * 7 + i // 977) % 256 for i in range(5 * 1024 * 1024 + 12345))
BIG_SHA = hashlib.sha256(BIG).hexdigest()
# what the ranged host does: requests counted, the signed address's generation, failures to cause
host = {"ranges": 0, "gen": 1, "expire_at": 0, "flaky": set(), "down_after": 0}
lock = threading.Lock()


class Host(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def ranged(self):
        """/big: byte ranges, the way a CDN serves them; /signed?v=N only while N is the current generation."""
        with lock:
            host["ranges"] += 1
            n = host["ranges"]
            if host["expire_at"] and n == host["expire_at"]:  # the signed address expires once, part way
                host["gen"] += 1
            gen, down = host["gen"], bool(host["down_after"]) and n > host["down_after"]
        if down:
            self.send_response(503)
            self.end_headers()
            return
        if self.path.startswith("/signed") and self.path != f"/signed?v={gen}":
            self.send_response(403)
            self.end_headers()
            return
        rng = self.headers.get("Range") or ""
        if not rng.startswith("bytes="):
            self.send_response(200)
            self.send_header("Content-Length", str(len(BIG)))
            self.end_headers()
            self.wfile.write(BIG)
            return
        a, b = rng[6:].split("-")
        a, b = int(a), min(int(b), len(BIG) - 1)
        body = BIG[a : b + 1]
        with lock:
            cut = a in host["flaky"]
            host["flaky"].discard(a)
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {a}-{b}/{len(BIG)}")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body[: len(body) // 2] if cut else body)  # a flaky piece: the connection closes half way

    def do_GET(self):
        if self.path.startswith("/big") or self.path.startswith("/signed"):
            return self.ranged()
        if self.path.startswith("/to-big"):  # Hugging Face's resolve URL: a redirect to the CDN
            with lock:
                gen = host["gen"]
            self.send_response(302)
            self.send_header("Location", f"/signed?v={gen}")
            self.end_headers()
            return
        if self.path.startswith("/gated") and self.headers.get("Authorization") != "Bearer hf_good":
            self.send_response(403)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Length", str(len(BODY)))
        self.end_headers()
        self.wfile.write(BODY)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18555
    srv = ThreadingHTTPServer(("127.0.0.1", port), Host)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"
    print("ivcloud.py")
    try:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "models"
            good = {"id": "a", "label": "Model A", "folder": "loras/Sub", "match": "a.safetensors", "url": f"{base}/a", "size": len(BODY), "sha256": SHA}
            events = []
            done = ivcloud.fetch([good], root, progress=events.append)
            f = root / "loras" / "Sub" / "a.safetensors"
            ok(done == ["a"] and f.exists() and f.read_bytes() == BODY, "fetch: a file with a known SHA-256 lands in its folder, byte for byte")
            ok(events[-1]["state"] == "done" and not list(root.rglob("*.part")), "fetch: reports done, leaves no .part")
            events.clear()
            ok(ivcloud.fetch([good], root, progress=events.append) == ["a"] and events[0]["state"] == "have", "fetch: a file already there isn't downloaded again")

            bad = {**good, "id": "b", "match": "b.safetensors", "sha256": "0" * 64}
            try:
                ivcloud.fetch([bad], root)
                ok(False, "fetch: a checksum mismatch is refused")
            except RuntimeError as e:
                ok("did not match" in str(e) and not (root / "loras" / "Sub" / "b.safetensors").exists() and not list(root.rglob("*.part")), "fetch: a checksum mismatch is refused and removed")

            nosum = {**good, "id": "c", "match": "c.safetensors", "sha256": None}
            try:
                ivcloud.fetch([nosum], root)
                ok(False, "fetch: a file with no published checksum is refused")
            except RuntimeError as e:
                ok("no published checksum" in str(e) and not (root / "loras" / "Sub" / "c.safetensors").exists(), "fetch: a file with no published checksum is refused before downloading")

            gated = {**good, "id": "g", "match": "g.safetensors", "url": f"{base}/gated", "gated": "https://huggingface.co/x/y"}
            try:
                ivcloud.fetch([gated], root)
                ok(False, "fetch: a gated file without a token is refused")
            except RuntimeError as e:
                ok("Hugging Face token" in str(e) and "huggingface.co/x/y" in str(e), "fetch: a gated file without a token says to add the token and accept the licence")

            # big files: pieces over several connections, through a redirect, checked, resumable
            ivcloud.CHUNK = 256 * 1024
            ivcloud.REFRESH_GAP = 0
            pieces = -(-len(BIG) // ivcloud.CHUNK)
            big = {"id": "big", "label": "Big model", "folder": "diffusion_models", "match": "big.safetensors", "url": f"{base}/to-big", "size": len(BIG), "sha256": BIG_SHA}
            events = []
            host["ranges"] = 0
            ivcloud.fetch([big], root, progress=events.append)
            fb = root / "diffusion_models" / "big.safetensors"
            ok(fb.exists() and fb.read_bytes() == BIG, "fetch: a big file comes down in pieces, byte for byte")
            ok(host["ranges"] >= pieces and not list(root.rglob("*.part*")), f"fetch: {pieces} byte ranges asked for (plus the probe), no .part or .part.json left")
            ok(any(e["state"] == "checking" for e in events) and events[-1]["state"] == "done", "fetch: says when it checks the checksum, then done")
            ok(all("speed" in e for e in events if e["state"] == "downloading"), "fetch: every downloading report has a speed")
            fb.unlink()

            # a piece cut off half way is fetched again, and the file is still exact
            host["flaky"] = {0, 3 * ivcloud.CHUNK, (pieces - 1) * ivcloud.CHUNK}
            ivcloud.fetch([big], root)
            ok(fb.read_bytes() == BIG and not host["flaky"], "fetch: pieces cut off half way are fetched again; the file is exact")
            fb.unlink()

            # the signed address expires part way: a fresh one is asked for and the download goes on
            host["ranges"] = 0
            host["expire_at"] = 8
            ivcloud.fetch([big], root)
            host["expire_at"] = 0
            ok(fb.read_bytes() == BIG and host["gen"] > 1, "fetch: when the signed address expires (403), a fresh one is asked for")
            fb.unlink()

            # stopped part way: what's there is kept, and the next fetch asks only for the rest
            ivcloud.TRIES = 2
            host["ranges"] = 0
            host["down_after"] = pieces // 2  # the host answers 503 from then on
            ivcloud.CONNECTIONS = 2
            meta = {"done": []}
            try:
                ivcloud.fetch([big], root)
                ok(False, "fetch: a host that goes down part way stops the download")
            except RuntimeError as e:
                part = root / "diffusion_models" / "big.safetensors.part"
                meta = json.loads((root / "diffusion_models" / "big.safetensors.part.json").read_text())
                ok("kept" in str(e) and part.exists() and 0 < len(meta["done"]) < pieces and not fb.exists(), f"fetch: a host that goes down part way keeps the {len(meta['done'])} finished pieces")
            host["down_after"] = 0
            ivcloud.CONNECTIONS = 16
            ivcloud.TRIES = 6
            had = len(meta["done"])
            host["ranges"] = 0
            events = []
            ivcloud.fetch([big], root, progress=events.append)
            ok(fb.read_bytes() == BIG and host["ranges"] <= pieces - had + 2, f"fetch: the next try carries on: {host['ranges']} requests for the {pieces - had} pieces left")
            ok(any(e.get("resumed") for e in events if e["state"] == "downloading"), "fetch: it says how much was there already")
            ok(not list(root.rglob("*.part*")), "fetch: nothing half-done left after it carries on")

            # a wrong checksum after a ranged download removes the pieces too
            wrong = {**big, "id": "w", "match": "w.safetensors", "sha256": "0" * 64}
            try:
                ivcloud.fetch([wrong], root)
                ok(False, "fetch: a ranged download with the wrong checksum is refused")
            except RuntimeError as e:
                ok("did not match" in str(e) and not list(root.rglob("w.safetensors*")), "fetch: a ranged download with the wrong checksum is refused, its pieces removed")
            fb.unlink()

            listing = ivcloud.listing(root)
            ok(listing == {"loras/Sub/a.safetensors": len(BODY)}, "listing: model files by relative path, with sizes")
            ok(ivcloud.present([good, bad], root) == ["a"], "present: which of the models are there")

        # the pod's boot status while models download: bytes across the whole download, speed, time left
        import runpod_boot  # noqa: E402

        with tempfile.TemporaryDirectory() as tmp:
            statuses = []
            runpod_boot.MODELS = Path(tmp)
            runpod_boot.STATUS = Path(tmp) / "status.json"
            real_status, real_setup, real_fetch = runpod_boot.status, ivcloud.setup_models, ivcloud.fetch
            runpod_boot.status = lambda stage, detail="", **extra: statuses.append({"stage": stage, "detail": detail, **extra})
            two = [{"id": "x", "label": "Big", "folder": "f", "match": "x.safetensors", "size": 30_000}, {"id": "y", "label": "Small", "folder": "f", "match": "y.safetensors", "size": 10_000}]
            ivcloud.setup_models = lambda cloud, manifest: two

            def fake_fetch(models, root, token=None, progress=None):
                progress({"id": "x", "label": "Big", "index": 1, "count": 2, "state": "downloading", "got": 15_000, "total": 30_000, "percent": 50, "speed": 1_000, "resumed": 9_000})
                progress({"id": "x", "label": "Big", "index": 1, "count": 2, "state": "checking", "got": 0, "total": 30_000, "percent": 0})
                progress({"id": "x", "label": "Big", "index": 1, "count": 2, "state": "done", "got": 30_000, "total": 30_000, "percent": 100})
                progress({"id": "y", "label": "Small", "index": 2, "count": 2, "state": "downloading", "got": 5_000, "total": 10_000, "percent": 50, "speed": 0})
                return ["x", "y"]

            ivcloud.fetch = fake_fetch
            try:
                runpod_boot.fetch_models()
            finally:
                runpod_boot.status, ivcloud.setup_models, ivcloud.fetch = real_status, real_setup, real_fetch
            first, check, second = statuses
            ok(first["bytesDone"] == 15_000 and first["bytesTotal"] == 40_000 and first["eta"] == 25 and first["speed"] == 1_000, "boot: bytes across the whole download, the speed and the time left (25 s for 25 KB at 1 KB/s)")
            ok("MB/s" in first["detail"] and "carrying on" in first["detail"], "boot: the detail says the speed, and that it carried on from an earlier try")
            ok(check["detail"].startswith("Checking Big") and check["bytesDone"] == 30_000, "boot: says when it checks a file")
            ok(second["bytesDone"] == 35_000 and second["eta"] is None and "MB/s" not in second["detail"], "boot: a finished file counts in full; no speed yet means no time left")

        req = "torch>=2.0\ntorchvision\nnumpy\ntorchsde\n  torchaudio==2.1 ; platform_system=='Linux'\nxformers\ntriton-windows\neinops\n"
        kept = ivcloud.requirements_without_torch(req).split("\n")
        ok(kept == ["numpy", "torchsde", "einops"], "requirements: the torch family is left out, torchsde is kept")

        cloud, manifest = ivcloud.load(ROOT / "resources" / "cloud")
        manifest = json.loads((ROOT / "resources" / "models.json").read_text(encoding="utf-8"))
        packs = ivcloud.cloud_packs(manifest)
        dirs = [p["dir"] for p in packs]
        ok(not any(p.get("windowsOnly") for p in packs) and "comfyui-dlss5-enhancer-v15" not in dirs, "packs: DLSS 5 (Windows-only) is left out")
        ok("comfyui-h3-oneclick-swap" not in dirs and "ComfyUI-LTXVideo" in dirs and "seedvr2_videoupscaler" in dirs and "ComfyUI-Viggle-Remake" in dirs and "comfyui-minimaxh3-contex-loop" in dirs, "packs: the old Replace engine's are left out; LTX-Video, SeedVR2, Viggle Remake and Context Loop are in")
        ok(all(p.get("bundled") or ("git" in p and p.get("commit")) or "registry" in p for p in packs), "packs: each is pinned (a git commit, a registry version) or ships inside IV Studio")
        cmds = ivcloud.pack_commands(packs, "/comfy/custom_nodes", "uv pip install --system")
        ok(len(cmds) == 2 * len([p for p in packs if not p.get("bundled")]) and all("grep -viE" in c for c in cmds[1::2]), "packs: one install and one requirements command each, requirements without torch")

        every = ivcloud.catalog(cloud, manifest)
        ok(all(m.get("sha256") or "huggingface.co" in m["url"] for m in every.values()), "catalog: every cloud model has a SHA-256 or comes from Hugging Face (which publishes one)")
        ok(every["ff_ltx_2_5_video_vae_bf16"].get("gated") and every["flux2_unet"].get("gated") and not every["qwen21_unet"].get("gated"), "catalog: LTX and Flux files are gated, Qwen isn't")
        setup = ivcloud.setup_models(cloud, manifest)
        ok({m["id"] for m in setup} == {m["id"] for m in manifest["models"] if not m.get("optional")} | {"esrgan_x2"}, "setup downloads H3's required models and the 2x upscaler only")
        ok(cloud["comfyui"]["tag"] == "v0.44.1" and all("==" in p for p in cloud["torch"]["packages"]), "cloud.json: ComfyUI v0.44.1 and an exactly pinned torch")
        folders = {m["folder"].split("/")[0] for m in every.values()}
        yaml = (ROOT / "resources" / "cloud" / "extra_model_paths.yaml").read_text(encoding="utf-8")
        missing = [f for f in folders if f"  {f}:" not in yaml and f"{f}\n" not in yaml.split(": ", 1)[-1] and not (f == "SEEDVR2" and "seedvr2: SEEDVR2" in yaml)]
        ok(not missing, f"extra_model_paths.yaml maps every cloud model folder{(' (missing: ' + ', '.join(missing) + ')') if missing else ''}")
    finally:
        srv.shutdown()
    print(f"\n{passed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
