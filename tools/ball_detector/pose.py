import numpy as np, sys, mediapipe as mp, json
from mediapipe.tasks.python import vision, BaseOptions
nm=sys.argv[1]; a=np.load(f"data/{nm}.npy",mmap_mode="r"); ts=np.load(f"data/{nm}_t.npy")
o=vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=__import__("os").environ.get("POSE_MODEL","www/pose_landmarker_lite.task")),running_mode=vision.RunningMode.VIDEO,num_poses=1)
L=vision.PoseLandmarker.create_from_options(o); out=[]; last=-1
for i in range(len(a)):
    ms=int(ts[i]*1000); ms=max(ms,last+1); last=ms
    r=L.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(a[i][:,:,::-1])),ms)
    out.append([[round(p.x*480,1),round(p.y*270,1),round(p.visibility,3)] for p in r.pose_landmarks[0]] if r.pose_landmarks else None)
json.dump(out,open(f"data/{nm}_pose.json","w")); print(nm,sum(o is not None for o in out)/len(out))
