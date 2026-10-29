"""IV Studio's voice engine: VoxCPM2 (OpenBMB, Apache-2.0) speaks, designs and clones voices; Whisper
large-v3 turbo (OpenAI, MIT) reads the words in a recording. Runs in IV Studio's own Python environment.

  python voice_server.py --download <models dir>   fetch both models (pinned revisions), printing progress
  python voice_server.py <models dir>               serve: one JSON request per stdin line, one JSON reply
                                                    per stdout line, {"id", "ok", ...} or {"id", "error"}
Requests: {"op": "speak", "text", "out", "ref_wav", "ref_text", "seed"}
          {"op": "design", "text", "description", "out", "seed"}
          {"op": "transcribe", "file"}
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


class Engine:
    def __init__(self, root):
        self.root = root
        self.tts = None
        self.asr = None

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

    def speak(self, text, out, ref_wav, ref_text, seed=41):
        # "ultimate" cloning: the reference and its words continue straight into the new line
        tts = self.voxcpm()
        self.seeded(seed)
        wav = tts.generate(text=text, prompt_wav_path=ref_wav, prompt_text=ref_text, reference_wav_path=ref_wav, cfg_value=2.0, inference_timesteps=10)
        return self.save(wav, out)

    def design(self, text, description, out, seed=1):
        tts = self.voxcpm()
        self.seeded(seed)
        wav = tts.generate(text=f"({description}){text}", cfg_value=2.0, inference_timesteps=10)
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

    def handle(self, req):
        op = req.get("op")
        if op == "speak":
            return self.speak(req["text"], req["out"], req["ref_wav"], req.get("ref_text") or "", req.get("seed", 41))
        if op == "design":
            return self.design(req["text"], req["description"], req["out"], req.get("seed", 1))
        if op == "transcribe":
            return self.transcribe(req["file"])
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
    else:
        serve(sys.argv[1])
