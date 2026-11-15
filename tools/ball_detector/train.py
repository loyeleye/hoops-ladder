import numpy as np, json, torch, torch.nn.functional as F, cv2, random, time, sys
from model import Net
torch.set_num_threads(4); random.seed(0); np.random.seed(0); torch.manual_seed(0)
TRAIN=sys.argv[1].split(","); EPOCHS=int(sys.argv[2]); OUT=sys.argv[3]
clips={}; items=[]
for nm in TRAIN:
    a=np.load(f"data/{nm}.npy"); lab=json.load(open(f"data/{nm}_lab.json"))
    # interpolate short gaps (<=3 frames) between labels
    full=list(lab); idx=[i for i,l in enumerate(lab) if l]
    for i,j in zip(idx,idx[1:]):
        if 1<j-i<=3 and np.hypot(lab[j]["x"]-lab[i]["x"],lab[j]["y"]-lab[i]["y"])<30*(j-i):
            for k in range(i+1,j):
                w=(k-i)/(j-i); full[k]=dict(t=k,x=lab[i]["x"]*(1-w)+lab[j]["x"]*w,y=lab[i]["y"]*(1-w)+lab[j]["y"]*w,r=(lab[i]["r"]+lab[j]["r"])/2)
    clips[nm]=a
    step=int(__import__("os").environ.get("SUB_"+nm,"1"))
    items+=[(nm,l) for l in full if l and l["t"]>=2 and l["t"]%step==0]
print("train frames",len(items),flush=True)
CH,CW=192,256
def sample(nm,l):
    a=clips[nm]; t=l["t"]; fr=np.concatenate([a[t-2],a[t-1],a[t]],2).astype(np.float32)/255  # H W 9 (BGR)
    H,W=fr.shape[:2]; x,y=l["x"],l["y"]
    sc=random.uniform(.75,1.3); M=cv2.getRotationMatrix2D((x,y),random.uniform(-8,8),sc)
    # place ball at random spot in crop
    ox=random.uniform(30,CW-30); oy=random.uniform(30,CH-30); M[0,2]+=ox-x; M[1,2]+=oy-y
    fr=cv2.warpAffine(fr,M,(CW,CH),borderMode=cv2.BORDER_REFLECT)
    bx,by=ox,oy
    if random.random()<.5: fr=fr[:,::-1].copy(); bx=CW-1-bx
    # color: random hue rotation / grayscale on all 3 frames identically
    fr=fr.reshape(CH,CW,3,3)
    if random.random()<.6:
        hs=random.uniform(0,180) if random.random()<.5 else random.uniform(-12,12)
        sm=random.uniform(.5,1.3)
        for k in range(3):
            hsv=cv2.cvtColor(fr[:,:,k],cv2.COLOR_BGR2HSV); hsv[...,0]=(hsv[...,0]+hs*2)%360; hsv[...,1]=np.clip(hsv[...,1]*sm,0,1)
            fr[:,:,k]=cv2.cvtColor(hsv,cv2.COLOR_HSV2BGR)
    if random.random()<.15: g=fr.mean(3,keepdims=True); fr=np.repeat(g,3,3)
    fr=fr*random.uniform(.6,1.3)+random.uniform(-.1,.1)
    # motion blur on current frame
    if random.random()<.4:
        L=random.randint(5,15); k=np.zeros((L,L),np.float32); k[L//2,:]=1/L
        k=cv2.warpAffine(k,cv2.getRotationMatrix2D((L/2-.5,L/2-.5),random.uniform(0,180),1),(L,L)); k/=k.sum()+1e-6
        fr[:,:,2]=cv2.filter2D(np.ascontiguousarray(fr[:,:,2]),-1,k)
    # occlusion: paste a random patch from elsewhere over part of the ball (current frame)
    if random.random()<.4:
        r=l["r"]*sc; pw,ph=int(random.uniform(.6,1.6)*r),int(random.uniform(1,3)*r)
        px=int(bx+random.uniform(-r,r)-pw/2); py=int(by+random.uniform(-r,r)-ph/2)
        sx,sy=random.randint(0,CW-pw-1),random.randint(0,CH-ph-1)
        x0,y0=max(px,0),max(py,0); x1,y1=min(px+pw,CW),min(py+ph,CH)
        if x1>x0 and y1>y0: fr[y0:y1,x0:x1,2]=fr[sy+(y0-py):sy+(y1-py),sx+(x0-px):sx+(x1-px),2] if (sy+(y1-py))<=CH and (sx+(x1-px))<=CW else fr[y0:y1,x0:x1,2]
    fr=np.clip(fr,0,1).reshape(CH,CW,9)+np.random.normal(0,.02,(CH,CW,9)).astype(np.float32)
    # target at half res
    yy,xx=np.mgrid[:CH//2,:CW//2]; sig=max(1.5,l["r"]*sc/2/3)
    hm=np.exp(-((xx-bx/2)**2+(yy-by/2)**2)/(2*sig*sig)).astype(np.float32)
    return fr.transpose(2,0,1),hm
def negsample(nm):
    a=clips[nm]; t=random.randint(2,len(a)-1)
    return None
def focal(logit,hm):
    p=torch.sigmoid(logit).clamp(1e-4,1-1e-4); pos=hm.ge(.99).float(); neg=1-pos
    pl=-((1-p)**2*torch.log(p)*pos).sum(); nl=-((1-hm)**4*p**2*torch.log(1-p)*neg).sum()
    return (pl+nl)/pos.sum().clamp(min=1)
net=Net(24)
import os
if os.environ.get("INIT"): net.load_state_dict(torch.load(os.environ["INIT"]))
opt=torch.optim.AdamW(net.parameters(),2e-3,weight_decay=1e-4)
B=16; steps=EPOCHS*len(items)//B; sched=torch.optim.lr_scheduler.OneCycleLR(opt,2e-3,total_steps=steps)
print("params",sum(p.numel() for p in net.parameters()),"steps",steps,flush=True)
t0=time.time(); st=0
for ep in range(EPOCHS):
    random.shuffle(items); tot=0
    for i in range(0,len(items)-B+1,B):
        xs,ys=zip(*[sample(*it) for it in items[i:i+B]])
        x=torch.tensor(np.stack(xs)); y=torch.tensor(np.stack(ys))[:,None]
        # make peak exactly 1 at max pixel
        y=y/ y.flatten(1).max(1)[0].clamp(min=1e-6)[:,None,None,None]
        loss=focal(net(x),y); opt.zero_grad(); loss.backward(); opt.step(); sched.step(); tot+=loss.item(); st+=1
    print(f"ep {ep} loss {tot/(len(items)//B):.3f} {time.time()-t0:.0f}s",flush=True)
    torch.save(net.state_dict(),OUT)
