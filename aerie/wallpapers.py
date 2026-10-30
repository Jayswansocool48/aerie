"""Your wallpaper library: every kind of wallpaper Aerie plays, and importing them.

Imported files are copied to ~/.local/share/aerie/wallpapers/<id>/ so they keep working if
the original is moved. Wallpapers you subscribed to in the Steam Workshop for Wallpaper
Engine are used where Steam keeps them (Aerie never changes them), and show up by themselves.

Kinds of wallpaper:
  image     a picture (also animated GIF / WebP / APNG, and SVG drawings)
  video     a looping video (mp4, webm, mkv, mov)
  web       an HTML page in a folder (Wallpaper Engine "web" and Lively web wallpapers)
  url       a web site, loaded live
  scene     a Wallpaper Engine scene: its picture layers are taken out and drawn with parallax
  model     a 3D scene made in Blender (or any 3D app) and exported as glTF (.glb / .gltf),
            played live with its camera, lights and animations
  shader    a Shadertoy-style GLSL shader (mainImage), drawn live on the GPU
  parallax  2D picture layers that shift with the mouse at their own depth (parallax.json)
  stage     a 3D scene put together from free Poly Haven skies and models (stage.json)

The wallpapers that come with Aerie are folders in web/wallpapers/ (see docs/WALLPAPERS.md).
"""

import hashlib
import json
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path
from urllib.parse import quote, urlparse

from . import paths, wetex

LIB_DIR = paths.DATA_DIR / "wallpapers"
INDEX_FILE = LIB_DIR / "index.json"
CACHE_DIR = paths.DATA_DIR / "cache" / "scenes"
WE_APP_ID = "431960"  # Wallpaper Engine on Steam

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".apng", ".svg"}
VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv"}
WEB_EXT = {".html", ".htm"}
MODEL_EXT = {".glb", ".gltf"}
SHADER_EXT = {".glsl", ".frag", ".fs", ".shader"}
KINDS = ("image", "video", "web", "url", "scene", "model", "shader", "parallax", "stage")
DEFAULTS_DIR = paths.WEB_DIR / "wallpapers"
MAX_SHADER = 256 * 1024
MAX_LAYERS = 16
MAX_IMPORT = 4 * 1024 * 1024 * 1024  # 4 GB, for long 4K videos
_ID = re.compile(r"^[a-z0-9_-]{4,64}$")
_lock = threading.RLock()
_steam_cache = {"time": 0, "items": []}


class ImportError_(ValueError):
    """Something can't be imported; the message is shown to you as it is."""


# ---- the index ---------------------------------------------------------------------------------


def _load_index():
    try:
        data = json.loads(INDEX_FILE.read_text())
        return data if isinstance(data, dict) else {"items": {}, "hidden": []}
    except (OSError, ValueError):
        return {"items": {}, "hidden": []}


def _save_index(index):
    LIB_DIR.mkdir(parents=True, exist_ok=True)
    tmp = INDEX_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(index, indent=1))
    tmp.replace(INDEX_FILE)


def list_items(include_steam=True):
    """Every wallpaper, newest first."""
    with _lock:
        index = _load_index()
        items = [dict(it) for it in index["items"].values() if Path(it["root"]).exists() or it["type"] == "url"]
        hidden_ids = set(index.get("hidden") or [])
        items += [d for d in default_items() if d["id"] not in hidden_ids]
        if include_steam:
            known = {it.get("workshopId") for it in items if it.get("workshopId")}
            hidden = set(index.get("hidden") or [])
            items += [it for it in steam_items() if it["workshopId"] not in known and it["id"] not in hidden]
        hashes = index.get("blurhash") or {}
        for it in items:
            if it["id"] in hashes:
                it["blurhash"] = hashes[it["id"]]
    items.sort(key=lambda it: (it.get("source") != "default", -it.get("added", 0) if it.get("source") != "default" else
                               it.get("order", 99), it.get("title", "").lower()))
    return [public(it) for it in items]


def public(it):
    """What the pages see (no full paths of your files)."""
    out = {k: v for k, v in it.items() if k not in ("root",)}
    out["previewUrl"] = f"/wp/{it['id']}/{quote(it['preview'])}" if it.get("preview") else ""
    if it["type"] in ("image", "video", "model", "shader", "parallax", "stage"):
        out["fileUrl"] = f"/wp/{it['id']}/{quote(it['entry'])}"
    out["editable"] = bool(it.get("copied")) and it["type"] in ("shader", "parallax", "stage")
    return out


def get(item_id):
    """The full record of one wallpaper, or None."""
    if not isinstance(item_id, str) or not _ID.match(item_id):
        return None
    with _lock:
        it = _load_index()["items"].get(item_id)
    if it:
        return dict(it)
    for it in default_items():
        if it["id"] == item_id:
            return dict(it)
    for it in steam_items():
        if it["id"] == item_id:
            return dict(it)
    return None


def resolve_file(item_id, rel):
    """The file `rel` inside a wallpaper's folder, or None (never anything outside it)."""
    it = get(item_id)
    if not it or it["type"] == "url":
        return None
    root = Path(it["root"]).resolve()
    if it["type"] == "scene":
        cache = (CACHE_DIR / it["id"]).resolve()
        target = (cache / rel).resolve()
        if cache in target.parents and target.is_file():
            return target
    target = (root / rel).resolve()
    if (root in target.parents or target == root) and target.is_file():
        return target
    return None


def remove(item_id):
    """Removes a wallpaper from the library. Steam Workshop ones are only hidden here
    (unsubscribe in Steam to delete them)."""
    with _lock:
        index = _load_index()
        if item_id.startswith("default-"):
            # the wallpapers that come with Aerie are hidden, not deleted (Settings brings them back)
            if any(d["id"] == item_id for d in default_items()):
                index.setdefault("hidden", []).append(item_id)
                _save_index(index)
                return True
            return False
        it = index["items"].pop(item_id, None)
        if it is None:
            if any(s["id"] == item_id for s in steam_items()):
                index.setdefault("hidden", []).append(item_id)
                _save_index(index)
                return True
            return False
        _save_index(index)
    if it.get("copied"):
        shutil.rmtree(LIB_DIR / item_id, ignore_errors=True)
    shutil.rmtree(CACHE_DIR / item_id, ignore_errors=True)
    return True


def unhide_all():
    with _lock:
        index = _load_index()
        index["hidden"] = []
        _save_index(index)


_BLURHASH = re.compile(r"^[0-9A-Za-z#$%*+,\-.:;=?@\[\]^_{|}~]{6,60}$")


def update(item_id, changes):
    """Rename a wallpaper, mark it as a favorite, or keep the blurred placeholder of its preview."""
    if "blurhash" in changes:
        value = changes["blurhash"]
        if not (isinstance(value, str) and _BLURHASH.match(value)) or not get(item_id):
            return None
        with _lock:
            index = _load_index()
            index.setdefault("blurhash", {})[item_id] = value
            _save_index(index)
        return True
    with _lock:
        index = _load_index()
        it = index["items"].get(item_id)
        if not it:
            # a Steam item: keep your changes in the index too
            steam = next((s for s in steam_items() if s["id"] == item_id), None)
            if not steam:
                return None
            index.setdefault("overrides", {})
            over = index["overrides"].setdefault(item_id, {})
            if "title" in changes:
                over["title"] = str(changes["title"])[:120]
            if "favorite" in changes:
                over["favorite"] = bool(changes["favorite"])
            _save_index(index)
            _steam_cache["time"] = 0
            return True
        if "title" in changes:
            it["title"] = str(changes["title"])[:120] or it["title"]
        if "favorite" in changes:
            it["favorite"] = bool(changes["favorite"])
        _save_index(index)
        return True


def _add(item):
    with _lock:
        index = _load_index()
        index["items"][item["id"]] = item
        _save_index(index)
    return public(item)


# ---- importing ----------------------------------------------------------------------------------


def import_path(src, copy=True):
    """Imports a file or folder you picked: a picture, video, HTML page, a Wallpaper Engine
    folder (with project.json), a Lively folder (LivelyInfo.json) or a .zip of either."""
    src = Path(src).expanduser()
    if not src.exists():
        raise ImportError_("That file or folder doesn't exist any more.")
    if src.is_file() and src.suffix.lower() == ".zip":
        return _import_zip(src)
    if src.is_dir():
        return _import_folder(src, copy)
    return _import_file(src, copy)


def import_upload(filename, data):
    """A file dropped into Aerie Studio."""
    name = Path(filename).name or "wallpaper"
    with tempfile.TemporaryDirectory(prefix="aerie-") as tmp:
        path = Path(tmp) / _safe_name(name)
        path.write_bytes(data)
        return import_path(path, copy=True)


def import_url(url, title=""):
    """A web site as your wallpaper. It is loaded live, so it needs the internet."""
    url = str(url).strip()
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ImportError_("Type a full web address, starting with https://")
    item_id = "url-" + hashlib.sha1(url.encode()).hexdigest()[:12]
    return _add({
        "id": item_id, "title": (title or parsed.hostname)[:120], "type": "url", "source": "url",
        "root": "", "entry": url, "preview": "", "properties": {}, "rating": "everyone",
        "tags": ["Web"], "added": time.time(),
    })


def _safe_name(name):
    name = re.sub(r"[^\w.\- ]+", "_", name).strip(" .") or "file"
    return name[:120]


def _new_id():
    return uuid.uuid4().hex[:16]


def _import_file(src, copy):
    ext = src.suffix.lower()
    if ext in IMAGE_EXT:
        kind = "image"
    elif ext in VIDEO_EXT:
        kind = "video"
    elif ext in WEB_EXT:
        return _import_folder(src.parent, copy, entry=src.name)
    elif ext == ".gltf":
        return _import_folder(src.parent, copy, entry=src.name)
    elif ext == ".glb":
        kind = "model"
    elif ext in SHADER_EXT:
        if src.stat().st_size > MAX_SHADER:
            raise ImportError_("That shader file is too big to be a shader (over 256 KB).")
        return create_shader(_title_from(src.stem), src.read_text(errors="replace"), source="file")
    elif ext == ".pkg":
        return _import_folder(src.parent, copy)
    elif src.name.lower() in ("project.json", "livelyinfo.json", "parallax.json", "stage.json"):
        return _import_folder(src.parent, copy)
    else:
        raise ImportError_(f"Aerie can't use {ext or 'this kind of'} files as a wallpaper. Try a picture, a video, "
                           "a 3D scene (.glb), a shader (.glsl), an HTML page or a Wallpaper Engine folder.")
    if src.stat().st_size > MAX_IMPORT:
        raise ImportError_("That file is too big (over 4 GB).")
    item_id = _new_id()
    folder = LIB_DIR / item_id
    folder.mkdir(parents=True, exist_ok=True)
    name = _safe_name(src.name)
    shutil.copy2(src, folder / name)
    return _add({
        "id": item_id, "title": _title_from(src.stem), "type": kind, "source": "file", "copied": True,
        "root": str(folder), "entry": name, "preview": name if kind == "image" else "",
        "properties": {}, "rating": "everyone", "tags": [{"image": "2D", "video": "Video", "model": "3D"}[kind]],
        "added": time.time(),
    })


def _import_zip(src):
    with tempfile.TemporaryDirectory(prefix="aerie-zip-") as tmp:
        try:
            with zipfile.ZipFile(src) as z:
                total = 0
                for info in z.infolist():
                    total += info.file_size
                    target = (Path(tmp) / info.filename).resolve()
                    if Path(tmp).resolve() not in target.parents and target != Path(tmp).resolve():
                        raise ImportError_("This zip file has unsafe paths in it, so it was not opened.")
                if total > MAX_IMPORT:
                    raise ImportError_("This zip file is too big (over 4 GB unpacked).")
                z.extractall(tmp)
        except zipfile.BadZipFile as exc:
            raise ImportError_("This zip file is damaged.") from exc
        root = Path(tmp)
        # use the folder that holds the wallpaper (zips often have one folder inside)
        for marker in ("project.json", "LivelyInfo.json", "parallax.json", "stage.json", "shader.glsl", "index.html", "*.gltf", "*.glb"):
            found = sorted(root.rglob(marker), key=lambda p: len(p.parts))
            if found:
                if found[0].suffix.lower() in MODEL_EXT:
                    return _import_folder(found[0].parent, copy=True, entry=found[0].name)
                return _import_folder(found[0].parent, copy=True)
        media = [p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXT | VIDEO_EXT]
        if media:
            return _import_file(max(media, key=lambda p: p.stat().st_size), copy=True)
        raise ImportError_("There is no wallpaper in this zip file.")


def _import_folder(src, copy, entry=None):
    meta = describe_folder(src, entry)
    item_id = _new_id()
    root = src
    if copy:
        size = sum(p.stat().st_size for p in src.rglob("*") if p.is_file())
        if size > MAX_IMPORT:
            raise ImportError_("That folder is too big (over 4 GB).")
        root = LIB_DIR / item_id
        shutil.copytree(src, root, symlinks=False, ignore=shutil.ignore_patterns(".git", "__MACOSX"))
    meta.update({"id": item_id, "root": str(root), "copied": bool(copy), "added": time.time()})
    return _add(meta)


def describe_folder(src, entry=None):
    """Works out what kind of wallpaper a folder holds. Raises ImportError_ if none."""
    src = Path(src)
    project = src / "project.json"
    lively = src / "LivelyInfo.json"
    if project.is_file():
        return _from_wallpaper_engine(src, _read_json(project))
    if lively.is_file():
        return _from_lively(src, _read_json(lively))
    if (src / "parallax.json").is_file():
        spec = _read_json(src / "parallax.json")
        return {"title": str(spec.get("title") or _title_from(src.name))[:120], "type": "parallax", "source": "folder",
                "entry": "parallax.json", "preview": _first(src, ("preview.jpg", "preview.png", "preview.webp")),
                "properties": {}, "rating": "everyone", "tags": ["2D"], "audio": _parallax_audio(spec)}
    if (src / "stage.json").is_file():
        spec = _read_json(src / "stage.json")
        return {"title": str(spec.get("title") or _title_from(src.name))[:120], "type": "stage", "source": "folder",
                "entry": "stage.json", "preview": _first(src, ("preview.jpg", "preview.png", "preview.webp")),
                "properties": {}, "rating": "everyone", "tags": ["3D"]}
    if (src / "shader.glsl").is_file():
        code = (src / "shader.glsl").read_text(errors="replace")[:MAX_SHADER]
        return {"title": _title_from(src.name), "type": "shader", "source": "folder", "entry": "shader.glsl",
                "preview": _first(src, ("preview.jpg", "preview.png", "preview.webp")),
                "properties": shader_properties(code), "rating": "everyone", "tags": ["Shader"],
                "audio": shader_uses_audio(code)}
    if entry and Path(entry).suffix.lower() in MODEL_EXT:
        return {"title": _title_from(Path(entry).stem), "type": "model", "source": "file", "entry": entry,
                "preview": _first(src, (Path(entry).stem + ".jpg", Path(entry).stem + ".png", "preview.jpg", "preview.png")),
                "properties": {}, "rating": "everyone", "tags": ["3D scene"]}
    if entry or (src / "index.html").is_file():
        entry = entry or "index.html"
        return {"title": _title_from(src.name), "type": "web", "source": "folder", "entry": entry,
                "preview": _first(src, ("preview.jpg", "preview.png", "preview.gif", "thumbnail.jpg")),
                "properties": {}, "rating": "everyone", "tags": ["Web"]}
    raise ImportError_("Aerie didn't find a wallpaper in that folder (no project.json, "
                       "LivelyInfo.json or index.html).")


def _read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as exc:
        raise ImportError_(f"{path.name} in that folder is damaged.") from exc


def _first(folder, names):
    for n in names:
        if (Path(folder) / n).is_file():
            return n
    return ""


def _title_from(stem):
    return re.sub(r"[_\-]+", " ", stem).strip()[:120] or "Wallpaper"


RATINGS = {"everyone": "everyone", "questionable": "questionable", "mature": "mature"}


def _from_wallpaper_engine(src, project):
    if not isinstance(project, dict):
        raise ImportError_("project.json in that folder is damaged.")
    kind = str(project.get("type", "")).lower()
    entry = str(project.get("file", "") or "")
    if kind == "video" or Path(entry).suffix.lower() in VIDEO_EXT:
        kind = "video"
    elif kind == "web" or Path(entry).suffix.lower() in WEB_EXT:
        kind = "web"
    elif kind == "scene" or entry.endswith(".json") or (src / "scene.pkg").exists():
        kind = "scene"
        entry = entry or "scene.json"
    elif kind == "application":
        raise ImportError_("This is a Wallpaper Engine \"application\" wallpaper (a Windows program), "
                           "which can't run on Linux.")
    else:
        raise ImportError_("Aerie doesn't know this kind of Wallpaper Engine wallpaper.")
    if kind != "scene" and not (src / entry).is_file():
        raise ImportError_(f"The wallpaper's file ({entry or 'none'}) is missing from the folder.")
    general = project.get("general") or {}
    return {
        "title": str(project.get("title") or src.name)[:120],
        "type": kind, "source": "wallpaper-engine", "entry": entry,
        "preview": str(project.get("preview") or "") if (src / str(project.get("preview") or "-")).is_file() else
        _first(src, ("preview.jpg", "preview.gif", "preview.png")),
        "properties": parse_properties(general.get("properties") or {}),
        "rating": RATINGS.get(str(project.get("contentrating", "Everyone")).lower(), "everyone"),
        "tags": [str(t)[:40] for t in (project.get("tags") or [])][:8],
        "workshopId": str(project.get("workshopid") or "") or None,
        "description": _plain(str(project.get("description") or ""))[:600],
        "audio": bool(general.get("supportsaudioprocessing")),
    }


def _from_lively(src, info):
    if not isinstance(info, dict):
        raise ImportError_("LivelyInfo.json in that folder is damaged.")
    entry = str(info.get("FileName") or "")
    is_url = bool(re.match(r"^https?://", entry, re.I))
    ext = Path(entry).suffix.lower()
    if is_url:
        kind = "url"
    elif ext in WEB_EXT:
        kind = "web"
    elif ext in VIDEO_EXT:
        kind = "video"
    elif ext in IMAGE_EXT:
        kind = "image"
    else:
        raise ImportError_("This kind of Lively wallpaper (an app or game) can't run on Linux.")
    if not is_url and not (src / entry).is_file():
        raise ImportError_(f"The wallpaper's file ({entry}) is missing from the folder.")
    props = {}
    lp = src / "LivelyProperties.json"
    if lp.is_file():
        try:
            props = parse_lively_properties(json.loads(lp.read_text(encoding="utf-8-sig")))
        except ValueError:
            props = {}
    return {
        "title": str(info.get("Title") or src.name)[:120], "type": kind, "source": "lively",
        "entry": entry, "preview": _first(src, (str(info.get("Preview") or "-"), str(info.get("Thumbnail") or "-"),
                                                "preview.gif", "preview.jpg", "thumbnail.jpg")),
        "properties": props, "rating": "everyone", "tags": ["Lively"],
        "description": _plain(str(info.get("Desc") or ""))[:600],
    }


# ---- wallpaper settings ("user properties") --------------------------------------------------

_LABELS = {
    "ui_browse_properties_scheme_color": "Color scheme",
    "ui_browse_properties_alignment": "Alignment",
    "ui_browse_properties_volume": "Volume",
    "ui_browse_properties_playback_rate": "Playback speed",
}
PROP_TYPES = {"color", "slider", "bool", "combo", "textinput", "text", "group"}


def _plain(text):
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"&nbsp;", " ", text).strip()


def _label(key, text):
    text = str(text or "")
    if text in _LABELS:
        return _LABELS[text]
    if text.startswith("ui_"):
        return _title_from(text.removeprefix("ui_browse_properties_")).capitalize()
    return _plain(text)[:80] or key


def parse_properties(raw):
    """Wallpaper Engine's settings for a wallpaper, in a simple form the editor can show."""
    props = {}
    if not isinstance(raw, dict):
        return props
    for key, p in raw.items():
        if not isinstance(p, dict):
            continue
        kind = str(p.get("type", "")).lower()
        if kind not in PROP_TYPES:
            continue
        item = {"type": kind, "label": _label(key, p.get("text")), "value": p.get("value"),
                "order": p.get("order", 0)}
        if kind == "slider":
            item.update(min=_num(p.get("min"), 0), max=_num(p.get("max"), 100), step=_num(p.get("step"), 1) or 1,
                        fraction=bool(p.get("fraction")))
            item["value"] = _num(p.get("value"), item["min"])
        elif kind == "combo":
            item["options"] = [{"label": _plain(str(o.get("label", o.get("value", ""))))[:60], "value": o.get("value")}
                               for o in (p.get("options") or []) if isinstance(o, dict)][:60]
        elif kind == "bool":
            item["value"] = bool(p.get("value"))
        elif kind == "color":
            item["value"] = str(p.get("value") or "1 1 1")
        if p.get("condition"):
            item["condition"] = str(p["condition"])[:200]
        props[str(key)[:60]] = item
    return dict(sorted(props.items(), key=lambda kv: (kv[1].get("order") or 0)))


def parse_lively_properties(raw):
    """Lively's LivelyProperties.json, in the same form."""
    props = {}
    if not isinstance(raw, dict):
        return props
    for i, (key, p) in enumerate(raw.items()):
        if not isinstance(p, dict):
            continue
        kind = str(p.get("type", "")).lower()
        item = {"label": _plain(str(p.get("text") or key))[:80], "order": i, "lively": True}
        if kind == "slider":
            item.update(type="slider", min=_num(p.get("min"), 0), max=_num(p.get("max"), 100),
                        step=_num(p.get("step"), 1) or 1, value=_num(p.get("value"), 0))
        elif kind == "color":
            item.update(type="color", value=str(p.get("value") or "#ffffff"))
        elif kind == "checkbox":
            item.update(type="bool", value=bool(p.get("value")))
        elif kind == "dropdown":
            item.update(type="combo", value=p.get("value", 0),
                        options=[{"label": str(o)[:60], "value": n} for n, o in enumerate(p.get("items") or [])][:60])
        elif kind == "textbox":
            item.update(type="textinput", value=str(p.get("value") or ""))
        else:
            continue
        props[str(key)[:60]] = item
    return props


def _num(v, default):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


# ---- Steam Workshop (Wallpaper Engine) -----------------------------------------------------


def steam_roots():
    """Steam library folders on this computer (normal and Flatpak Steam)."""
    home = Path.home()
    candidates = [home / ".local/share/Steam", home / ".steam/steam", home / ".steam/root",
                  home / ".var/app/com.valvesoftware.Steam/.local/share/Steam",
                  home / "snap/steam/common/.local/share/Steam"]
    roots = []
    for c in candidates:
        try:
            c = c.resolve()
        except OSError:
            continue
        if c.is_dir() and c not in roots:
            roots.append(c)
        vdf = c / "steamapps" / "libraryfolders.vdf"
        if vdf.is_file():
            try:
                for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(errors="replace")):
                    p = Path(m.group(1).replace("\\\\", "/"))
                    if p.is_dir() and p not in roots:
                        roots.append(p)
            except OSError:
                pass
    return roots


def steam_folders():
    """Folders that hold Wallpaper Engine wallpapers: Workshop downloads, and the
    wallpapers that come with Wallpaper Engine or that you made in it."""
    out = []
    for root in steam_roots():
        ws = root / "steamapps" / "workshop" / "content" / WE_APP_ID
        if ws.is_dir():
            out += [p for p in ws.iterdir() if p.is_dir()]
        projects = root / "steamapps" / "common" / "wallpaper_engine" / "projects"
        for sub in ("myprojects", "defaultprojects"):
            if (projects / sub).is_dir():
                out += [p for p in (projects / sub).iterdir() if p.is_dir()]
    return out


def steam_items(max_age=60):
    """Workshop wallpapers, found fresh at most once a minute."""
    if time.time() - _steam_cache["time"] < max_age:
        return _steam_cache["items"]
    items = []
    overrides = _load_index().get("overrides") or {}
    for folder in steam_folders():
        if not (folder / "project.json").is_file():
            continue
        try:
            meta = describe_folder(folder)
        except ImportError_:
            continue
        item_id = "steam-" + re.sub(r"[^a-z0-9]", "", folder.name.lower())[:40]
        meta.update({"id": item_id, "root": str(folder), "copied": False, "source": "steam",
                     "workshopId": meta.get("workshopId") or folder.name,
                     "added": (folder / "project.json").stat().st_mtime})
        meta.update(overrides.get(item_id) or {})
        items.append(meta)
    _steam_cache.update(time=time.time(), items=items)
    return items


def steam_status():
    """For Studio: is Steam here, and how many Wallpaper Engine wallpapers did we find."""
    roots = steam_roots()
    return {"steam": bool(roots), "count": len(steam_items(max_age=0)), "folders": [str(r) for r in roots]}


# ---- the scenes that come with Aerie --------------------------------------------------------


def default_items():
    """The wallpapers that come with Aerie: one folder each in web/wallpapers/, with an aerie.json
    ({"title", "tagline", "order", "credit": {"title", "author", "license", "url"}}) next to the
    wallpaper itself. A loose .glb or .gltf file there (a Blender scene you exported) works too."""
    out = []
    if not DEFAULTS_DIR.is_dir():
        return out
    for f in sorted(DEFAULTS_DIR.iterdir()):
        slug = re.sub(r"[^a-z0-9]+", "-", f.stem.lower()).strip("-")[:40] or "wallpaper"
        if f.is_file() and f.suffix.lower() in MODEL_EXT:
            meta, root, it = {}, DEFAULTS_DIR, None
            side = f.with_suffix(".json")
            if side.is_file():
                try:
                    meta = json.loads(side.read_text())
                except ValueError:
                    meta = {}
            it = {"type": "model", "entry": f.name, "tags": ["3D"], "properties": {},
                  "preview": _first(DEFAULTS_DIR, (f.stem + ".jpg", f.stem + ".webp", f.stem + ".png"))}
        elif f.is_dir() and (f / "aerie.json").is_file():
            root = f
            try:
                meta = json.loads((f / "aerie.json").read_text())
                it = describe_folder(f, meta.get("entry")) if not meta.get("entry") or meta.get("type") != "image" else {
                    "type": "image", "entry": meta["entry"], "tags": ["2D"], "properties": {},
                    "preview": meta.get("preview") or meta["entry"]}
            except (ValueError, ImportError_):
                continue
        else:
            continue
        it.update({
            "id": "default-" + slug, "title": str(meta.get("title") or it.get("title") or _title_from(f.stem))[:120],
            "tagline": str(meta.get("tagline") or "")[:160], "source": "default", "root": str(root),
            "rating": "everyone", "order": meta.get("order", 99), "added": 0, "credit": _credit(meta.get("credit")),
        })
        if meta.get("preview"):
            it["preview"] = meta["preview"]
        out.append(it)
    out.sort(key=lambda it: (it["order"], it["title"].lower()))
    return out


def _credit(raw):
    """Who made something and its license, for the credits line under a wallpaper."""
    if not isinstance(raw, dict):
        return None
    out = {k: str(raw.get(k) or "")[:200] for k in ("title", "author", "license", "url", "source")}
    if out["url"] and not re.match(r"^https?://", out["url"]):
        out["url"] = ""
    return out if any(out.values()) else None


# ---- wallpapers you make in Aerie: shaders, 2D parallax and 3D stages -----------------------

_UNIFORM = re.compile(r"^\s*uniform\s+(float|vec3|bool|int)\s+(\w+)\s*;\s*//\s*aerie:\s*(slider|color|bool)\s*(.*)$", re.M)
_QUOTED = re.compile(r'"([^"]{1,80})"')


def shader_properties(code):
    """Settings a shader offers, from comments on its uniforms:
        uniform float uSpeed; // aerie: slider 0 2 1 "Cloud speed"
        uniform vec3 uSky;    // aerie: color #3a7bd5 "Sky color"
        uniform bool uStars;  // aerie: bool 1 "Stars"
    """
    props = {}
    for n, m in enumerate(_UNIFORM.finditer(code or "")):
        gltype, name, kind, rest = m.groups()
        label_m = _QUOTED.search(rest)
        label = label_m.group(1) if label_m else name
        nums = _QUOTED.sub("", rest).split()
        item = {"type": kind, "label": label, "order": n, "uniform": name, "glsl": gltype}
        if kind == "slider":
            lo, hi, val = (_num(nums[i], d) if len(nums) > i else d for i, d in enumerate((0, 1, 0.5)))
            item.update(min=lo, max=hi, value=val, step=(hi - lo) / 100 or 0.01, fraction=True)
        elif kind == "color":
            val = nums[0] if nums and re.match(r"^#[0-9a-fA-F]{6}$", nums[0]) else "#ffffff"
            item["value"] = val
        else:
            item["value"] = bool(_num(nums[0], 1)) if nums else True
        props[name[:60]] = item
        if len(props) >= 24:
            break
    return props


def shader_uses_audio(code):
    return bool(re.search(r"//\s*aerie:\s*audio\b", code or ""))


def _parallax_audio(spec):
    return any(_num((layer or {}).get("react"), 0) > 0 for layer in (spec.get("layers") or []) if isinstance(layer, dict))


def _own_folder(title, kind, entry, tags, extra=None, source="made"):
    item_id = _new_id()
    folder = LIB_DIR / item_id
    folder.mkdir(parents=True, exist_ok=True)
    item = {"id": item_id, "title": (str(title).strip() or "Untitled")[:120], "type": kind, "source": source,
            "copied": True, "root": str(folder), "entry": entry, "preview": "", "properties": {}, "rating": "everyone",
            "tags": tags, "added": time.time()}
    item.update(extra or {})
    return item, folder


def create_shader(title, code, source="made", credit=None):
    """A new shader wallpaper from GLSL code (Shadertoy's mainImage, or a whole main())."""
    code = str(code or "")
    if not code.strip():
        raise ImportError_("The shader is empty.")
    if len(code.encode()) > MAX_SHADER:
        raise ImportError_("That shader is too long (over 256 KB).")
    if "mainImage" not in code and not re.search(r"void\s+main\s*\(", code):
        raise ImportError_("This doesn't look like a shader: it needs a mainImage() (Shadertoy) or main() function.")
    item, folder = _own_folder(title, "shader", "shader.glsl", ["Shader"],
                               {"properties": shader_properties(code), "audio": shader_uses_audio(code),
                                "credit": _credit(credit)}, source)
    (folder / "shader.glsl").write_text(code)
    return _add(item)


def update_shader(item_id, code):
    it = _own(item_id, "shader")
    code = str(code or "")
    if len(code.encode()) > MAX_SHADER or not code.strip():
        raise ImportError_("The shader is empty or too long.")
    (Path(it["root"]) / "shader.glsl").write_text(code)
    with _lock:
        index = _load_index()
        rec = index["items"][item_id]
        rec["properties"] = shader_properties(code)
        rec["audio"] = shader_uses_audio(code)
        _save_index(index)
    return public(rec)


def create_parallax(title, spec=None, source="made", credit=None):
    """A new, empty 2D parallax wallpaper; add pictures with add_layer()."""
    item, folder = _own_folder(title, "parallax", "parallax.json", ["2D"], {"credit": _credit(credit)}, source)
    clean = clean_parallax(spec or {"background": "#1d2b3a", "layers": []}, folder)
    (folder / "parallax.json").write_text(json.dumps(clean, indent=1))
    item["audio"] = _parallax_audio(clean)
    return _add(item)


def create_stage(title, spec=None, source="made", credit=None):
    """A new 3D stage (Poly Haven sky and models); assets are added by the Poly Haven module."""
    item, folder = _own_folder(title, "stage", "stage.json", ["3D"], {"credit": _credit(credit)}, source)
    (folder / "stage.json").write_text(json.dumps(clean_stage(spec or {}), indent=1))
    return _add(item)


def _own(item_id, kind):
    it = get(item_id)
    if not it or it["type"] != kind or not it.get("copied"):
        raise ImportError_("You can only change wallpapers you made or imported in Aerie.")
    return it


def add_layer(item_id, filename, data):
    """Adds a picture to a 2D parallax wallpaper's folder and returns its file name."""
    it = _own(item_id, "parallax")
    ext = Path(filename).suffix.lower()
    if ext not in IMAGE_EXT - {".bmp"}:
        raise ImportError_("Layers have to be pictures (PNG with see-through parts works best).")
    if len(data) > 64 * 1024 * 1024:
        raise ImportError_("That picture is too big for a layer (over 64 MB).")
    if ext == ".svg":
        data = sanitize_svg(data.decode("utf-8", "replace")).encode()
    folder = Path(it["root"]) / "layers"
    folder.mkdir(exist_ok=True)
    name = f"{uuid.uuid4().hex[:8]}-{_safe_name(Path(filename).stem)[:40]}{ext}"
    (folder / name).write_bytes(data)
    return "layers/" + name


def save_spec(item_id, spec):
    """Saves the layout of a parallax wallpaper or stage you edited in Studio."""
    it = get(item_id)
    if not it or it["type"] not in ("parallax", "stage") or not it.get("copied"):
        raise ImportError_("You can only change wallpapers you made or imported in Aerie.")
    folder = Path(it["root"])
    if it["type"] == "parallax":
        clean = clean_parallax(spec, folder)
    else:
        clean = clean_stage(spec)
    (folder / it["entry"]).write_text(json.dumps(clean, indent=1))
    with _lock:
        index = _load_index()
        rec = index["items"][item_id]
        if isinstance(spec.get("title"), str) and spec["title"].strip():
            rec["title"] = spec["title"].strip()[:120]
        if it["type"] == "parallax":
            rec["audio"] = _parallax_audio(clean)
        _save_index(index)
    return public(rec)


def _color(v, default):
    return v if isinstance(v, str) and re.match(r"^#[0-9a-fA-F]{6}$", v) else default


def _clamp(v, lo, hi, default):
    return max(lo, min(hi, _num(v, default)))


def clean_parallax(spec, folder=None):
    """Only the fields Aerie understands, with sane ranges; layer files must exist in the folder."""
    spec = spec if isinstance(spec, dict) else {}
    layers = []
    for raw in (spec.get("layers") or [])[:MAX_LAYERS]:
        if not isinstance(raw, dict):
            continue
        file = str(raw.get("file") or "").replace("\\", "/")
        if not file or file.startswith("/") or ".." in file.split("/"):
            continue
        if folder is not None and not (Path(folder) / file).is_file():
            continue
        layers.append({
            "file": file, "name": str(raw.get("name") or Path(file).stem)[:60],
            "depth": _clamp(raw.get("depth"), 0, 1, 0.5),
            "fit": raw.get("fit") if raw.get("fit") in ("cover", "width", "contain", "none") else "cover",
            "align": raw.get("align") if raw.get("align") in ("top", "center", "bottom") else "bottom",
            "x": _clamp(raw.get("x"), -100, 100, 0), "y": _clamp(raw.get("y"), -100, 100, 0),
            "scale": _clamp(raw.get("scale"), 0.1, 4, 1), "opacity": _clamp(raw.get("opacity"), 0, 1, 1),
            "scroll": _clamp(raw.get("scroll"), -200, 200, 0), "repeat": bool(raw.get("repeat")),
            "sway": _clamp(raw.get("sway"), 0, 1, 0), "react": _clamp(raw.get("react"), 0, 1, 0),
            "hidden": bool(raw.get("hidden")),
        })
    out = {"version": 1, "background": _color(spec.get("background"), "#1d2b3a"),
           "background2": _color(spec.get("background2"), ""), "parallax": _clamp(spec.get("parallax"), 0, 3, 1),
           "smoothing": _clamp(spec.get("smoothing"), 0.01, 1, 0.08), "layers": layers}
    if isinstance(spec.get("title"), str):
        out["title"] = spec["title"][:120]
    return out


_ASSET = re.compile(r"^[A-Za-z0-9_\-]{1,120}$")


def clean_stage(spec):
    spec = spec if isinstance(spec, dict) else {}

    def vec(v, default):
        if isinstance(v, (list, tuple)) and len(v) == 3:
            return [round(_clamp(x, -500, 500, d), 4) for x, d in zip(v, default)]
        return list(default)

    sky = spec.get("sky") if isinstance(spec.get("sky"), dict) else {}
    models = []
    for raw in (spec.get("models") or [])[:24]:
        if not isinstance(raw, dict) or not _ASSET.match(str(raw.get("asset") or "")):
            continue
        models.append({
            "asset": str(raw["asset"]), "name": str(raw.get("name") or raw["asset"])[:80],
            "res": raw.get("res") if raw.get("res") in ("1k", "2k", "4k") else "1k",
            "position": vec(raw.get("position"), (0, 0, 0)), "rotation": vec(raw.get("rotation"), (0, 0, 0)),
            "scale": _clamp(raw.get("scale"), 0.01, 50, 1), "spin": _clamp(raw.get("spin"), -2, 2, 0),
            "bob": _clamp(raw.get("bob"), 0, 1, 0),
        })
    cam = spec.get("camera") if isinstance(spec.get("camera"), dict) else {}
    ground = spec.get("ground") if isinstance(spec.get("ground"), dict) else {}
    fog = spec.get("fog") if isinstance(spec.get("fog"), dict) else {}
    out = {
        "version": 1,
        "sky": {"hdri": str(sky.get("hdri"))[:120] if _ASSET.match(str(sky.get("hdri") or "")) else "",
                "res": sky.get("res") if sky.get("res") in ("1k", "2k", "4k") else "2k",
                "rotation": _clamp(sky.get("rotation"), -360, 360, 0), "exposure": _clamp(sky.get("exposure"), 0.1, 4, 1),
                "blur": _clamp(sky.get("blur"), 0, 1, 0), "color": _color(sky.get("color"), "#4a6a8a")},
        "models": models,
        "camera": {"auto": cam.get("auto", True) is not False, "position": vec(cam.get("position"), (0, 1.6, 6)),
                   "target": vec(cam.get("target"), (0, 1, 0)), "fov": _clamp(cam.get("fov"), 15, 100, 45),
                   "orbit": _clamp(cam.get("orbit"), -1, 1, 0.03), "parallax": _clamp(cam.get("parallax"), 0, 3, 1)},
        "ground": {"show": bool(ground.get("show", True)), "color": _color(ground.get("color"), "#3d4a3a"),
                   "shadows": ground.get("shadows", True) is not False},
        "fog": {"color": _color(fog.get("color"), ""), "density": _clamp(fog.get("density"), 0, 0.2, 0)},
    }
    if isinstance(spec.get("title"), str):
        out["title"] = spec["title"][:120]
    return out


_SVG_BAD = re.compile(r"<\s*(script|foreignObject|iframe|object|embed)\b.*?(</\s*\1\s*>|/>)", re.I | re.S)
_SVG_EVENT = re.compile(r"\son[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)
_SVG_HREF = re.compile(r"(\s(?:xlink:)?href\s*=\s*)(\"(?!#)[^\"]*\"|'(?!#)[^']*')", re.I)


def sanitize_svg(svg):
    """SVG drawings run no code in Aerie (they are shown as pictures), but strip anything active
    or anything that would load from the internet anyway."""
    svg = _SVG_BAD.sub("", svg)
    svg = _SVG_EVENT.sub("", svg)
    svg = _SVG_HREF.sub(r'\1"#"', svg)
    return svg


def set_preview(item_id, data):
    """Keeps a preview picture Studio made of a wallpaper (for ones that came without one)."""
    it = get(item_id)
    if not it or not it.get("copied") or len(data) > 6 * 1024 * 1024:
        return None
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        name = "preview.png"
    elif data[:3] == b"\xff\xd8\xff":
        name = "preview.jpg"
    elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        name = "preview.webp"
    else:
        return None
    (Path(it["root"]) / name).write_bytes(data)
    with _lock:
        index = _load_index()
        rec = index["items"].get(item_id)
        if not rec:
            return None
        rec["preview"] = name
        index.setdefault("blurhash", {}).pop(item_id, None)
        _save_index(index)
    return public(rec)


def add_downloaded(path, title, credit=None, source="online"):
    """A picture downloaded from Openverse or made by an image AI: imported like a file, with credits."""
    item = import_path(path, copy=True)
    with _lock:
        index = _load_index()
        rec = index["items"].get(item["id"])
        if rec:
            rec["title"] = (str(title).strip() or rec["title"])[:120]
            rec["source"] = source
            rec["credit"] = _credit(credit)
            _save_index(index)
            return public(rec)
    return item


# ---- scenes -----------------------------------------------------------------------------------


def prepare_scene(item_id):
    """Takes the picture layers out of a scene (once) and returns their description."""
    it = get(item_id)
    if not it or it["type"] != "scene":
        raise ValueError("not a scene wallpaper")
    out = CACHE_DIR / item_id
    stamp = out / "layers.json"
    src_time = max((p.stat().st_mtime for p in Path(it["root"]).glob("scene.*")), default=0)
    if stamp.is_file() and stamp.stat().st_mtime >= src_time:
        try:
            return json.loads(stamp.read_text())
        except ValueError:
            pass
    with _lock:
        shutil.rmtree(out, ignore_errors=True)
        try:
            return wetex.extract_scene(it["root"], out, it.get("entry") or "scene.json")
        except (OSError, ValueError, KeyError, IndexError) as exc:
            shutil.rmtree(out, ignore_errors=True)
            raise ValueError(f"Aerie couldn't read this scene: {exc}") from exc


def storage_used():
    total = 0
    for base in (LIB_DIR, CACHE_DIR):
        for p in base.rglob("*") if base.exists() else []:
            if p.is_file():
                total += p.stat().st_size
    return total


def clear_cache():
    shutil.rmtree(CACHE_DIR, ignore_errors=True)
