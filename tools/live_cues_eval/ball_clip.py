# usage: python ball_clip.py <clip.mp4> <out.json> <ball3f_v2.onnx> [every_s=0.15]
# Runs the ball detector the way the app's worker does: 3 frames in a row (480x270, BGR, 0-1, edge-padded to 272),
# one set every `every_s` seconds (the phone can't keep up with every frame). Output: [{t, x, y, s}] with x, y 0-1.
import sys, json, cv2, numpy as np, onnxruntime as ort
clip, out, model = sys.argv[1:4]; every = float(sys.argv[4]) if len(sys.argv) > 4 else 0.15
S = ort.InferenceSession(model); cap = cv2.VideoCapture(clip); buf = []; res = []; next_t = 0.0
while True:
    ok, fr = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000
    if t + 1e-6 < next_t and not buf: continue
    buf.append(cv2.resize(fr, (480, 270), interpolation=cv2.INTER_AREA))
    if len(buf) < 3: continue
    x = np.concatenate(buf, 2).astype(np.float32) / 255
    x = np.pad(x[None], ((0, 0), (1, 1), (0, 0), (0, 0)), mode="edge").transpose(0, 3, 1, 2)
    h = S.run(None, {"frames": x})[0][0, 0]
    yy, xx = np.unravel_index(h.argmax(), h.shape)
    res.append({"t": round(t, 3), "x": (xx * 2 + .5) / 480, "y": (yy * 2 - .5) / 270, "s": float(1 / (1 + np.exp(-h[yy, xx])))})
    buf = []; next_t = t + every
json.dump(res, open(out, "w")); print(clip, len(res), "ball finds >= 0.3:", sum(r["s"] >= .3 for r in res))
