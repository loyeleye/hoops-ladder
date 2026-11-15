import numpy as np, cv2, json, sys, random
# usage: grid.py out.jpg name:key ... ; key=labels
out=sys.argv[1]; items=[]
random.seed(int(sys.argv[2]))
for spec in sys.argv[3:]:
    nm,key=spec.split(":"); d=json.load(open(f"data/{nm}_{key}.json")) if key!="trk" else json.load(open(f"data/{nm}_trk.json"))["labels"]
    a=np.load(f"data/{nm}.npy",mmap_mode="r")
    L=[l for l in d if l]; 
    for l in random.sample(L,min(len(L),48//(len(sys.argv)-3))): items.append((a[l["t"]],l,nm))
tiles=[]
for img,l,nm in items:
    x,y=int(l["x"]),int(l["y"]); pad=np.pad(img,((48,48),(48,48),(0,0))); c=pad[y:y+96,x:x+96].copy()
    c=cv2.resize(c,(144,144)); cv2.circle(c,(72,72),int(l.get("r",15)*1.5)+4,(0,255,0),1)
    cv2.putText(c,f'{nm}:{l["t"]}',(2,12),0,.35,(255,255,255),1); tiles.append(c)
while len(tiles)%8: tiles.append(np.zeros_like(tiles[0]))
rows=[np.hstack(tiles[i:i+8]) for i in range(0,len(tiles),8)]
cv2.imwrite(out,np.vstack(rows))
