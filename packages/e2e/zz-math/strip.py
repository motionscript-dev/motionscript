import sys
from PIL import Image
# strip.py <out.png> <in.png...>: stack stills vertically
ims = [Image.open(p) for p in sys.argv[2:]]
w, h = ims[0].size
out = Image.new("RGB", (w, h * len(ims)))
for i, im in enumerate(ims):
    out.paste(im, (0, h * i))
out.save(sys.argv[1])
