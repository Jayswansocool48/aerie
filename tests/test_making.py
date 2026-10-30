"""Tests for the wallpapers you make in Aerie (shaders, 2D parallax, 3D stages), the ones that come
with it, the online sources (with the network replaced by fakes) and the AI's jobs (with a fake AI)."""

import json
import os
import sys
import tempfile
import time
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="aerie-test-")
os.environ["XDG_DATA_HOME"] = TMP + "/data"
os.environ["XDG_CONFIG_HOME"] = TMP + "/config"
os.environ["HOME"] = TMP
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from aerie import assistant, creator, openverse, polyhaven, wallpapers  # noqa: E402

PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 64
SHADER = '''// aerie: audio
uniform float uSpeed; // aerie: slider 0 2 1 "Speed"
uniform vec3 uSky;    // aerie: color #3a7bd5 "Sky"
uniform bool uStars;  // aerie: bool 0 "Stars"
void mainImage(out vec4 c, in vec2 p) { c = vec4(uSky, 1.0); }
'''


def test_bundled_wallpapers():
    items = {d["id"]: d for d in wallpapers.default_items()}
    assert set(items) >= {"default-anime-sky", "default-rolling-hills", "default-earth-at-night", "default-dolomites"}
    for it in items.values():
        assert it["credit"] and it["credit"]["license"] in ("CC0", "Public domain"), it["id"]
        assert (Path(it["root"]) / it["preview"]).is_file(), it["id"]
        assert wallpapers.resolve_file(it["id"], it["entry"]), it["id"]
    sky = items["default-anime-sky"]
    assert sky["type"] == "shader" and {"uTop", "uCloudSpeed"} <= set(sky["properties"])
    hills = items["default-rolling-hills"]
    spec = json.loads((Path(hills["root"]) / "parallax.json").read_text())
    assert len(spec["layers"]) >= 5 and all(wallpapers.resolve_file(hills["id"], l["file"]) for l in spec["layers"])
    # hiding a bundled wallpaper keeps its files and can be undone
    assert wallpapers.remove("default-dolomites") is True
    assert "default-dolomites" not in {i["id"] for i in wallpapers.list_items(include_steam=False)}
    wallpapers.unhide_all()
    assert "default-dolomites" in {i["id"] for i in wallpapers.list_items(include_steam=False)}


def test_shader():
    props = wallpapers.shader_properties(SHADER)
    assert props["uSpeed"]["type"] == "slider" and props["uSpeed"]["max"] == 2 and props["uSpeed"]["value"] == 1
    assert props["uSky"]["value"] == "#3a7bd5" and props["uStars"]["value"] is False
    it = wallpapers.create_shader("Waves", SHADER)
    assert it["type"] == "shader" and it["audio"] and it["editable"]
    it = wallpapers.update_shader(it["id"], SHADER.replace("// aerie: audio\n", ""))
    assert not it["audio"]
    for bad in ("", "int x;", "x" * (300 * 1024)):
        try:
            wallpapers.create_shader("Bad", bad)
            raise AssertionError("should refuse")
        except wallpapers.ImportError_:
            pass
    src = Path(TMP) / "plasma.frag"
    src.write_text(SHADER)
    assert wallpapers.import_path(src)["type"] == "shader"


def test_parallax():
    it = wallpapers.create_parallax("Hills")
    name = wallpapers.add_layer(it["id"], "front.png", PNG)
    svg = wallpapers.add_layer(it["id"], "sky.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="evil()"><script>x</script><image href="https://a/b.png"/></svg>')
    text = wallpapers.resolve_file(it["id"], svg).read_text()
    assert "script" not in text and "onload" not in text and "https://" not in text
    saved = wallpapers.save_spec(it["id"], {"background": "#123456", "layers": [
        {"file": name, "depth": 9, "react": 0.5}, {"file": "../../etc/passwd"}, {"file": "layers/missing.png"}]})
    spec = json.loads(wallpapers.resolve_file(it["id"], "parallax.json").read_text())
    assert len(spec["layers"]) == 1 and spec["layers"][0]["depth"] == 1 and saved["audio"]
    try:
        wallpapers.add_layer(it["id"], "x.exe", b"MZ")
        raise AssertionError("pictures only")
    except wallpapers.ImportError_:
        pass
    try:
        wallpapers.add_layer("default-rolling-hills", "a.png", PNG)
        raise AssertionError("bundled wallpapers can't change")
    except wallpapers.ImportError_:
        pass


def test_stage_and_preview():
    it = wallpapers.create_stage("Room", {"sky": {"hdri": "ok_id"}, "models": [
        {"asset": "chair_01", "position": [1, 0, 9999]}, {"asset": "../evil"}]})
    spec = json.loads(wallpapers.resolve_file(it["id"], "stage.json").read_text())
    assert spec["sky"]["hdri"] == "ok_id" and len(spec["models"]) == 1 and spec["models"][0]["position"][2] == 500
    assert wallpapers.set_preview(it["id"], b"not a picture") is None
    assert wallpapers.set_preview(it["id"], PNG)["previewUrl"].endswith("preview.png")


class FakeResponse:
    def __init__(self, data):
        self.data = data

    def read(self, n=-1):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(routes):
    def opener(req, timeout=0):
        url = req.full_url if hasattr(req, "full_url") else req
        for prefix, data in routes.items():
            if url.startswith(prefix):
                return FakeResponse(data(url) if callable(data) else data)
        raise AssertionError("unexpected request: " + url)
    return opener


IMG_ID = "6a1b2c3d-1111-2222-3333-444455556666"


def test_openverse():
    import urllib.request
    real = urllib.request.urlopen
    result = {"id": IMG_ID, "title": "Lake", "creator": "Ana", "license": "cc0", "url": "https://images.example/lake.jpg",
              "foreign_landing_url": "https://flickr.example/lake", "source": "flickr", "width": 4000, "height": 2000}
    urllib.request.urlopen = fake_urlopen({
        "https://api.openverse.org/v1/images/?": json.dumps({"results": [result, {"id": "nope"}]}).encode(),
        f"https://api.openverse.org/v1/images/{IMG_ID}/": lambda url: json.dumps(result).encode(),
        "https://images.example/lake.jpg": b"\xff\xd8\xff" + b"\0" * 100,
    })
    try:
        hits = openverse.search("lake")
        assert len(hits) == 1 and hits[0]["license"] == "cc0"
        it = openverse.import_image(IMG_ID)
        assert it["type"] == "image" and it["credit"]["author"] == "Ana" and it["credit"]["license"] == "CC0"
        result["license"] = "by-nc"
        try:
            openverse.import_image(IMG_ID)
            raise AssertionError("only public domain")
        except ValueError:
            pass
    finally:
        urllib.request.urlopen = real


def fake_polyhaven():
    assets = {"hdris": {"sunset_sky": {"name": "Sunset Sky", "tags": ["sunset", "clouds"], "categories": ["outdoor"], "download_count": 5}},
              "models": {"wooden_bench": {"name": "Wooden Bench", "tags": ["bench", "park"], "categories": ["furniture"], "download_count": 3,
                                          "dimensions": [1500, 800, 600]}}}

    def assets_route(url):
        return json.dumps(assets["hdris" if "type=hdris" in url else "models"]).encode()

    def files_route(url):
        if "sunset_sky" in url:
            return json.dumps({"hdri": {"2k": {"hdr": {"url": "https://dl.polyhaven.org/sunset_2k.hdr"}}}}).encode()
        return json.dumps({"gltf": {"1k": {"gltf": {"url": "https://dl.polyhaven.org/bench/bench_1k.gltf",
                                                    "include": {"textures/wood.jpg": {"url": "https://dl.polyhaven.org/bench/wood.jpg"}}}}}}).encode()
    return fake_urlopen({"https://api.polyhaven.com/assets": assets_route, "https://api.polyhaven.com/files/": files_route,
                         "https://dl.polyhaven.org/": b"data"})


def test_polyhaven():
    import urllib.request
    real = urllib.request.urlopen
    urllib.request.urlopen = fake_polyhaven()
    try:
        assert polyhaven.search("models", "bench")[0]["dimensions"] == [1.5, 0.8, 0.6]
        assert polyhaven.search("models", "spaceship") == []
        url = polyhaven.fetch("models", "wooden_bench", "1k")
        assert url.endswith("bench_1k.gltf") and polyhaven.local("models", "wooden_bench", "1k")
        assert polyhaven.fetch("hdris", "sunset_sky", "2k").endswith(".hdr")
        try:
            polyhaven._get("https://evil.example/x")
            raise AssertionError("Poly Haven only")
        except ValueError:
            pass
    finally:
        urllib.request.urlopen = real


def run_job(prompt, mode, answers, revise=None):
    """Runs an AI job with a fake AI that gives `answers` in order."""
    queue = list(answers)
    real = assistant.complete
    assistant.complete = lambda system, messages, **kw: json.dumps(queue.pop(0))
    try:
        job = creator.start(prompt, mode, revise)
        for _ in range(200):
            st = creator.status(job)
            if st["state"] != "running":
                return st
            time.sleep(0.02)
        raise AssertionError("job never finished")
    finally:
        assistant.complete = real


def test_ai_jobs():
    assistant.update({"provider": "ollama", "models": {"ollama": "test"}})
    st = run_job("calm waves", "shader", [{"title": "Calm Waves", "code": SHADER}])
    assert st["state"] == "done" and st["result"]["item"]["type"] == "shader" and st["result"]["check"]
    shader_id = st["result"]["item"]["id"]
    st = run_job("", "shader", [{"code": SHADER.replace("uSky", "uSea")}], revise={"id": shader_id, "error": "ERROR: 0:3"})
    assert st["state"] == "done" and "uSea" in st["result"]["item"]["properties"]
    layer = '<svg viewBox="0 0 1920 1080"><path d="M0 900 L1920 800 L1920 1080 L0 1080Z" fill="#2a6"/></svg>'
    st = run_job("green hills", "draw", [{"title": "Hills", "background": "#88ccee", "layers": [
        {"name": "far", "depth": 0.1, "svg": layer}, {"name": "near", "depth": 0.9, "svg": layer, "scroll": 10}]}])
    assert st["state"] == "done", st
    spec = json.loads(wallpapers.resolve_file(st["result"]["item"]["id"], "parallax.json").read_text())
    assert len(spec["layers"]) == 2 and spec["layers"][1]["repeat"]
    st = run_job("bad", "draw", [{"title": "x", "layers": []}])
    assert st["state"] == "failed" and "didn't draw" in st["error"]
    import urllib.request
    real = urllib.request.urlopen
    urllib.request.urlopen = fake_polyhaven()
    try:
        st = run_job("a park bench at sunset", "3d", [
            {"title": "Park", "sky": ["sunset"], "models": ["bench"]},
            {"title": "Park", "sky": {"hdri": "made_up"}, "models": [{"asset": "wooden_bench", "position": [0, 0, -2]}, {"asset": "fake"}]}])
        assert st["state"] == "done", st
        spec = json.loads(wallpapers.resolve_file(st["result"]["item"]["id"], "stage.json").read_text())
        assert spec["sky"]["hdri"] == "sunset_sky" and [m["asset"] for m in spec["models"]] == ["wooden_bench"]
    finally:
        urllib.request.urlopen = real
    assistant.update({"provider": ""})
    assert creator._choose({"steps": []}, "anything") == "find"  # no AI: searching art still works


def test_audio_analyzer():
    try:
        import numpy as np
    except ImportError:
        print("skip test_audio_analyzer (no numpy)")
        return
    from aerie import audio
    a = audio.Analyzer()
    t = np.arange(audio.WINDOW) / audio.RATE
    samples = np.stack([np.sin(2 * np.pi * 100 * t) * 0.5, np.sin(2 * np.pi * 3000 * t) * 0.5], 1).astype(np.float32)
    bars, tex = a.frame(samples)
    assert len(bars) == 128 and 8 < int(np.argmax(bars[:64])) < 16 and 40 < int(np.argmax(bars[64:])) < 52
    assert len(__import__("base64").b64decode(tex)) == 1024


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
