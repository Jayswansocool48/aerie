"""Free 360° skies (HDRIs) and 3D models from Poly Haven (polyhaven.com) for 3D stage wallpapers.

Everything on Poly Haven is CC0 (public domain). Aerie only goes online here when you search
Poly Haven in Studio or ask the assistant for a 3D wallpaper, and only after you allowed online
content in Studio. Downloads are kept in ~/.local/share/aerie/library and work offline after that.
Poly Haven's API terms ask apps to name Poly Haven next to its content and to send an app
user-agent; Studio labels the section "Poly Haven" and every request carries USER_AGENT.
"""

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from . import __version__, paths

API = "https://api.polyhaven.com"
ALLOWED_HOSTS = ("polyhaven.com", "polyhaven.org")
USER_AGENT = f"Aerie/{__version__} (+https://github.com/Jayswansocool48/aerie)"
LIBRARY_DIR = paths.DATA_DIR / "library"
KINDS = ("hdris", "models")
RESOLUTIONS = ("1k", "2k", "4k", "8k")
MAX_DOWNLOAD = 400 * 1024 * 1024
_ID = re.compile(r"^[A-Za-z0-9_\-]{1,120}$")


def _get(url, limit=MAX_DOWNLOAD, timeout=60):
    host = urlparse(url).hostname or ""
    if urlparse(url).scheme != "https" or not any(host == h or host.endswith("." + h) for h in ALLOWED_HOSTS):
        raise ValueError(f"not a Poly Haven address: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read(limit + 1)
    if len(data) > limit:
        raise ValueError("download too large")
    return data


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(path)


def browse(kind):
    """Everything of one kind, most popular first:
    [{id, name, categories, tags, authors, popularity, dimensions (models, in metres)}]."""
    if kind not in KINDS:
        raise ValueError("unknown kind")
    cache = LIBRARY_DIR / f"index-{kind}.json"
    if cache.exists() and time.time() - cache.stat().st_mtime < 86400:
        try:
            return json.loads(cache.read_text())
        except ValueError:
            pass
    raw = json.loads(_get(f"{API}/assets?type={kind}", limit=40 * 1024 * 1024))
    items = []
    for asset_id, a in raw.items():
        if not _ID.match(asset_id) or not isinstance(a, dict):
            continue
        dims = a.get("dimensions") if isinstance(a.get("dimensions"), list) else []
        items.append({
            "id": asset_id,
            "name": str(a.get("name") or asset_id)[:120],
            "categories": [str(c) for c in a.get("categories") or []][:8],
            "tags": [str(t) for t in a.get("tags") or []][:12],
            "authors": sorted((a.get("authors") or {}).keys())[:4],
            "popularity": a.get("download_count") or 0,
            "dimensions": [round(float(d) / 1000, 3) for d in dims[:3] if isinstance(d, (int, float))],
        })
    items.sort(key=lambda i: -i["popularity"])
    _save(cache, json.dumps(items).encode())
    return items


def search(kind, query="", limit=60):
    """Assets whose name, tags or categories match every word of `query` (most popular first)."""
    words = [w for w in re.split(r"[^a-z0-9]+", str(query).lower()) if len(w) > 1][:8]
    out = []
    for item in browse(kind):
        hay = " ".join([item["name"], *item["tags"], *item["categories"]]).lower()
        if all(w in hay for w in words):
            out.append(item)
            if len(out) >= limit:
                break
    return out


def find(kind, asset_id):
    return next((i for i in browse(kind) if i["id"] == asset_id), None)


def thumbnail(asset_id):
    """Path of a small preview picture (downloaded once)."""
    if not _ID.match(asset_id):
        raise ValueError("bad id")
    path = LIBRARY_DIR / "thumbs" / f"{asset_id}.webp"
    if not path.exists():
        url = f"https://cdn.polyhaven.com/asset_img/thumbs/{asset_id}.png?width=320&height=180&format=webp"
        _save(path, _get(url, limit=4 * 1024 * 1024, timeout=20))
    return path


def local(kind, asset_id, resolution):
    """The downloaded file for an asset, or None if it isn't downloaded yet."""
    if kind not in KINDS or not _ID.match(asset_id) or resolution not in RESOLUTIONS:
        return None
    if kind == "hdris":
        path = LIBRARY_DIR / "hdris" / f"{asset_id}_{resolution}.hdr"
        return path if path.is_file() else None
    folder = LIBRARY_DIR / "models" / f"{asset_id}_{resolution}"
    found = sorted(folder.glob("*.gltf")) if folder.is_dir() else []
    return found[0] if found else None


def fetch(kind, asset_id, resolution="2k"):
    """Downloads a sky or model (once) and returns the local URL the page loads it from."""
    if kind not in KINDS or not _ID.match(asset_id):
        raise ValueError("bad request")
    if resolution not in RESOLUTIONS:
        resolution = "2k"
    have = local(kind, asset_id, resolution)
    if have:
        return "/library/" + have.relative_to(LIBRARY_DIR).as_posix()
    files = json.loads(_get(f"{API}/files/{asset_id}", limit=8 * 1024 * 1024))
    if kind == "hdris":
        options = files.get("hdri") or {}
        res = resolution if resolution in options else next((r for r in RESOLUTIONS if r in options), None)
        if not res:
            raise ValueError("no download available")
        url = options[res]["hdr"]["url"]
        path = LIBRARY_DIR / "hdris" / f"{asset_id}_{resolution}.hdr"
        _save(path, _get(url))
        return "/library/" + path.relative_to(LIBRARY_DIR).as_posix()
    options = files.get("gltf") or {}
    res = resolution if resolution in options else next((r for r in RESOLUTIONS if r in options), None)
    if not res:
        raise ValueError("no glTF download available")
    entry = options[res]["gltf"]
    folder = LIBRARY_DIR / "models" / f"{asset_id}_{resolution}"
    main = folder / Path(urlparse(entry["url"]).path).name
    for rel, inc in (entry.get("include") or {}).items():
        target = (folder / rel).resolve()
        if folder.resolve() not in target.parents:
            raise ValueError("bad file path in model")
        if not target.exists():
            _save(target, _get(inc["url"]))
    _save(main, _get(entry["url"]))
    return "/library/" + main.relative_to(LIBRARY_DIR).as_posix()


def local_file(rel):
    """The file behind a /library/... URL, if it is inside the library folder."""
    target = (LIBRARY_DIR / rel).resolve()
    if LIBRARY_DIR.resolve() not in target.parents or not target.is_file():
        return None
    return target


def remove_all():
    import shutil
    shutil.rmtree(LIBRARY_DIR, ignore_errors=True)


def error_message(exc):
    if isinstance(exc, urllib.error.HTTPError):
        return f"Poly Haven answered {exc.code}"
    if isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        return "Couldn't reach Poly Haven. Are you online?"
    return str(exc)
