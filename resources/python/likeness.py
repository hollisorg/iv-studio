"""How closely faces match a reference face, for picking character stills and clips.

    likeness.py <buffalo_l folder> <reference image> <image or video> ...  ->  JSON on stdout

InsightFace's own buffalo_l pipeline, run with ONNX Runtime and OpenCV (no insightface package, which
often fails to build on Windows): SCRFD (det_10g) finds the largest face and its five points, the face is
aligned to ArcFace's template, and ArcFace (w600k_r50) embeds it. The models are InsightFace's and are
for non-commercial research use; the user downloads them. The score is the cosine similarity with the
reference face: above 0.6 reads as the same person, 0.4-0.6 a family resemblance, below 0.4 someone else.
"""
import json
import os
import sys

import cv2
import numpy as np
import onnxruntime as ort

TEMPLATE = np.array([[38.2946, 51.6963], [73.5318, 51.5014], [56.0252, 71.7366], [41.5493, 92.3655], [70.7299, 92.2041]], np.float32)


class SCRFD:
    """InsightFace's face detector (det_10g): 640x640 letterbox, three strides, two anchors per cell."""

    def __init__(self, path):
        self.s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
        self.input = self.s.get_inputs()[0].name

    def detect(self, img, size=640, threshold=0.5):
        h, w = img.shape[:2]
        scale = size / max(h, w)
        nh, nw = int(h * scale), int(w * scale)
        canvas = np.zeros((size, size, 3), np.uint8)
        canvas[:nh, :nw] = cv2.resize(img, (nw, nh))
        blob = cv2.dnn.blobFromImage(canvas, 1 / 128, (size, size), (127.5, 127.5, 127.5), swapRB=True)
        out = self.s.run(None, {self.input: blob})
        boxes, points, scores = [], [], []
        for i, stride in enumerate((8, 16, 32)):
            sc = out[i].reshape(-1)
            bb = out[i + 3].reshape(-1, 4) * stride
            kp = out[i + 6].reshape(-1, 10) * stride
            gh = gw = size // stride
            ys, xs = np.mgrid[:gh, :gw]
            centers = np.repeat(np.stack([xs, ys], -1).reshape(-1, 2) * stride, 2, axis=0).astype(np.float32)
            keep = sc >= threshold
            c = centers[keep]
            boxes.append(np.hstack([c - bb[keep][:, :2], c + bb[keep][:, 2:]]))
            points.append((kp[keep].reshape(-1, 5, 2) + c[:, None, :]))
            scores.append(sc[keep])
        boxes, points, scores = np.vstack(boxes) / scale, np.vstack(points) / scale, np.concatenate(scores)
        if not len(scores):
            return []
        xywh = np.hstack([boxes[:, :2], boxes[:, 2:] - boxes[:, :2]])
        order = cv2.dnn.NMSBoxes(xywh.tolist(), scores.tolist(), threshold, 0.4)
        return [(boxes[i], points[i], scores[i]) for i in np.array(order).ravel()]


def embed(arcface, img, points):
    m, _ = cv2.estimateAffinePartial2D(points.astype(np.float32), TEMPLATE, method=cv2.LMEDS)
    face = cv2.warpAffine(img, m, (112, 112), borderValue=0)
    blob = cv2.dnn.blobFromImage(face, 1 / 127.5, (112, 112), (127.5, 127.5, 127.5), swapRB=True)
    v = arcface.run(None, {arcface.get_inputs()[0].name: blob})[0][0]
    return v / np.linalg.norm(v)


def load(path):
    img = cv2.imdecode(np.fromfile(path, np.uint8), cv2.IMREAD_COLOR)  # handles non-ASCII paths
    if img is None:  # a video: its first frame
        cap = cv2.VideoCapture(path)
        ok, img = cap.read()
        cap.release()
        img = img if ok else None
    return img


def largest(faces):
    return max(faces, key=lambda f: (f[0][2] - f[0][0]) * (f[0][3] - f[0][1])) if faces else None


def main():
    models, ref, *files = sys.argv[1:]
    det = SCRFD(os.path.join(models, "det_10g.onnx"))
    arcface = ort.InferenceSession(os.path.join(models, "w600k_r50.onnx"), providers=["CPUExecutionProvider"])
    img = load(ref)
    face = largest(det.detect(img)) if img is not None else None
    if face is None:
        print(json.dumps({"error": "No face found in the reference picture."}))
        return
    ref_v = embed(arcface, img, face[1])
    results = []
    for f in files:
        img = load(f)
        if img is None:
            results.append({"file": f, "score": None, "faces": 0, "error": "unreadable"})
            continue
        faces = det.detect(img)
        best = largest(faces)
        results.append({"file": f, "score": None if best is None else round(float(np.dot(ref_v, embed(arcface, img, best[1]))), 4), "faces": len(faces)})
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main()
