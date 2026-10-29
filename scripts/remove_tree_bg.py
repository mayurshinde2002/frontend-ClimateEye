"""Cut out tree-1.jpg and defringe white halo for dark UI cards."""
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter, ImageChops

src = Path(r"c:\Users\Vaibhav.Galankar\Desktop\ClimetEye\frontend-ClimateEye\public\weather\tree-1.jpg")
out = Path(r"c:\Users\Vaibhav.Galankar\Desktop\ClimetEye\frontend-ClimateEye\public\weather\gust-tree.png")

img = Image.open(src).convert("RGBA")
w, h = img.size
pixels = img.load()


def bg_score(r, g, b):
    """Higher = more like white/gray studio background."""
    mx, mn = max(r, g, b), min(r, g, b)
    chroma = mx - mn
    brightness = (r + g + b) / 3
    # white / light gray
    if brightness > 245 and chroma < 20:
        return 1.0
    if brightness > 230 and chroma < 18:
        return 0.95
    if brightness > 210 and chroma < 14:
        return 0.85
    if brightness > 190 and chroma < 12:
        return 0.7
    if brightness > 175 and chroma < 10:
        return 0.55
    return 0.0


# Edge flood-fill for clear background
visited = [[False] * w for _ in range(h)]
q = deque()
for x in range(w):
    q.append((x, 0))
    q.append((x, h - 1))
for y in range(h):
    q.append((0, y))
    q.append((w - 1, y))

while q:
    x, y = q.popleft()
    if x < 0 or y < 0 or x >= w or y >= h or visited[y][x]:
        continue
    r, g, b, a = pixels[x, y]
    if bg_score(r, g, b) < 0.55:
        continue
    visited[y][x] = True
    pixels[x, y] = (0, 0, 0, 0)
    q.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))

# Build alpha from remaining; punch remaining pale pixels near transparent
for y in range(h):
    for x in range(w):
        r, g, b, a = pixels[x, y]
        if a == 0:
            continue
        score = bg_score(r, g, b)
        if score >= 0.7:
            # near transparent neighbors → treat as leftover bg
            near_clear = 0
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and pixels[nx, ny][3] < 20:
                    near_clear += 1
            if near_clear >= 1:
                pixels[x, y] = (0, 0, 0, 0)
                continue
        if score >= 0.55:
            # soft fringe: reduce alpha
            alpha = int(255 * (1.0 - score))
            pixels[x, y] = (r, g, b, alpha)

# Extract alpha, erode 1–2px to kill white rim, then recompose
rgba = img.split()
alpha = rgba[3]
# shrink opaque region slightly
eroded = alpha
for _ in range(2):
    eroded = eroded.filter(ImageFilter.MinFilter(3))

# Also blur alpha slightly then re-threshold for smoother edge
soft = eroded.filter(ImageFilter.GaussianBlur(0.6))
# Keep RGB but darken fringe toward local non-white (defringe)
rgb = Image.merge("RGB", rgba[:3])
px = rgb.load()
ax = soft.load()
for y in range(h):
    for x in range(w):
        a = ax[x, y]
        if a == 0:
            continue
        r, g, b = px[x, y]
        # if pixel is pale and on soft edge, pull toward green/brown neighbor average
        if (r + g + b) / 3 > 200 and a < 240:
            samples = []
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and ax[nx, ny] > 180:
                    nr, ng, nb = px[nx, ny]
                    if (nr + ng + nb) / 3 < 190:
                        samples.append((nr, ng, nb))
            if samples:
                nr = sum(s[0] for s in samples) // len(samples)
                ng = sum(s[1] for s in samples) // len(samples)
                nb = sum(s[2] for s in samples) // len(samples)
                # blend pale fringe into darker tree color
                t = 0.75
                px[x, y] = (
                    int(r * (1 - t) + nr * t),
                    int(g * (1 - t) + ng * t),
                    int(b * (1 - t) + nb * t),
                )

out_img = Image.merge("RGBA", (*rgb.split(), soft))

# Crop to content
bbox = out_img.getbbox()
if bbox:
    pad = 6
    left = max(0, bbox[0] - pad)
    top = max(0, bbox[1] - pad)
    right = min(w, bbox[2] + pad)
    bottom = min(h, bbox[3] + pad)
    out_img = out_img.crop((left, top, right, bottom))

# Slightly shrink for UI use
max_h = 320
if out_img.height > max_h:
    ratio = max_h / out_img.height
    out_img = out_img.resize(
        (max(1, int(out_img.width * ratio)), max_h),
        Image.Resampling.LANCZOS,
    )

out_img.save(out, "PNG", optimize=True)
opaque = sum(1 for v in out_img.getchannel("A").getdata() if v > 20)
print(f"wrote {out} size={out_img.size} opaque={opaque} bytes={out.stat().st_size}")
