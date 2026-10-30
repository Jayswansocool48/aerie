"""Making wallpapers with the AI: each request runs as a job in the background, and Studio
follows its steps (searching, picking assets, downloading, saving).

Modes:
  find    look for public-domain art on Openverse (the AI only writes the search words)
  draw    the AI draws the scene as layered SVG pictures, which become a 2D parallax wallpaper
  shader  the AI writes a Shadertoy-style GLSL shader, with settings you can change
  3d      the AI picks a free Poly Haven sky and models and places them; Aerie downloads them
          and builds a 3D stage you can move things around in
  paint   OpenAI's image model paints a picture (needs an OpenAI key)
  auto    the AI chooses one of the above from what you asked for
"""

import json
import re
import tempfile
import threading
import time
import uuid
from pathlib import Path

from . import assistant, openverse, polyhaven, wallpapers

MODES = ("auto", "find", "draw", "shader", "3d", "paint")
_jobs = {}
_lock = threading.Lock()

STYLE = ("Aim for a calm, beautiful desktop wallpaper that stays easy on the eyes behind windows and icons: "
         "a clear focal area, room for desktop widgets, no text, no logos, no real people or brands, "
         "nothing scary or gory unless asked. If the person likes anime, lean into anime scenery: soft skies, "
         "big clouds, light rays, flat painterly shapes.")

CHOOSE = """You route a wallpaper request to one maker. Answer JSON only:
{"mode": "3d" | "draw" | "shader" | "find", "why": "<few words>"}
- 3d: a 3D place or objects (a room, a forest with trees and rocks, a desk, a planet in space)
- shader: abstract, animated, glowing, waves, plasma, fractal, audio visualizer, "reacts to music"
- find: they want a photo or existing artwork ("a photo of", "a painting of", "find")
- draw: an illustrated 2D landscape or scene with layers (default for scenery)"""

SHADER = """You write Shadertoy-style GLSL ES 3.0 fragment shaders for live desktop wallpapers in the app Aerie.
Write: void mainImage(out vec4 fragColor, in vec2 fragCoord)
Aerie provides (do NOT declare these): iResolution (vec3), iTime (float), iTimeDelta, iFrame (int),
iMouse (vec4; xy = smoothed mouse position in pixels, z = 0), iDate (vec4),
iChannel0..iChannel3 (sampler2D; 256x256 RGBA noise; if the first line is "// aerie: audio",
iChannel0 is instead Shadertoy's 512x2 audio texture: row y=0.25 is the spectrum, y=0.75 the waveform).
Rules: slow, smooth motion (it runs all day behind windows), no flashing, never pure white;
keep it cheap (at most ~80 raymarch steps, no nested loops over 64); compile cleanly on WebGL2
(float literals like 1.0, no implicit int/float mixing, no recursion).
Give the person 2-5 settings as uniforms with an annotation comment, exactly like:
uniform float uSpeed; // aerie: slider 0 2 1 "Speed"
uniform vec3 uColor; // aerie: color #4a7bd0 "Main color"
uniform bool uStars; // aerie: bool 1 "Stars"
Answer JSON only: {"title": "<2-4 words>", "code": "<the whole shader>"}"""

DRAW = """You draw 2D parallax wallpapers as layered SVG for the desktop app Aerie.
Make 3-6 layers, far to near. Every layer is its own complete SVG with viewBox="0 0 1920 1080" and
xmlns="http://www.w3.org/2000/svg", transparent except for its own shapes (the far sky is the
background color, not a layer). Near layers sit low on the screen (hills, trees, grass at the bottom).
Use flat shapes, paths and gradients (define gradients inside that layer's <defs>). No <text>, no
<image>, no scripts, no links, no external files, no filters heavier than one blur.
Keep each layer under 12 KB. depth: 0 = far (moves least with the mouse), 1 = near.
scroll: horizontal drift in pixels per second for clouds or mist (0 for ground), sway: 0-1 gentle bob.
Answer JSON only:
{"title": "<2-4 words>", "background": "#rrggbb (top of the sky)", "background2": "#rrggbb (bottom of the sky)",
 "layers": [{"name": "...", "depth": 0.1, "scroll": 0, "sway": 0, "svg": "<svg ...>...</svg>"}]}"""

FIND = """You turn a wallpaper request into searches for public-domain pictures on Openverse.
Answer JSON only: {"title": "<2-4 words>", "queries": ["<2-4 plain words>", "<another angle>", "<a third>"]}"""

STAGE_TERMS = """You plan a 3D wallpaper made only from free Poly Haven assets (HDRI skies and 3D models of
real-world objects: furniture, plants, trees, rocks, food, tools, props, buildings parts).
Answer JSON only:
{"title": "<2-4 words>", "sky": ["<1-2 words to search skies>", "<another>"],
 "models": ["<1-2 words per kind of object to search>", "..."] (3-6 entries)}"""

STAGE_LAYOUT = """You arrange a 3D wallpaper from Poly Haven assets. Units are metres; y is up; the ground is y=0;
the camera looks toward -z from about (0, 1.6, 6), so put things between z=-8 and z=3 and x=-6..6.
Models already have real-world size (dimensions are given as [width, height, depth] in metres);
keep scale 1 unless something must be bigger or smaller. rotation is in degrees [x, y, z].
Use only ids from the lists. Leave the middle-top of the screen fairly open. 3-12 models.
spin: slow turning in turns per minute (mostly 0), bob: 0-1 gentle floating (mostly 0).
Answer JSON only:
{"title": "...", "sky": {"hdri": "<hdri id>", "rotation": 0, "exposure": 1},
 "models": [{"asset": "<model id>", "position": [x, 0, z], "rotation": [0, deg, 0], "scale": 1, "spin": 0, "bob": 0}],
 "camera": {"orbit": 0.03, "fov": 45},
 "ground": {"show": true, "color": "#rrggbb"}, "fog": {"color": "#rrggbb", "density": 0.01}}"""


# ---- jobs ------------------------------------------------------------------------------------


def start(prompt, mode="auto", revise=None):
    """Starts a job and returns its id. revise: {"id": wallpaper id, "error": compile error} to change
    a shader or stage the AI made before."""
    prompt = str(prompt or "").strip()[:2000]
    if not prompt and not revise:
        raise ValueError("Say what kind of wallpaper you'd like")
    if mode not in MODES:
        mode = "auto"
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "state": "running", "mode": mode, "steps": [], "result": None, "error": "",
           "started": time.time()}
    with _lock:
        for k in [k for k, j in _jobs.items() if time.time() - j["started"] > 3600]:
            del _jobs[k]
        _jobs[job_id] = job
    threading.Thread(target=_run, args=(job, prompt, mode, revise or None), daemon=True).start()
    return job_id


def status(job_id):
    with _lock:
        job = _jobs.get(str(job_id))
        return json.loads(json.dumps(job)) if job else None


def _step(job, text):
    job["steps"].append(text)


def _run(job, prompt, mode, revise):
    try:
        if revise:
            job["result"] = _revise(job, prompt, revise)
        else:
            if mode == "auto":
                mode = _choose(job, prompt)
                job["mode"] = mode
            job["result"] = {"find": _find, "draw": _draw, "shader": _shader, "3d": _stage, "paint": _paint}[mode](job, prompt)
        job["state"] = "done"
    except Exception as exc:  # shown to you as it is
        job["error"] = _error(exc)
        job["state"] = "failed"


def _error(exc):
    msg = assistant.error_message(exc)
    return msg if msg else "Something went wrong."


def _ask(system, prompt, max_tokens=4000):
    return assistant.parse_json(assistant.complete(system + "\n\n" + STYLE, [{"role": "user", "content": prompt}],
                                                   max_tokens=max_tokens))


def _choose(job, prompt):
    _step(job, "Choosing how to make it")
    low = prompt.lower()
    if assistant.load()["provider"] not in assistant.PROVIDERS:
        return "find"  # no AI set up: searching free art still works
    try:
        mode = str(_ask(CHOOSE, prompt, 200).get("mode", ""))
    except ValueError:
        mode = ""
    if mode in ("3d", "draw", "shader", "find"):
        return mode
    if any(w in low for w in ("photo", "picture of", "painting", "find")):
        return "find"
    return "draw"


def _find(job, prompt):
    title, queries = prompt[:60], [prompt]
    if assistant.load()["provider"] in assistant.PROVIDERS:
        _step(job, "Thinking of what to search for")
        try:
            plan = _ask(FIND, prompt, 300)
            queries = [str(q)[:80] for q in plan.get("queries") or [] if str(q).strip()][:3] or [prompt]
            title = str(plan.get("title") or title)[:60]
        except ValueError:
            pass
    results, seen = [], set()
    for q in queries:
        _step(job, f"Searching Openverse for “{q}”")
        try:
            for r in openverse.search(q):
                if r["id"] not in seen:
                    seen.add(r["id"])
                    results.append(r)
        except Exception as exc:
            if not results:
                raise ValueError(openverse.error_message(exc)) from exc
    if not results:
        raise ValueError("No public-domain pictures matched. Try other words.")
    _step(job, f"Found {len(results)} pictures")
    return {"kind": "find", "title": title, "queries": queries, "results": results[:40]}


def _draw(job, prompt):
    _step(job, "Drawing the layers")
    plan = _ask(DRAW, prompt, 16000)
    layers = [l for l in plan.get("layers") or [] if isinstance(l, dict) and "<svg" in str(l.get("svg", ""))][:8]
    if not layers:
        raise ValueError("The AI didn't draw any layers. Try again, or try a bigger model.")
    _step(job, f"Saving {len(layers)} layers")
    item = wallpapers.create_parallax(str(plan.get("title") or "Drawn scene"), {
        "background": plan.get("background"), "background2": plan.get("background2"), "layers": []},
        credit={"title": str(plan.get("title") or ""), "author": "Drawn by your AI from your words", "license": "Yours"})
    spec_layers = []
    for n, layer in enumerate(layers):
        svg = str(layer["svg"])
        if "xmlns=" not in svg:
            svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
        name = wallpapers.add_layer(item["id"], f"layer-{n + 1}.svg", svg.encode())
        spec_layers.append({"file": name, "name": str(layer.get("name") or f"Layer {n + 1}")[:60],
                            "depth": layer.get("depth", n / max(1, len(layers) - 1)), "fit": "cover",
                            "align": "center", "scroll": layer.get("scroll", 0), "repeat": bool(layer.get("scroll")),
                            "sway": layer.get("sway", 0)})
    item = wallpapers.save_spec(item["id"], {"background": plan.get("background"), "background2": plan.get("background2"),
                                             "layers": spec_layers})
    return {"kind": "item", "item": item}


def _shader(job, prompt):
    _step(job, "Writing the shader")
    plan = _ask(SHADER, prompt, 8000)
    code = str(plan.get("code") or "")
    item = wallpapers.create_shader(str(plan.get("title") or "Shader"), code,
                                    credit={"author": "Written by your AI from your words", "license": "Yours"})
    _step(job, "Saved. Checking that it compiles")
    return {"kind": "item", "item": item, "check": True}


def _stage(job, prompt):
    _step(job, "Planning the scene")
    terms = _ask(STAGE_TERMS, prompt, 600)
    _step(job, "Looking through Poly Haven's free skies and models")
    try:
        skies = _merge(polyhaven.search("hdris", t, 12) for t in (terms.get("sky") or [])[:3]) or polyhaven.browse("hdris")[:20]
        models = _merge(polyhaven.search("models", t, 10) for t in (terms.get("models") or [])[:6])
    except Exception as exc:
        raise ValueError(polyhaven.error_message(exc)) from exc
    if not models:
        models = polyhaven.browse("models")[:30]
    listing = ("SKIES:\n" + "\n".join(f"{s['id']}: {s['name']} ({', '.join(s['tags'][:6])})" for s in skies[:20]) +
               "\n\nMODELS:\n" + "\n".join(f"{m['id']}: {m['name']} {m.get('dimensions') or ''} ({', '.join(m['tags'][:5])})"
                                          for m in models[:40]))
    _step(job, "Arranging the scene")
    spec = _ask(STAGE_LAYOUT, f"Wallpaper request: {prompt}\n\n{listing}", 3000)
    ids_sky = {s["id"] for s in skies}
    ids_model = {m["id"] for m in models}
    sky = spec.get("sky") if isinstance(spec.get("sky"), dict) else {}
    if sky.get("hdri") not in ids_sky:
        sky["hdri"] = skies[0]["id"] if skies else ""
    spec["sky"] = sky
    spec["models"] = [m for m in spec.get("models") or [] if isinstance(m, dict) and m.get("asset") in ids_model][:12]
    spec["title"] = str(spec.get("title") or terms.get("title") or "3D scene")[:60]
    spec["camera"] = {**(spec.get("camera") if isinstance(spec.get("camera"), dict) else {}), "auto": True}
    clean = wallpapers.clean_stage(spec)
    _download_stage(job, clean)
    item = wallpapers.create_stage(clean.get("title") or "3D scene", clean, credit={
        "author": "Arranged by your AI; sky and models from Poly Haven", "license": "CC0", "url": "https://polyhaven.com"})
    return {"kind": "item", "item": item}


def _download_stage(job, spec):
    try:
        if spec["sky"]["hdri"]:
            _step(job, f"Downloading the sky ({spec['sky']['hdri']})")
            polyhaven.fetch("hdris", spec["sky"]["hdri"], spec["sky"]["res"])
        for n, m in enumerate({m["asset"]: m for m in spec["models"]}.values()):
            _step(job, f"Downloading model {n + 1}: {m['asset']}")
            polyhaven.fetch("models", m["asset"], m["res"])
    except Exception as exc:
        raise ValueError(polyhaven.error_message(exc)) from exc


def _merge(lists):
    out, seen = [], set()
    for lst in lists:
        for item in lst:
            if item["id"] not in seen:
                seen.add(item["id"])
                out.append(item)
    return out


def _paint(job, prompt):
    _step(job, "Painting the picture")
    data = assistant.paint(f"A desktop wallpaper, 16:9, no text: {prompt}. {STYLE}")
    ext = ".png" if data[:8] == b"\x89PNG\r\n\x1a\n" else ".jpg"
    with tempfile.TemporaryDirectory(prefix="aerie-paint-") as tmp:
        path = Path(tmp) / ("painted" + ext)
        path.write_bytes(data)
        title = re.sub(r"\s+", " ", prompt)[:50]
        item = wallpapers.add_downloaded(path, title, {"author": "Painted by OpenAI's image model from your words",
                                                      "license": "Yours (see OpenAI's terms)"}, source="painted")
    return {"kind": "item", "item": item}


def _revise(job, prompt, revise):
    it = wallpapers.get(str(revise.get("id", "")))
    if not it or not it.get("copied"):
        raise ValueError("That wallpaper can't be changed here.")
    if it["type"] == "shader":
        code = (Path(it["root"]) / "shader.glsl").read_text(errors="replace")
        error = str(revise.get("error") or "")[:2000]
        ask = (f"Here is the shader:\n{code}\n\n" +
               (f"It doesn't compile. The error was:\n{error}\nFix it." if error else "") +
               (f"\nChange it like this: {prompt}" if prompt else ""))
        _step(job, "Fixing the shader" if error else "Changing the shader")
        plan = _ask(SHADER, ask, 8000)
        item = wallpapers.update_shader(it["id"], str(plan.get("code") or code))
        return {"kind": "item", "item": item, "check": True}
    if it["type"] == "stage":
        spec = json.loads((Path(it["root"]) / "stage.json").read_text())
        _step(job, "Changing the scene")
        listing = "Current layout (keep what isn't asked to change):\n" + json.dumps(spec)
        new = _ask(STAGE_LAYOUT, f"Change request: {prompt}\n\n{listing}\n\n(You may only use asset ids already in the "
                                 f"layout, unless the request clearly needs something new; then I will search Poly Haven.)",
                   3000)
        clean = wallpapers.clean_stage({**spec, **new, "camera": {**spec.get("camera", {}), **(new.get("camera") or {})}})
        _download_stage(job, clean)
        item = wallpapers.save_spec(it["id"], clean)
        return {"kind": "item", "item": item}
    raise ValueError("The AI can change shaders and 3D scenes it made. For other wallpapers, ask for a new one.")
