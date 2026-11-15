import numpy as np, cv2, json
a=np.load("data/c01.npy"); f=a[9]
hsv=cv2.cvtColor(f,cv2.COLOR_BGR2HSV).astype(int)
yy,xx=np.mgrid[:270,:480]; m=(xx-219)**2+(yy-106)**2<(17*.8)**2
h=hsv[...,0][m]; s=hsv[...,1][m]; v=hsv[...,2][m]
hc=np.where(h>90,h-180,h)
print("hue pct",np.percentile(hc,[5,25,50,75,95]),"sat",np.percentile(s,[5,25,50]),"val",np.percentile(v,[5,50]))
lo,hi=np.percentile(hc,5),np.percentile(hc,95); sf=np.percentile(s,10); vf=np.percentile(v,5)
json.dump(dict(hlo=float(lo)-2,hhi=float(hi)+2,smin=float(sf),vmin=float(vf)*0.6),open("snap.json","w"))
print(open("snap.json").read())
# contrast: share of whole frame matching
def mask(img,c):
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV).astype(int); h=hsv[...,0]; h=np.where(h>90,h-180,h)
    return (h>=c["hlo"])&(h<=c["hhi"])&(hsv[...,1]>=c["smin"])&(hsv[...,2]>=c["vmin"])
c=json.load(open("snap.json")); mm=mask(f,c); print("frame match share",mm.mean())
cv2.imwrite("fr/mask.png",(mm*255).astype(np.uint8))
