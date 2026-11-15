import torch, torch.nn as nn, torch.nn.functional as F
def cbr(i,o,s=1): return nn.Sequential(nn.Conv2d(i,o,3,s,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True))
def dw(i,o,s=1): return nn.Sequential(nn.Conv2d(i,i,3,s,1,groups=i,bias=False),nn.BatchNorm2d(i),nn.ReLU(inplace=True),nn.Conv2d(i,o,1,bias=False),nn.BatchNorm2d(o),nn.ReLU(inplace=True))
class Net(nn.Module):
    """Input: 3 frames (t-2,t-1,t) RGB stacked = 9ch, H x W (multiple of 16). Output: logits heatmap at H/2 x W/2."""
    def __init__(s,c=16):
        super().__init__()
        s.e1=nn.Sequential(cbr(9,c,2),dw(c,c))            # /2
        s.e2=nn.Sequential(dw(c,2*c,2),dw(2*c,2*c))        # /4
        s.e3=nn.Sequential(dw(2*c,4*c,2),dw(4*c,4*c))      # /8
        s.e4=nn.Sequential(dw(4*c,6*c,2),dw(6*c,6*c),dw(6*c,6*c))  # /16
        s.d3=dw(6*c+4*c,4*c); s.d2=dw(4*c+2*c,2*c); s.d1=dw(2*c+c,c)
        s.head=nn.Conv2d(c,1,1); nn.init.constant_(s.head.bias,-4.0)
    def forward(s,x):
        a=s.e1(x); b=s.e2(a); c=s.e3(b); d=s.e4(c)
        u=F.interpolate(d,size=c.shape[2:],mode="bilinear",align_corners=False); u=s.d3(torch.cat([u,c],1))
        u=F.interpolate(u,size=b.shape[2:],mode="bilinear",align_corners=False); u=s.d2(torch.cat([u,b],1))
        u=F.interpolate(u,size=a.shape[2:],mode="bilinear",align_corners=False); u=s.d1(torch.cat([u,a],1))
        return s.head(u)
