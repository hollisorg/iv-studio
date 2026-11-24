"""IV Studio's voice engine: VoxCPM2 (OpenBMB, Apache-2.0) speaks, designs and clones voices; Whisper
large-v3 turbo (OpenAI, MIT) reads the words in a recording. Runs in IV Studio's own Python environment.

  python voice_server.py --download <models dir>   fetch both models (pinned revisions), printing progress
  python voice_server.py --download-splitter <models dir>   fetch Demucs's htdemucs weights (Replace's voice swap)
  python voice_server.py <models dir>               serve: one JSON request per stdin line, one JSON reply
                                                    per stdout line, {"id", "ok", ...} or {"id", "error"}
Requests: {"op": "speak", "text", "out", "ref_wav", "ref_text", "seed", "control", "cfg", "steps"}
          {"op": "design", "text", "description", "out", "seed", "cfg", "steps"}
          control: how to say it, in words ("whispering, out of breath"); cfg: how closely it follows the voice and
          the words, 1.0 to 3.0 (2.0); steps: 4 to 30 (10), more is slower and can be cleaner
          {"op": "transcribe", "file"}
          {"op": "transcribe_timed", "file"}         the words with each segment's start and end, and the language
          {"op": "separate", "file", "vocals", "background"}   voice and background apart (Demucs, MIT; optional)
          {"op": "load"}
Models load on first use and stay loaded until IV Studio stops the process (that is how it frees the GPU).
"""
import json
import os
import sys
import traceback

MODELS = {
    "voxcpm2": ("openbmb/VoxCPM2", "32279effe8c19989596f05d353d1447f51d9e915"),
    "whisper": ("openai/whisper-large-v3-turbo", "41f01f3fe87f28c78e2fbf8b568835947dd65ed9"),
}


def log(*parts):
    print(*parts, file=sys.stderr, flush=True)


def download(root):
    from huggingface_hub import snapshot_download

    for name, (repo, rev) in MODELS.items():
        print(json.dumps({"progress": f"Downloading {repo}…"}), flush=True)
        snapshot_download(repo, revision=rev, local_dir=os.path.join(root, name))
        with open(os.path.join(root, name, ".revision"), "w") as f:
            f.write(rev)
    print(json.dumps({"done": True}), flush=True)


def read_audio(path, sr=None):
    import librosa

    wav, _ = librosa.load(path, sr=sr, mono=True)
    return wav


def patch_torchaudio():
    # torchaudio 2.9 reads files through torchcodec, which needs FFmpeg's shared libraries on Windows.
    # IV Studio hands the engine plain WAVs, so soundfile reads them instead.
    import soundfile as sf
    import torch
    import torchaudio

    def load(path, *args, **kwargs):
        data, rate = sf.read(path, dtype="float32", always_2d=True)
        return torch.from_numpy(data.T.copy()), rate

    torchaudio.load = load


def splitter_dir(root):
    return os.path.join(root, "demucs")


def download_splitter(root):
    # Demucs (Meta, MIT, code and weights) fetches its pretrained weights through torch.hub; they go in IV Studio's
    # models folder, not the person's home
    import torch

    torch.hub.set_dir(splitter_dir(root))
    print(json.dumps({"progress": "Downloading Demucs (htdemucs, about 80 MB)…"}), flush=True)
    from demucs.pretrained import get_model

    get_model("htdemucs")
    print(json.dumps({"done": True}), flush=True)


def tuning(req):
    # cfg and steps, kept to the ranges VoxCPM recommends (a request without them gets its defaults)
    cfg = req.get("cfg")
    steps = req.get("steps")
    cfg = 2.0 if cfg is None else min(3.0, max(1.0, float(cfg)))
    steps = 10 if steps is None else min(30, max(4, int(steps)))
    return cfg, steps


class Engine:
    def __init__(self, root):
        self.root = root
        self.tts = None
        self.asr = None
        self.demucs = None

    def voxcpm(self):
        if self.tts is None:
            patch_torchaudio()
            from voxcpm import VoxCPM

            log("loading VoxCPM2")
            self.tts = VoxCPM.from_pretrained(os.path.join(self.root, "voxcpm2"), load_denoiser=False)
        return self.tts

    def whisper(self):
        # the model itself, not transformers' speech pipeline: the pipeline decodes through torchcodec too
        if self.asr is None:
            import torch
            from transformers import WhisperForConditionalGeneration, WhisperProcessor

            log("loading Whisper")
            cuda = torch.cuda.is_available()
            where = os.path.join(self.root, "whisper")
            model = WhisperForConditionalGeneration.from_pretrained(where, dtype=torch.float16 if cuda else torch.float32).to("cuda" if cuda else "cpu")
            self.asr = (WhisperProcessor.from_pretrained(where), model)
        return self.asr

    def save(self, wav, out):
        import soundfile as sf

        os.makedirs(os.path.dirname(out), exist_ok=True)
        rate = self.voxcpm().tts_model.sample_rate
        sf.write(out + ".part.wav", wav, rate, subtype="PCM_16")
        os.replace(out + ".part.wav", out)
        return {"file": out, "duration": round(len(wav) / rate, 2)}

    def seeded(self, seed):
        # VoxCPM's generate() takes no seed: fixing every generator makes the same seed give the same read
        import random

        import numpy as np
        import torch

        random.seed(int(seed))
        np.random.seed(int(seed) % 2**32)
        torch.manual_seed(int(seed))
        torch.cuda.manual_seed_all(int(seed))

    def speak(self, text, out, ref_wav, ref_text, seed=41, control=None, cfg=2.0, steps=10):
        # "ultimate" cloning: the reference and its words continue straight into the new line. With a control
        # (how to say it), VoxCPM2 can't continue the reference (the CLI refuses --control with --prompt-text), so
        # the line is cloned from the reference alone with the control in front, as VoxCPM's own clone command does
        tts = self.voxcpm()
        self.seeded(seed)
        control = (control or "").strip()
        if control:
            wav = tts.generate(text=f"({control}){text}", reference_wav_path=ref_wav, cfg_value=float(cfg), inference_timesteps=int(steps))
        else:
            wav = tts.generate(text=text, prompt_wav_path=ref_wav, prompt_text=ref_text, reference_wav_path=ref_wav, cfg_value=float(cfg), inference_timesteps=int(steps))
        return self.save(wav, out)

    def design(self, text, description, out, seed=1, cfg=2.0, steps=10):
        tts = self.voxcpm()
        self.seeded(seed)
        wav = tts.generate(text=f"({description}){text}", cfg_value=float(cfg), inference_timesteps=int(steps))
        return self.save(wav, out)

    def transcribe(self, file):
        import torch

        processor, model = self.whisper()
        audio = read_audio(file, 16000)
        words = []
        for start in range(0, max(len(audio), 1), 30 * 16000):  # Whisper hears 30 s at a time
            chunk = audio[start : start + 30 * 16000]
            if len(chunk) < 1600:
                continue
            features = processor(chunk, sampling_rate=16000, return_tensors="pt").input_features.to(model.device, model.dtype)
            with torch.no_grad():
                ids = model.generate(features, task="transcribe")
            words.append(processor.batch_decode(ids, skip_special_tokens=True)[0].strip())
        return {"text": " ".join(w for w in words if w)}

    def transcribe_timed(self, file):
        # the same model, asked for its timestamps: one {start, end, text} per segment, times in seconds
        import torch

        processor, model = self.whisper()
        audio = read_audio(file, 16000)
        segments, language = [], None
        for start in range(0, max(len(audio), 1), 30 * 16000):
            chunk = audio[start : start + 30 * 16000]
            if len(chunk) < 1600:
                continue
            features = processor(chunk, sampling_rate=16000, return_tensors="pt").input_features.to(model.device, model.dtype)
            with torch.no_grad():
                ids = model.generate(features, task="transcribe", return_timestamps=True)
            ids = ids[0] if hasattr(ids, "shape") and len(ids.shape) > 1 else ids
            out = processor.tokenizer.decode(ids, output_offsets=True)
            if language is None:
                # generate leaves its prompt tokens (<|en|> and the rest) out of what it returns, so ask for it directly
                with torch.no_grad():
                    found = processor.tokenizer.decode(model.detect_language(features)[0]).strip("<|>")
                language = found if found.isalpha() and len(found) <= 3 else None
            offset = start / 16000
            for o in out.get("offsets") or []:
                a, b = o["timestamp"]
                text = (o.get("text") or "").strip()
                if text and a is not None and b is not None and b > a:
                    segments.append({"start": round(offset + a, 3), "end": round(offset + b, 3), "text": text})
        return {"segments": segments, "language": language, "duration": round(len(audio) / 16000, 3)}

    def separate(self, file, vocals, background):
        # Demucs htdemucs: the voices in one file, everything else (room, music, effects) in another, both at the
        # input's rate. The input is a 44.1 kHz stereo WAV (IV Studio converts it first).
        import importlib

        import numpy as np
        import soundfile as sf
        import torch

        importlib.invalidate_caches()  # Demucs may have been installed while this process ran
        if self.demucs is None:
            torch.hub.set_dir(splitter_dir(self.root))
            from demucs.pretrained import get_model

            log("loading Demucs")
            self.demucs = get_model("htdemucs").eval().to("cuda" if torch.cuda.is_available() else "cpu")
        from demucs.apply import apply_model

        data, rate = sf.read(file, dtype="float32", always_2d=True)
        wav = torch.from_numpy(data.T.copy())
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        wav = wav[:2]
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        dev = next(self.demucs.parameters()).device
        with torch.no_grad():
            out = apply_model(self.demucs, ((wav - mean) / std)[None].to(dev), device=dev, shifts=1, split=True, overlap=0.25, progress=False)[0]
        out = (out * std + mean).cpu()
        voc = out[self.demucs.sources.index("vocals")]
        rest = wav - voc  # the background as the mix minus the voice, so nothing else is lost
        for path, x in ((vocals, voc), (background, rest)):
            os.makedirs(os.path.dirname(path), exist_ok=True)
            sf.write(path + ".part.wav", np.clip(x.numpy().T, -1, 1), rate, subtype="PCM_16")
            os.replace(path + ".part.wav", path)
        return {"vocals": vocals, "background": background, "rate": rate}

    def handle(self, req):
        op = req.get("op")
        if op == "speak":
            return self.speak(req["text"], req["out"], req["ref_wav"], req.get("ref_text") or "", req.get("seed", 41), req.get("control"), *tuning(req))
        if op == "design":
            return self.design(req["text"], req["description"], req["out"], req.get("seed", 1), *tuning(req))
        if op == "transcribe":
            return self.transcribe(req["file"])
        if op == "transcribe_timed":
            return self.transcribe_timed(req["file"])
        if op == "separate":
            return self.separate(req["file"], req["vocals"], req["background"])
        if op == "load":
            self.voxcpm()
            return {"loaded": True}
        raise ValueError(f"unknown op {op}")


def serve(root):
    # stdout carries only the replies; anything a library prints goes to stderr
    replies = sys.stdout
    sys.stdout = sys.stderr
    send = lambda obj: (replies.write(json.dumps(obj) + "\n"), replies.flush())
    engine = Engine(root)
    send({"ready": True})
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        try:
            reply = {"id": req.get("id"), "ok": True, **engine.handle(req)}
        except Exception as err:  # reported to IV Studio, which shows it
            log(traceback.format_exc())
            reply = {"id": req.get("id"), "error": f"{type(err).__name__}: {err}"}
        send(reply)


if __name__ == "__main__":
    if sys.argv[1] == "--download":
        download(sys.argv[2])
    elif sys.argv[1] == "--download-splitter":
        download_splitter(sys.argv[2])
    else:
        serve(sys.argv[1])
