import numpy as np, json, sys
D=__import__("os").environ.get("CLIPS","movecheck2/")
CALLS={"c01":"movecheck_01_crossover (3).json","c02b":"movecheck_02b_between-square-stance (3).json","c03":"movecheck_03_behind-the-back (3).json","c14":"movecheck_14_mixed-bag (4).json","c15a":"movecheck_15a_eyes-up-signals-round-1 (4).json"}
MV=("cross","between","behind")
def feats(nm,track):
    """track: list per frame of None or dict(x,y). returns list of (move, featvec)"""
    calls=json.load(open(D+CALLS[nm]))["calls"]; ts=np.load(f"data/{nm}_t.npy"); P=json.load(open(f"data/{nm}_pose.json"))
    out=[]
    for i,c in enumerate(calls):
        if c["move"] not in MV: continue
        t0=c["t"]+.2; t1=min(c["t"]+1.8, calls[i+1]["t"]+.3 if i+1<len(calls) else 1e9)
        fr=[k for k in range(len(ts)) if t0<=ts[k]<=t1 and P[k]]
        hid=0; btw=[]; low=[]; side=None; lastseen=None; gaps=[]
        for k in fr:
            p=np.array(P[k]); hip=(p[23,:2]+p[24,:2])/2; sh=(p[11,:2]+p[12,:2])/2; tor=np.linalg.norm(sh-hip)
            knee=(p[25,1]+p[26,1])/2; ank=p[[27,28],:2]; ay=ank[:,1].mean(); lo,hi=sorted(ank[:,0])
            b=track[k]
            if b is None: hid+=1; continue
            bx,by=b["x"],b["y"]
            if by>knee-.1*tor:
                btw.append(1.0 if lo+.1*(hi-lo)<bx<hi-.1*(hi-lo) else 0.0)
                low.append((by-ay)/tor)
            s_=np.sign(bx-hip[0])
            if side is not None and s_!=side: gaps.append(k-lastseen)
            side=s_; lastseen=k
        n=max(len(fr),1)
        f=[hid/n, np.mean(btw) if btw else .5, np.max(low) if low else -.3, (max(gaps) if gaps else 15)/30]
        out.append((c["move"],np.array(f,float)))
    return out
def fit(X,y):
    mu=X.mean(0); sd=X.std(0)+1e-6; C={m:((X[y==m]-mu)/sd).mean(0) for m in MV}; return mu,sd,C
def pred(m,X):
    mu,sd,C=m; Z=(X-mu)/sd; return np.array([min(MV,key=lambda k:np.sum((z-C[k])**2)) for z in Z])
def evaluate(tracks,label):
    tr=[r for nm in ("c01","c02b","c03") for r in feats(nm,tracks[nm])]
    te={nm:feats(nm,tracks[nm]) for nm in ("c14","c15a")}
    X=np.array([f for _,f in tr]); y=np.array([m for m,_ in tr])
    # leave-one-out on train
    loo=sum(pred(fit(np.delete(X,i,0),np.delete(y,i)),X[i:i+1])[0]==y[i] for i in range(len(y)))
    m=fit(X,y); res={}
    for nm,r in te.items():
        Xt=np.array([f for _,f in r]); yt=np.array([mm for mm,_ in r]); p=pred(m,Xt)
        res[nm]=(int((p==yt).sum()),len(yt),{k:f"{int(((p==yt)&(yt==k)).sum())}/{int((yt==k).sum())}" for k in MV})
    tot=sum(v[0] for v in res.values()); n=sum(v[1] for v in res.values())
    print(f"{label}: train fit {int((pred(m,X)==y).sum())}/{len(y)}, LOO {loo}/{len(y)}, held-out {tot}/{n}", res)
    print("  seen in windows (train mean hidden frac):", np.round(1-X[:,0].mean(),2), " held-out:", np.round(1-np.mean([f[0] for r in te.values() for _,f in r]),2))
if __name__=="__main__":
    src=sys.argv[1]
    tracks={nm:json.load(open(f"data/{nm}_{src}.json")) for nm in CALLS}
    evaluate(tracks,src)
