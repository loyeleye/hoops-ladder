import numpy as np, json, sys
from moves import D, CALLS, MV, fit, pred
NAMES="gap cross_y_knee cross_y_hip bounce_y bounce_in_ankles min_y found min_score mean_score".split()
def series(nm,track):
    ts=np.load(f"data/{nm}_t.npy"); P=json.load(open(f"data/{nm}_pose.json")); S=[]
    for k in range(len(ts)):
        p=P[k]; b=track[k]
        if not p: S.append(None); continue
        p=np.array(p); hip=(p[23,:2]+p[24,:2])/2; tor=np.linalg.norm((p[11,:2]+p[12,:2])/2-hip)
        ay=p[[27,28],1].mean(); ky=p[[25,26],1].mean(); ax=sorted(p[[27,28],0])
        S.append(dict(tor=tor,hip=hip,ay=ay,ky=ky,ax=ax,b=b))
    return ts,S
def feats(nm,track,maxlag=4.0):
    calls=json.load(open(CALLS[nm]))["calls"]; ts,S=series(nm,track); out=[]
    for i,c in enumerate(calls):
        if c["move"] not in MV: continue
        tend=min(c["t"]+maxlag, calls[i+1]["t"]+.3 if i+1<len(calls) else 1e9)
        ks=[k for k in range(len(ts)) if c["t"]+.2<=ts[k]<=tend and S[k]]
        last=None; ev=None
        for k in ks:
            s=S[k]; b=s["b"]
            if b is None: continue
            rx=(b["x"]-s["hip"][0])/s["tor"]
            if abs(rx)<.15: continue
            if last is not None and np.sign(rx)!=np.sign(last[1]): ev=(last[0],k); break
            last=(k,rx)
        if ev is None: out.append((c["move"],np.array([0,0,0,0,0,0,0.,0,0]))); continue
        a,b=ev; gap=(b-a-1)/30
        def rel(k,key): s=S[k]; return (s["b"]["y"]-s[key])/s["tor"]
        cy_k=(rel(a,"ky")+rel(b,"ky"))/2; cy_h=(S[a]["b"]["y"]+S[b]["b"]["y"])/2
        cy_h=(cy_h-(S[a]["hip"][1]+S[b]["hip"][1])/2)/S[a]["tor"]
        near=[k for k in range(a-9,b+10) if 0<=k<len(S) and S[k] and S[k]["b"]]
        bk=max(near,key=lambda k:S[k]["b"]["y"]-S[k]["ay"]); bs=S[bk]
        by=(bs["b"]["y"]-bs["ay"])/bs["tor"]; inank=1.0 if bs["ax"][0]<bs["b"]["x"]<bs["ax"][1] else 0.0
        miny=min((S[k]["b"]["y"]-S[k]["hip"][1])/S[k]["tor"] for k in near)
        sc=[S[k]["b"].get("score",1) for k in range(a-3,b+4) if 0<=k<len(S) and S[k] and S[k]["b"]]
        out.append((c["move"],np.array([gap,cy_k,cy_h,by,inank,miny,1.0,min(sc),np.mean(sc)])))
    return out
def evaluate(tracks,label,show=False,TR=("c01","c02b","c03"),TE=("c14","c15a")):
    tr=[r for nm in TR for r in feats(nm,tracks[nm])]
    te={nm:feats(nm,tracks[nm]) for nm in TE}
    if show:
        for nm in list(TR)+list(TE):
            r=feats(nm,tracks[nm])
            for m in MV:
                X=np.array([f for mm,f in r if mm==m])
                if len(X): print(f"  {nm:5s} {m:8s} n={len(X):2d} "+" ".join(f"{a}={v:.2f}" for a,v in zip(NAMES,X.mean(0))))
    X=np.array([f for _,f in tr]); y=np.array([m for m,_ in tr])
    loo=sum(pred(fit(np.delete(X,i,0),np.delete(y,i)),X[i:i+1])[0]==y[i] for i in range(len(y)))
    m=fit(X,y); res={}
    for nm,r in te.items():
        Xt=np.array([f for _,f in r]); yt=np.array([mm for mm,_ in r]); p=pred(m,Xt)
        res[nm]=(int((p==yt).sum()),len(yt),{k:f"{int(((p==yt)&(yt==k)).sum())}/{int((yt==k).sum())}" for k in MV})
    print(f"{label}: LOO {loo}/{len(y)}, held-out {sum(v[0] for v in res.values())}/{sum(v[1] for v in res.values())}", res)
if __name__=="__main__":
    src=sys.argv[1]; TR=sys.argv[2].split(","); TE=sys.argv[3].split(",")
    evaluate({nm:json.load(open(f"data/{nm}_{src}.json")) for nm in TR+TE},src,show="-v" in sys.argv,TR=TR,TE=TE)
