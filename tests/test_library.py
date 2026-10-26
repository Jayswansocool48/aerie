"""Tests the wallpaper library: what Aerie recognizes in files and folders, and that it never
serves a file from outside a wallpaper's own folder."""

import json
import os
import sys
import tempfile
import zipfile
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="aerie-test-")
os.environ["XDG_DATA_HOME"] = TMP + "/data"
os.environ["XDG_CONFIG_HOME"] = TMP + "/config"
os.environ["HOME"] = TMP
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from aerie import wallpapers  # noqa: E402
import make_test_scene  # noqa: E402

SRC = Path(TMP) / "src"
SRC.mkdir()


def folder(name, files):
    d = SRC / name
    d.mkdir(parents=True)
    for rel, data in files.items():
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        (d / rel).write_bytes(data if isinstance(data, bytes) else data.encode())
    return d


def test_kinds():
    (SRC / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\nfake")
    assert wallpapers.import_path(SRC / "pic.png")["type"] == "image"
    (SRC / "loop.webm").write_bytes(b"fake video")
    assert wallpapers.import_path(SRC / "loop.webm")["type"] == "video"
    (SRC / "scene.glb").write_bytes(make_test_scene.build())
    it = wallpapers.import_path(SRC / "scene.glb")
    assert it["type"] == "model" and it["fileUrl"].endswith("scene.glb")
    web = folder("we-web", {"project.json": json.dumps({"title": "Petals", "type": "web", "file": "index.html",
                                                         "contentrating": "Mature",
                                                         "general": {"properties": {"c": {"type": "color", "text": "ui_browse_properties_scheme_color", "value": "1 0 0"}}}}),
                            "index.html": "<html></html>"})
    it = wallpapers.import_path(web)
    assert it["type"] == "web" and it["rating"] == "mature" and it["properties"]["c"]["label"] == "Color scheme"
    lively = folder("lively", {"LivelyInfo.json": json.dumps({"Title": "Clock", "FileName": "clock.html"}), "clock.html": "x"})
    assert wallpapers.import_path(lively)["source"] == "lively"
    app = folder("we-app", {"project.json": json.dumps({"type": "application", "file": "a.exe"})})
    try:
        wallpapers.import_path(app)
        raise AssertionError("an .exe wallpaper should be refused")
    except wallpapers.ImportError_ as exc:
        assert "Windows" in str(exc)


def test_zip_and_traversal():
    z = SRC / "pack.zip"
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("Pack/project.json", json.dumps({"title": "Zipped", "type": "video", "file": "v.mp4"}))
        f.writestr("Pack/v.mp4", b"video")
    it = wallpapers.import_path(z)
    assert it["title"] == "Zipped"
    assert wallpapers.resolve_file(it["id"], "v.mp4")
    assert wallpapers.resolve_file(it["id"], "../index.json") is None
    assert wallpapers.resolve_file(it["id"], "/etc/passwd") is None
    bad = SRC / "evil.zip"
    with zipfile.ZipFile(bad, "w") as f:
        f.writestr("../../escape.txt", "x")
    try:
        wallpapers.import_path(bad)
        raise AssertionError("a zip with ../ paths should be refused")
    except wallpapers.ImportError_:
        pass


def test_steam_and_defaults():
    ws = Path(TMP) / ".local/share/Steam/steamapps/workshop/content/431960/123"
    ws.mkdir(parents=True)
    (ws / "project.json").write_text(json.dumps({"title": "Workshop one", "type": "video", "file": "a.mp4"}))
    (ws / "a.mp4").write_bytes(b"x")
    items = wallpapers.list_items()
    steam = [i for i in items if i["source"] == "steam"]
    assert steam and steam[0]["title"] == "Workshop one"
    assert wallpapers.remove(steam[0]["id"]) is True  # hidden, not deleted
    assert (ws / "a.mp4").exists()
    wallpapers._steam_cache["time"] = 0
    assert not [i for i in wallpapers.list_items() if i["source"] == "steam"]


def test_url():
    it = wallpapers.import_url("https://example.com")
    assert it["type"] == "url"
    try:
        wallpapers.import_url("file:///etc/passwd")
        raise AssertionError("only web addresses")
    except wallpapers.ImportError_:
        pass


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
