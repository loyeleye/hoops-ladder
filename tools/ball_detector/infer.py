import numpy as np, json, torch, sys
from model import Net
torch.set_num_threads(int(__import__("os").environ.get("NT","4")))
W=sys.argv[1]; TH=float(sys.argv[2]); tag=sys.argv[3]; names=sys.argv[4:]
net=Net(24); net.load_state_dict(torch.load(W)); net.eval()
from filt import ok
for nm in names:
    a=np.load(f"data/{nm}.npy"); P=json.load(open(f"data/{nm}_pose.json")); n=len(a)
    raw=[None]*n; out=[None]*n
    with torch.no_grad():
        for s in range(2,n,32):
            idx=list(range(s,min(s+32,n)))
            x=np.stack([np.concatenate([a[t-2],a[t-1],a[t]],2) for t in idx]).astype(np.float32)/255
            x=np.pad(x,((0,0),(1,1),(0,0),(0,0)),mode="edge").transpose(0,3,1,2)
            h=torch.sigmoid(net(torch.tensor(x)))[:,0].numpy()
            for t,hm in zip(idx,h):
                yy,xx=np.unravel_index(hm.argmax(),hm.shape); v=float(hm[yy,xx])
                d=dict(t=t,x=xx*2.0+.5,y=yy*2.0-1+.5,score=v,r=15)
                raw[t]=d
                if v>=TH and ok(d,P[t]): out[t]=d
    json.dump(out,open(f"data/{nm}_{tag}.json","w")); json.dump(raw,open(f"data/{nm}_{tag}raw.json","w"))
    lab=json.load(open(f"data/{nm}_lab.json"))
    agree=[np.hypot(out[t]["x"]-lab[t]["x"],out[t]["y"]-lab[t]["y"])<12 for t in range(n) if lab[t] and out[t]]
    nl=sum(1 for l in lab if l)
    print(f"{nm}: detector sees {np.mean([o is not None for o in out]):.2f} of frames; tracker labels {nl/n:.2f}; on tracker-labeled frames detector found {len(agree)}/{nl}, within 12px {sum(agree)}/{len(agree)}")
