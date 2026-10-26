"""Reads Wallpaper Engine scene files, so imported scene wallpapers can be shown.

Wallpaper Engine keeps a scene in scene.pkg (a simple archive) with its pictures as .tex
files (a header, then the picture: a normal PNG/JPEG, raw pixels or DXT-compressed blocks,
often LZ4-compressed, or an MP4 for video textures). Aerie takes the picture layers out,
saves them as PNG (or MP4) files, and draws them in order with the scene's mouse parallax.
Shader effects, particles and scripts only run in Wallpaper Engine itself.

Everything here is plain Python (no extra packages), so it is not fast, but it only runs
once per wallpaper; the results are cached.
"""

import json
import re
import struct
import zlib
from pathlib import Path

# ---- scene.pkg -------------------------------------------------------------------------------


def read_pkg(path):
    """Returns {name: bytes} for every file in a scene.pkg."""
    data = Path(path).read_bytes()
    pos = 0

    def u32():
        nonlocal pos
        value = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        return value

    def sized_string():
        nonlocal pos
        n = u32()
        if n > 4096:
            raise ValueError("not a Wallpaper Engine package")
        text = data[pos:pos + n].decode("utf-8", "replace")
        pos += n
        return text

    if not sized_string().startswith("PKGV"):
        raise ValueError("not a Wallpaper Engine package")
    count = u32()
    if count > 100000:
        raise ValueError("not a Wallpaper Engine package")
    entries = [(sized_string(), u32(), u32()) for _ in range(count)]
    base = pos
    files = {}
    for name, offset, length in entries:
        start = base + offset
        if start + length > len(data):
            raise ValueError("the package is damaged")
        files[name.replace("\\", "/")] = data[start:start + length]
    return files


# ---- LZ4 blocks ------------------------------------------------------------------------------


def lz4_block_decompress(src, size):
    """Decompresses one LZ4 block (no frame header) of known output size."""
    out = bytearray()
    i, n = 0, len(src)
    while i < n:
        token = src[i]
        i += 1
        lit = token >> 4
        if lit == 15:
            while True:
                b = src[i]
                i += 1
                lit += b
                if b != 255:
                    break
        out += src[i:i + lit]
        i += lit
        if i >= n:
            break
        offset = src[i] | (src[i + 1] << 8)
        i += 2
        if offset == 0 or offset > len(out):
            raise ValueError("damaged LZ4 data")
        match = token & 15
        if match == 15:
            while True:
                b = src[i]
                i += 1
                match += b
                if b != 255:
                    break
        match += 4
        start = len(out) - offset
        if match <= offset:
            out += out[start:start + match]
        else:  # overlapping copy: repeats the last `offset` bytes
            for k in range(match):
                out.append(out[start + k])
    if len(out) != size:
        raise ValueError("damaged LZ4 data")
    return bytes(out)


# ---- DXT (BC1/BC2/BC3) -------------------------------------------------------------------


def _rgb565(c):
    r, g, b = (c >> 11) & 31, (c >> 5) & 63, c & 31
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


def _color_block(data, o, palette_alpha):
    c0, c1, bits = struct.unpack_from("<HHI", data, o)
    r0, g0, b0 = _rgb565(c0)
    r1, g1, b1 = _rgb565(c1)
    if c0 > c1 or not palette_alpha:
        cols = ((r0, g0, b0, 255), (r1, g1, b1, 255),
                ((2 * r0 + r1) // 3, (2 * g0 + g1) // 3, (2 * b0 + b1) // 3, 255),
                ((r0 + 2 * r1) // 3, (g0 + 2 * g1) // 3, (b0 + 2 * b1) // 3, 255))
    else:
        cols = ((r0, g0, b0, 255), (r1, g1, b1, 255),
                ((r0 + r1) // 2, (g0 + g1) // 2, (b0 + b1) // 2, 255), (0, 0, 0, 0))
    return [cols[(bits >> (2 * k)) & 3] for k in range(16)]


def _alpha_bc3(data, o):
    a0, a1 = data[o], data[o + 1]
    bits = int.from_bytes(data[o + 2:o + 8], "little")
    if a0 > a1:
        pal = [a0, a1] + [((7 - k) * a0 + k * a1) // 7 for k in range(1, 7)]
    else:
        pal = [a0, a1] + [((5 - k) * a0 + k * a1) // 5 for k in range(1, 5)] + [0, 255]
    return [pal[(bits >> (3 * k)) & 7] for k in range(16)]


def _alpha_bc2(data, o):
    bits = int.from_bytes(data[o:o + 8], "little")
    return [((bits >> (4 * k)) & 15) * 17 for k in range(16)]


def decode_dxt(data, width, height, kind):
    """kind 1, 3 or 5 → RGBA bytes."""
    out = bytearray(width * height * 4)
    block = 8 if kind == 1 else 16
    bw, bh = (width + 3) // 4, (height + 3) // 4
    o = 0
    for by in range(bh):
        for bx in range(bw):
            if kind == 1:
                px = _color_block(data, o, True)
            else:
                alpha = _alpha_bc3(data, o) if kind == 5 else _alpha_bc2(data, o)
                px = _color_block(data, o + 8, False)
                px = [(p[0], p[1], p[2], alpha[k]) for k, p in enumerate(px)]
            o += block
            for k in range(16):
                x, y = bx * 4 + (k & 3), by * 4 + (k >> 2)
                if x < width and y < height:
                    i = (y * width + x) * 4
                    out[i:i + 4] = bytes(px[k])
    return bytes(out)


# ---- PNG writing -----------------------------------------------------------------------------


def png_bytes(rgba, width, height):
    def chunk(tag, payload):
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)

    stride = width * 4
    raw = b"".join(b"\x00" + rgba[y * stride:(y + 1) * stride] for y in range(height))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def crop_rgba(rgba, full_w, x, y, w, h):
    stride = full_w * 4
    return b"".join(rgba[(y + r) * stride + x * 4:(y + r) * stride + (x + w) * 4] for r in range(h))


# ---- .tex ------------------------------------------------------------------------------------

FIF_EXT = {2: "jpg", 13: "png", 25: "gif", 35: "webp", 0: "bmp"}
RAW_FORMATS = {0: "rgba", 4: "dxt5", 6: "dxt3", 7: "dxt1", 8: "rg88", 9: "r8"}


def read_tex(data):
    """Returns {'kind': 'png'|'jpg'|…|'mp4', 'data': bytes, 'width', 'height'} for the first
    picture in a .tex file (first frame for animated ones)."""
    pos = 0

    def u32():
        nonlocal pos
        value = struct.unpack_from("<I", data, pos)[0]
        pos += 4
        return value

    def magic():
        nonlocal pos
        value = data[pos:pos + 9].rstrip(b"\x00").decode("ascii", "replace")
        pos += 9
        return value

    def cstring():
        nonlocal pos
        end = data.index(b"\x00", pos)
        value = data[pos:end]
        pos = end + 1
        return value

    if magic() != "TEXV0005" or magic() != "TEXI0001":
        raise ValueError("not a Wallpaper Engine texture")
    fmt, flags, tex_w, tex_h, img_w, img_h = (u32() for _ in range(6))
    u32()
    container = magic()
    image_count = u32()
    fif = -1
    is_mp4 = False
    if container == "TEXB0004":
        fif = struct.unpack("<i", struct.pack("<I", u32()))[0]
        is_mp4 = u32() == 1
    elif container == "TEXB0003":
        fif = struct.unpack("<i", struct.pack("<I", u32()))[0]
    elif container not in ("TEXB0001", "TEXB0002"):
        raise ValueError(f"unknown texture container {container}")
    if image_count < 1:
        raise ValueError("empty texture")

    mip_count = u32()
    if container == "TEXB0004" and is_mp4:
        u32(), u32()
        cstring()
        u32()
    mip_w, mip_h = u32(), u32()
    compressed, raw_size = 0, 0
    if container in ("TEXB0002", "TEXB0003", "TEXB0004"):
        compressed, raw_size = u32(), u32()
    stored = u32()
    payload = data[pos:pos + stored]
    pos += stored
    if compressed == 1:
        payload = lz4_block_decompress(payload, raw_size)
    del mip_count  # only the largest picture is needed

    if is_mp4 or (container == "TEXB0004" and fif == 35 and payload[4:8] == b"ftyp"):
        return {"kind": "mp4", "data": payload, "width": img_w, "height": img_h}
    if fif != -1:
        ext = FIF_EXT.get(fif)
        if payload[:8] == b"\x89PNG\r\n\x1a\n":
            ext = "png"
        elif payload[:3] == b"\xff\xd8\xff":
            ext = "jpg"
        if not ext:
            raise ValueError("unsupported picture inside texture")
        return {"kind": ext, "data": payload, "width": img_w, "height": img_h}

    kind = RAW_FORMATS.get(fmt)
    if kind is None:
        raise ValueError(f"unsupported texture format {fmt}")
    if kind.startswith("dxt"):
        rgba = decode_dxt(payload, mip_w, mip_h, int(kind[3]))
    elif kind == "rgba":
        rgba = payload[:mip_w * mip_h * 4]
    elif kind == "rg88":
        rgba = bytearray(mip_w * mip_h * 4)
        for i in range(mip_w * mip_h):
            r, g = payload[2 * i], payload[2 * i + 1]
            rgba[4 * i:4 * i + 4] = bytes((r, r, r, g))
        rgba = bytes(rgba)
    else:  # r8: a mask, white with that alpha
        rgba = bytearray(mip_w * mip_h * 4)
        for i in range(mip_w * mip_h):
            rgba[4 * i:4 * i + 4] = bytes((255, 255, 255, payload[i]))
        rgba = bytes(rgba)

    x, y, w, h = 0, 0, min(img_w or mip_w, mip_w), min(img_h or mip_h, mip_h)
    if flags & 4:  # animated: keep the first frame of the sprite sheet
        frame = _first_frame(data, pos, image_count, container)
        if frame:
            x, y, w, h = (max(0, int(v)) for v in frame)
            w, h = min(w, mip_w - x), min(h, mip_h - y)
    if (x, y, w, h) != (0, 0, mip_w, mip_h):
        rgba = crop_rgba(rgba, mip_w, x, y, w, h)
    return {"kind": "png", "data": png_bytes(rgba, w, h), "width": w, "height": h}


def _first_frame(data, pos, image_count, container):
    """Finds the first frame rectangle of an animated texture, or None."""
    try:
        # skip the remaining mipmaps and images to reach the TEXS block
        idx = data.find(b"TEXS000", pos)
        if idx < 0:
            return None
        version = data[idx:idx + 8].decode()
        p = idx + 9
        frames = struct.unpack_from("<I", data, p)[0]
        p += 4
        if version == "TEXS0003":
            p += 8
        if frames < 1:
            return None
        if version == "TEXS0001":
            _, _, x, y, w, _, _, h = struct.unpack_from("<IfIIIIII", data, p)
        else:
            _, _, x, y, w, _, _, h = struct.unpack_from("<I7f", data, p)
        return x, y, w, h
    except (struct.error, ValueError, UnicodeDecodeError):
        return None


# ---- scene.json → layers ------------------------------------------------------------------


def _val(v, default=None):
    """Scene values are sometimes {"user": ..., "value": ...}."""
    if isinstance(v, dict) and "value" in v:
        return v["value"]
    return default if v is None else v


def _vec(v, n, default):
    v = _val(v, None)
    if isinstance(v, (int, float)):
        return [float(v)] * n
    if isinstance(v, str):
        try:
            parts = [float(p) for p in v.split()]
        except ValueError:
            return list(default)
        return (parts + list(default))[:n]
    if isinstance(v, (list, tuple)):
        return ([float(p) for p in v] + list(default))[:n]
    return list(default)


class SceneFiles:
    """Looks files up in scene.pkg first, then next to it."""

    def __init__(self, root):
        self.root = Path(root)
        pkg = self.root / "scene.pkg"
        self.pkg = read_pkg(pkg) if pkg.is_file() else {}

    def get(self, name):
        name = name.replace("\\", "/").lstrip("/")
        if name in self.pkg:
            return self.pkg[name]
        path = (self.root / name).resolve()
        if self.root.resolve() in path.parents and path.is_file():
            return path.read_bytes()
        return None

    def json(self, name):
        data = self.get(name)
        if data is None:
            return None
        try:
            return json.loads(data.decode("utf-8-sig"))
        except (ValueError, UnicodeDecodeError):
            return None


def extract_scene(root, out_dir, scene_file="scene.json"):
    """Saves the picture layers of a scene to out_dir and writes out_dir/layers.json.
    Returns the layers description."""
    files = SceneFiles(root)
    scene = files.json(scene_file)
    if not isinstance(scene, dict):
        raise ValueError("this scene has no scene.json")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    general = scene.get("general") or {}
    ortho = general.get("orthogonalprojection") or {}
    width = float(_val(ortho.get("width"), 1920) or 1920) if isinstance(ortho, dict) else 1920.0
    height = float(_val(ortho.get("height"), 1080) or 1080) if isinstance(ortho, dict) else 1080.0
    clear = _vec(general.get("clearcolor"), 3, (0, 0, 0))
    layers = []
    seen = {}
    for obj in scene.get("objects") or []:
        if not isinstance(obj, dict) or not obj.get("image"):
            continue
        if _val(obj.get("visible"), True) is False:
            continue
        texture = _texture_for(files, obj["image"])
        if not texture:
            continue
        if texture not in seen:
            raw = files.get(f"materials/{texture}.tex")
            if raw is None:
                continue
            try:
                pic = read_tex(raw)
            except (ValueError, struct.error, IndexError):
                continue
            name = f"layer{len(seen)}.{pic['kind']}"
            (out / name).write_bytes(pic["data"])
            seen[texture] = (name, pic)
        name, pic = seen[texture]
        size = _vec(obj.get("size"), 2, (pic["width"] or width, pic["height"] or height))
        origin = _vec(obj.get("origin"), 3, (width / 2, height / 2, 0))
        scale = _vec(obj.get("scale"), 3, (1, 1, 1))
        angles = _vec(obj.get("angles"), 3, (0, 0, 0))
        depth = _vec(obj.get("parallaxDepth"), 2, (0, 0))
        color = _vec(obj.get("color"), 3, (1, 1, 1))
        layers.append({
            "name": str(obj.get("name") or texture)[:80], "src": name,
            "video": pic["kind"] == "mp4",
            "x": origin[0], "y": origin[1], "w": size[0] * scale[0], "h": size[1] * scale[1],
            "rotation": angles[2], "alpha": float(_val(obj.get("alpha"), 1) or 0),
            "depth": depth, "tint": color,
        })
    if not layers:
        raise ValueError("no pictures found in this scene")
    info = {
        "width": width, "height": height,
        "clear": "#%02x%02x%02x" % tuple(int(max(0, min(1, c)) * 255) for c in clear),
        "parallax": bool(_val(general.get("cameraparallax"), False)),
        "parallaxAmount": float(_val(general.get("cameraparallaxamount"), 0.5) or 0.5),
        "parallaxDelay": float(_val(general.get("cameraparallaxdelay"), 0.1) or 0.1),
        "parallaxMouse": float(_val(general.get("cameraparallaxmouseinfluence"), 1) or 1),
        "layers": layers,
    }
    (out / "layers.json").write_text(json.dumps(info))
    return info


def _texture_for(files, model_name):
    """image object → model json → material json → first texture name."""
    model = files.json(model_name)
    if not isinstance(model, dict):
        return None
    material = files.json(model.get("material", "")) if model.get("material") else None
    if not isinstance(material, dict):
        return None
    for p in material.get("passes") or []:
        textures = (p or {}).get("textures") or []
        if textures and isinstance(textures[0], str) and textures[0]:
            tex = textures[0]
            if re.match(r"^[\w./ -]+$", tex) and not tex.startswith("_rt_"):
                return tex
    return None
