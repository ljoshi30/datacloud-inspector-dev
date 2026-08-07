"""Resize the user's 'Data 360 Inspector.png' to extension icon sizes + favicon."""
from PIL import Image
import os

out_dir = os.path.dirname(os.path.abspath(__file__))
src_path = os.path.join(out_dir, "Data 360 Inspector.png")

img = Image.open(src_path).convert("RGBA")
print(f"  source: {src_path} ({img.size[0]}x{img.size[1]})")

# Extension icons (Firefox)
ff_dir = os.path.join(out_dir, "firefox-extension", "icons")
for sz in (16, 48, 128):
    resized = img.resize((sz, sz), Image.LANCZOS)
    path = os.path.join(ff_dir, f"icon{sz}.png")
    resized.save(path, "PNG")
    print(f"  wrote {path} ({sz}x{sz})")

# Extension icons (Chrome)
ch_dir = os.path.join(out_dir, "chrome-extension", "icons")
for sz in (16, 48, 128):
    resized = img.resize((sz, sz), Image.LANCZOS)
    path = os.path.join(ch_dir, f"icon{sz}.png")
    resized.save(path, "PNG")
    print(f"  wrote {path} ({sz}x{sz})")

# Favicon PNG (32x32)
fav = img.resize((32, 32), Image.LANCZOS)
fav_path = os.path.join(out_dir, "favicon.png")
fav.save(fav_path, "PNG")
print(f"  wrote {fav_path} (32x32 favicon)")

# Favicon .ico (multi-size)
ico_sizes = [16, 32, 48]
ico_images = [img.resize((s, s), Image.LANCZOS) for s in ico_sizes]
ico_path = os.path.join(out_dir, "favicon.ico")
ico_images[0].save(ico_path, format="ICO", sizes=[(s, s) for s in ico_sizes],
                   append_images=ico_images[1:])
print(f"  wrote {ico_path} (multi-size .ico)")
