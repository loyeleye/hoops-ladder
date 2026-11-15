import cv2, numpy as np, sys, os, json
src, name = sys.argv[1], sys.argv[2]
cap=cv2.VideoCapture(src); fr=[]; ts=[]
while True:
    ok,img=cap.read()
    if not ok: break
    ts.append(cap.get(cv2.CAP_PROP_POS_MSEC)/1000)
    fr.append(cv2.resize(img,(480,270),interpolation=cv2.INTER_AREA))
a=np.stack(fr); np.save(f"data/{name}.npy",a); np.save(f"data/{name}_t.npy",np.array(ts))
print(name,a.shape, ts[:3], ts[-1])
