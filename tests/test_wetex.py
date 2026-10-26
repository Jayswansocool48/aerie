"""Tests reading Wallpaper Engine scene packages and textures (made up here, byte by byte)."""

import json
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from aerie import wetex  # noqa: E402


def sized(s):
    b = s.encode()
    return struct.pack("<I", len(b)) + b


def make_pkg(files):
    names = list(files)
    header = sized("PKGV0001") + struct.pack("<I", len(names))
    offset = 0
    body = b""
    for n in names:
        header += sized(n) + struct.pack("<II", offset, len(files[n]))
        offset += len(files[n])
        body += files[n]
    return header + body


def lz4_literals(data):
    """A valid LZ4 block holding only literals (good enough to test the reader)."""
    n = len(data)
    if n < 15:
        return bytes([n << 4]) + data
    out = bytearray([0xF0])
    rest = n - 15
    while rest >= 255:
        out.append(255)
        rest -= 255
    out.append(rest)
    return bytes(out) + data


def tex(fmt, w, h, payload, *, fif=-1, container="TEXB0003", lz4=False, tex_w=None, tex_h=None):
    tw, th = tex_w or w, tex_h or h
    out = b"TEXV0005\x00TEXI0001\x00" + struct.pack("<7I", fmt, 0, tw, th, w, h, 0)
    out += container.encode() + b"\x00" + struct.pack("<I", 1)
    if container in ("TEXB0003", "TEXB0004"):
        out += struct.pack("<i", fif)
    if container == "TEXB0004":
        out += struct.pack("<I", 0)
    out += struct.pack("<I", 1)  # mipmaps
    stored = lz4_literals(payload) if lz4 else payload
    out += struct.pack("<II", tw, th)
    out += struct.pack("<II", 1 if lz4 else 0, len(payload)) + struct.pack("<I", len(stored)) + stored
    return out


def png_size(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", data[16:24])


def png_pixels(data):
    w, h = png_size(data)
    # IDAT is the second chunk in our own writer
    length = struct.unpack(">I", data[33:37])[0]
    raw = zlib.decompress(data[41:41 + length])
    rows = [raw[y * (w * 4 + 1) + 1:(y + 1) * (w * 4 + 1)] for y in range(h)]
    return w, h, b"".join(rows)


def test_lz4_with_matches():
    # "abcabcabcabc" = literals "abc" + match offset 3 length 9
    block = bytes([(3 << 4) | (9 - 4)]) + b"abc" + struct.pack("<H", 3)
    assert wetex.lz4_block_decompress(block, 12) == b"abcabcabcabc"


def test_dxt1_block():
    red, blue = 0xF800, 0x001F
    # every pixel uses color 0 (red) except the first, which uses color 1 (blue)
    block = struct.pack("<HHI", red, blue, 0b01)
    rgba = wetex.decode_dxt(block, 4, 4, 1)
    assert rgba[0:4] == bytes((0, 0, 255, 255)), rgba[0:4]
    assert rgba[4:8] == bytes((255, 0, 0, 255))


def test_scene_extraction():
    w, h = 6, 4  # stored in an 8x4 texture: Aerie must crop it
    pixels = bytes([10, 20, 30, 255] * (8 * 4))
    png = wetex.png_bytes(bytes([200, 100, 50, 255] * 4), 2, 2)
    files = {
        "scene.json": json.dumps({
            "general": {"orthogonalprojection": {"width": 1920, "height": 1080}, "cameraparallax": True,
                        "clearcolor": "0.5 0.5 0.5"},
            "objects": [
                {"image": "models/bg.json", "origin": "960 540 0", "size": "1920 1080", "name": "Background"},
                {"image": "models/girl.json", "origin": {"user": "x", "value": "1200 400 0"}, "scale": "2 2 1",
                 "parallaxDepth": "0.5 0.5", "name": "Character"},
                {"image": "models/hidden.json", "visible": False},
                {"particle": "particles/rain.json"},
            ],
        }).encode(),
        "models/bg.json": json.dumps({"material": "materials/bg.json"}).encode(),
        "materials/bg.json": json.dumps({"passes": [{"textures": ["bg"]}]}).encode(),
        "materials/bg.tex": tex(0, w, h, pixels, lz4=True, tex_w=8, tex_h=4),
        "models/girl.json": json.dumps({"material": "materials/girl.json"}).encode(),
        "materials/girl.json": json.dumps({"passes": [{"textures": ["girl", "mask"]}]}).encode(),
        "materials/girl.tex": tex(0, 2, 2, png, fif=13),
    }
    with tempfile.TemporaryDirectory() as d:
        root = Path(d) / "wp"
        root.mkdir()
        (root / "scene.pkg").write_bytes(make_pkg(files))
        info = wetex.extract_scene(root, Path(d) / "out")
        assert [layer["name"] for layer in info["layers"]] == ["Background", "Character"]
        assert info["parallax"] is True and info["clear"] == "#7f7f7f"
        bg = info["layers"][0]
        pw, ph, px = png_pixels((Path(d) / "out" / bg["src"]).read_bytes())
        assert (pw, ph) == (6, 4) and px[:4] == bytes((10, 20, 30, 255))
        girl = info["layers"][1]
        assert girl["w"] == 4 and girl["x"] == 1200 and girl["depth"] == [0.5, 0.5]
        assert (Path(d) / "out" / girl["src"]).read_bytes() == png


def test_dxt_speed():
    # a 1024x1024 DXT1 picture should not take forever
    data = struct.pack("<HHI", 0xF800, 0x07E0, 0x1B1B1B1B) * (256 * 256)
    t = time.time()
    wetex.decode_dxt(data, 1024, 1024, 1)
    took = time.time() - t
    print(f"1024² DXT1 decode: {took:.2f}s")
    assert took < 20


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
