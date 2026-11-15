import numpy as np, cv2, json, sys
C=dict(hlo=-9,hhi=15,smin=70,vmin=45)
def cmask(img):
    hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); h=hsv[...,0].astype(np.int16); h=np.where(h>90,h-180,h)
    return ((h>=C["hlo"])&(h<=C["hhi"])&(hsv[...,1]>=C["smin"])&(hsv[...,2]>=C["vmin"])).astype(np.uint8)
def run(name):
    a=np.load(f"data/{name}.npy"); n=len(a)
    g=np.stack([cv2.GaussianBlur(cv2.cvtColor(x,cv2.COLOR_BGR2GRAY),(5,5),0) for x in a]).astype(np.int16)
    cands=[]
    k=np.ones((3,3),np.uint8)
    for t in range(n):
        p=g[max(t-2,0)]; q=g[min(t+2,n-1)]
        mot=((np.abs(g[t]-p)>16)|(np.abs(g[t]-q)>16)).astype(np.uint8)
        mot=cv2.dilate(mot,k,iterations=2)
        cm=cmask(a[t]); m=cv2.morphologyEx(cm&mot,cv2.MORPH_OPEN,k); m=cv2.morphologyEx(m,cv2.MORPH_CLOSE,k,iterations=2)
        nl,lab,st,cen=cv2.connectedComponentsWithStats(m)
        cs=[]
        for i in range(1,nl):
            x,y,w,h,ar=st[i]
            if ar<50 or ar>2500: continue
            r=max(w,h)/2; fill=ar/(np.pi*r*r); asp=min(w,h)/max(w,h)
            # moving-color fraction inside a circle around centroid
            cs.append(dict(x=float(cen[i][0]),y=float(cen[i][1]),w=int(w),h=int(h),area=int(ar),fill=float(fill),asp=float(asp)))
        cands.append(cs)
    # pick per frame: best round blob; temporal consistency
    pick=[None]*n
    for t,cs in enumerate(cands):
        good=[c for c in cs if c["area"]>=120 and c["fill"]>.45 and c["asp"]>.45 and 7<=max(c["w"],c["h"])/2<=26]
        if good: pick[t]=max(good,key=lambda c:c["area"]*c["fill"])
    conf=[False]*n
    for t in range(n):
        if pick[t] is None: continue
        nb=0
        for d in (-2,-1,1,2):
            u=t+d
            if 0<=u<n and pick[u] is not None and np.hypot(pick[u]["x"]-pick[t]["x"],pick[u]["y"]-pick[t]["y"])<45*abs(d): nb+=1
        conf[t]=nb>=2 and pick[t]["fill"]>.55 and pick[t]["asp"]>.6
    lab=[dict(t=t,x=p["x"],y=p["y"],r=max(p["w"],p["h"])/2) if (p and conf[t]) else None for t,p in enumerate(pick)]
    json.dump(dict(cands=cands,labels=lab),open(f"data/{name}_trk.json","w"))
    print(name,"any",np.mean([p is not None for p in pick]).round(3),"confident",np.mean(conf).round(3))
for nm in sys.argv[1:]: run(nm)
