"""A soft-mouth mask for a reference video: where each person's mouth and jaw are, frame by frame.

    mouth_track.py <buffalo_l folder> <video> <ffmpeg> <mask out (.mkv)>  ->  JSON on stdout
    mouth_track.py --motion <buffalo_l folder> <video>                      ->  JSON on stdout

--motion (Replace's voice swap): no mask; instead each tracked face, frame by frame, with how much its mouth moved
since the frame before ([frame, cx, cy, face width, motion]), so IV Studio can tell who is talking when.

InsightFace's SCRFD detector (det_10g, from the buffalo_l pack the person downloads, run with ONNX Runtime and
OpenCV like likeness.py) finds every face and its five points. Over the mouth corners and down to the chin an
ellipse is drawn white on black, smoothed over time so it doesn't jitter, and kept for a few frames when a face
is briefly lost. The mask goes to ffmpeg as a lossless video the same size and length as the source; IV Studio
then blurs the source under it, so H3 sees the face but not the words being mouthed (idea from keys + Sam
Wasserman's Imagination Studio, soft_mouth; our own code).
"""
import json
import os
import subprocess
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from likeness import SCRFD  # noqa: E402

HOLD = 6  # frames an ellipse stays after its face is lost
EASE = 0.5  # how far each frame moves towards the new ellipse


def ellipse(box, pts):
    """Centre, half-width, half-height and tilt of the area to soften: the mouth and the jaw under it."""
    x0, y0, x1, y1 = box
    eye_l, eye_r, nose, mouth_l, mouth_r = pts
    face_w = x1 - x0
    mouth = (mouth_l + mouth_r) / 2
    chin = y1
    cx = float(mouth[0])
    cy = float(mouth[1] + 0.3 * (chin - mouth[1]))
    hw = float(max(np.linalg.norm(mouth_r - mouth_l) * 0.95, face_w * 0.3))
    hh = float(max((chin - nose[1]) * 0.62, face_w * 0.2))
    angle = float(np.degrees(np.arctan2(mouth_r[1] - mouth_l[1], mouth_r[0] - mouth_l[0])))
    return [cx, cy, hw, hh, angle]


def main(models, video, ffmpeg, out):
    det = SCRFD(os.path.join(models, "det_10g.onnx"))
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(json.dumps({"error": "The video couldn't be opened."}))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    enc = subprocess.Popen(
        [ffmpeg, "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{w}x{h}", "-r", f"{fps:.6f}", "-i", "-", "-c:v", "ffv1", "-pix_fmt", "gray", out],
        stdin=subprocess.PIPE,
    )
    tracks = []  # [{ "e": ellipse, "lost": frames since seen }]
    frames = with_face = 0
    while True:
        ok, img = cap.read()
        if not ok:
            break
        frames += 1
        found = [ellipse(b, p) for b, p, s in det.detect(img, threshold=0.45) if (b[2] - b[0]) >= 24]
        used = set()
        for t in tracks:
            # the nearest new ellipse is this face's, if it's close enough
            best = None
            for i, e in enumerate(found):
                d = np.hypot(e[0] - t["e"][0], e[1] - t["e"][1])
                if i not in used and d < 2 * t["e"][2] and (best is None or d < best[1]):
                    best = (i, d)
            if best:
                used.add(best[0])
                t["e"] = [a + EASE * (b - a) for a, b in zip(t["e"], found[best[0]])]
                t["lost"] = 0
            else:
                t["lost"] += 1
        tracks = [t for t in tracks if t["lost"] <= HOLD] + [{"e": e, "lost": 0} for i, e in enumerate(found) if i not in used]
        mask = np.zeros((h, w), np.uint8)
        for t in tracks:
            cx, cy, hw, hh, a = t["e"]
            cv2.ellipse(mask, (int(cx), int(cy)), (int(hw), int(hh)), a, 0, 360, 255, -1)
        if found:
            with_face += 1
        enc.stdin.write(mask.tobytes())
    cap.release()
    enc.stdin.close()
    enc.wait()
    if enc.returncode != 0:
        raise SystemExit(json.dumps({"error": "ffmpeg couldn't write the mask."}))
    print(json.dumps({"frames": frames, "withFace": with_face, "width": w, "height": h, "fps": fps}))


def motion(models, video):
    det = SCRFD(os.path.join(models, "det_10g.onnx"))
    cap = cv2.VideoCapture(video)
    if not cap.isOpened():
        raise SystemExit(json.dumps({"error": "The video couldn't be opened."}))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    tracks = []  # [{ "id", "e", "lost", "prev": last mouth patch, "rows": [[frame, cx, cy, width, motion]] }]
    done = []
    next_id = 0
    frame = -1
    while True:
        ok, img = cap.read()
        if not ok:
            break
        frame += 1
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        found = [(ellipse(b, p), float(b[2] - b[0])) for b, p, s in det.detect(img, threshold=0.45) if (b[2] - b[0]) >= 24]
        used = set()
        for t in tracks:
            best = None
            for i, (e, _) in enumerate(found):
                d = np.hypot(e[0] - t["e"][0], e[1] - t["e"][1])
                if i not in used and d < 2 * t["e"][2] and (best is None or d < best[1]):
                    best = (i, d)
            if best:
                used.add(best[0])
                t["e"], t["width"] = found[best[0]]
                t["lost"] = 0
            else:
                t["lost"] += 1
                t["prev"] = None
        gone = [t for t in tracks if t["lost"] > HOLD]
        done += gone
        tracks = [t for t in tracks if t["lost"] <= HOLD]
        for i, (e, width) in enumerate(found):
            if i not in used:
                tracks.append({"id": next_id, "e": e, "width": width, "lost": 0, "prev": None, "rows": []})
                next_id += 1
        for t in tracks:
            if t["lost"]:
                continue
            cx, cy, hw, hh, _ = t["e"]
            x0, x1 = int(max(0, cx - hw)), int(min(w, cx + hw))
            y0, y1 = int(max(0, cy - hh)), int(min(h, cy + hh))
            if x1 - x0 < 4 or y1 - y0 < 4:
                continue
            patch = cv2.resize(gray[y0:y1, x0:x1], (32, 24), interpolation=cv2.INTER_AREA).astype(np.float32)
            # the mouth's own movement: the patch against the last frame's, after taking out overall brightness
            patch -= patch.mean()
            m = float(np.abs(patch - t["prev"]).mean()) if t["prev"] is not None else 0.0
            t["prev"] = patch
            t["rows"].append([frame, round(cx, 1), round(cy, 1), round(t["width"], 1), round(m, 3)])
    cap.release()
    faces = [{"id": t["id"], "rows": t["rows"]} for t in done + tracks if len(t["rows"]) >= 3]
    print(json.dumps({"frames": frame + 1, "fps": fps, "width": w, "height": h, "faces": faces}))


if __name__ == "__main__":
    if sys.argv[1] == "--motion":
        motion(*sys.argv[2:4])
    else:
        main(*sys.argv[1:5])
