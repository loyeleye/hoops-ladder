import numpy as np, json, sys, os
RMIN,RMAX=(7,18) if os.environ.get("BALL")=="dark" else (12,28)
DARK=os.environ.get("BALL")=="dark"
def ok(c,P):
    if P is None: return True
    P=np.array(P); nose=P[0,:2]; ear=np.linalg.norm(P[7,:2]-P[8,:2])
    sh=(P[11,:2]+P[12,:2])/2; hip=(P[23,:2]+P[24,:2])/2; tor=np.linalg.norm(sh-hip)
    xy=np.array([c["x"],c["y"]])
    if np.linalg.norm(xy-nose)<max(ear*1.3,tor*.45): return False   # head
    if xy[1]<sh[1]-tor*.1: return False   # above shoulders: not dribbling
    if DARK:
        hw=abs(P[23,0]-P[24,0])*.75; kn=(P[25,1]+P[26,1])/2
        if abs(xy[0]-hip[0])<hw and hip[1]-tor*.1<xy[1]<kn-tor*.15: return False
    w=min(np.linalg.norm(xy-P[15,:2]),np.linalg.norm(xy-P[16,:2]))
    ank=P[[27,28],:2]; lo,hi=ank[:,0].min()-tor*.7,ank[:,0].max()+tor*.7
    return w<tor*1.3 or (lo<=xy[0]<=hi and xy[1]>hip[1])
def run(nm):
    T=json.load(open(f"data/{nm}_trk.json")); P=json.load(open(f"data/{nm}_pose.json"))
    n=len(P); pick=[None]*n
    for t,cs in enumerate(T["cands"]):
        good=[c for c in cs if c["area"]>=120 and c["fill"]>.45 and c["asp"]>.45 and RMIN<=max(c["w"],c["h"])/2<=RMAX and ok(c,P[t])]
        if good: pick[t]=max(good,key=lambda c:c["area"]*c["fill"])
    lab=[None]*n
    for t in range(n):
        p=pick[t]
        if p is None: continue
        nb=sum(1 for d in (-2,-1,1,2) if 0<=t+d<n and pick[t+d] is not None and np.hypot(pick[t+d]["x"]-p["x"],pick[t+d]["y"]-p["y"])<45*abs(d))
        if nb>=2 and p["fill"]>.55 and p["asp"]>.6: lab[t]=dict(t=t,x=p["x"],y=p["y"],r=max(p["w"],p["h"])/2)
    json.dump(lab,open(f"data/{nm}_lab.json","w"))
    json.dump([dict(t=t,x=p["x"],y=p["y"],r=max(p["w"],p["h"])/2) if p else None for t,p in enumerate(pick)],open(f"data/{nm}_pick.json","w"))
    print(nm,"pick",round(np.mean([p is not None for p in pick]),3),"label",round(np.mean([l is not None for l in lab]),3))
if __name__=="__main__":
    for nm in sys.argv[1:]: run(nm)
