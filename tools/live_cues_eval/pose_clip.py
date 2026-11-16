# usage: python -I pose_clip.py <clip.mp4> <out.json> <model.task>  -> per-frame landmarks at ~20 fps
import sys, json, cv2, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
clip, out, model = sys.argv[1:4]
o = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_poses=1)
L = vision.PoseLandmarker.create_from_options(o)
cap = cv2.VideoCapture(clip); fps = cap.get(cv2.CAP_PROP_FPS) or 30
res = []; ar = 1; i = 0; next_t = 0.0; last = -1
while True:
    ok, fr = cap.read()
    if not ok: break
    t = cap.get(cv2.CAP_PROP_POS_MSEC) / 1000 or i / fps; i += 1
    if t + 1e-6 < next_t: continue
    next_t = t + 0.05
    h, w = fr.shape[:2]
    if w > 720: fr = cv2.resize(fr, (720, int(h * 720 / w))) if w < h else cv2.resize(fr, (int(w * 720 / h), 720))
    ar = fr.shape[1] / fr.shape[0]
    ms = max(int(t * 1000), last + 1); last = ms
    r = L.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)), ms)
    lm = [[round(p.x, 4), round(p.y, 4), round(p.visibility, 3)] for p in r.pose_landmarks[0]] if r.pose_landmarks else None
    res.append({"t": round(t, 3), "lm": lm})
json.dump({"ar": ar, "fr": res}, open(out, "w"))
print(clip, len(res), sum(1 for r in res if r["lm"]))
