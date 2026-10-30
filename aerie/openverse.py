"""Free pictures for 2D wallpapers from Openverse (openverse.org), only ones in the public domain
(CC0 or the Public Domain Mark), so you can use them for anything.

Aerie only goes online here when you search in Studio (or ask the assistant to find art), and
only after you allowed online content. Your search words go to Openverse (run by the WordPress
Foundation); the picture you pick downloads from the site that hosts it (often Flickr or
Wikimedia Commons). Credits stay with the wallpaper.
"""

import json
import re
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlencode, urlparse

from . import __version__, paths, wallpapers

API = "https://api.openverse.org/v1/images/"
USER_AGENT = f"Aerie/{__version__} (+https://github.com/Jayswansocool48/aerie)"
LICENSES = "cc0,pdm"
THUMB_DIR = paths.DATA_DIR / "cache" / "openverse"
MAX_IMAGE = 60 * 1024 * 1024
_ID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
_MAGIC = ((b"\xff\xd8\xff", ".jpg"), (b"\x89PNG\r\n\x1a\n", ".png"), (b"GIF8", ".gif"))


def _request(url, limit, timeout=30, accept="application/json"):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("only https downloads")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": accept})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        data = res.read(limit + 1)
    if len(data) > limit:
        raise ValueError("That picture is too big (over 60 MB).")
    return data


def _public(r):
    return {
        "id": r.get("id"), "title": str(r.get("title") or "Untitled")[:160],
        "creator": str(r.get("creator") or "")[:120], "license": str(r.get("license") or "").lower(),
        "licenseUrl": str(r.get("license_url") or ""), "source": str(r.get("source") or r.get("provider") or ""),
        "page": str(r.get("foreign_landing_url") or ""), "width": r.get("width") or 0, "height": r.get("height") or 0,
    }


def search(query, page=1, wide=True):
    """[{id, title, creator, license, source, page, width, height}] for one page of results."""
    params = {"q": str(query)[:200], "license": LICENSES, "page_size": 20, "page": max(1, min(12, int(page))),
              "size": "large", "mature": "false"}
    if wide:
        params["aspect_ratio"] = "wide"
    data = json.loads(_request(API + "?" + urlencode(params), 4 * 1024 * 1024))
    return [_public(r) for r in data.get("results") or [] if _ID.match(str(r.get("id") or ""))]


def detail(image_id):
    if not _ID.match(str(image_id)):
        raise ValueError("bad id")
    return json.loads(_request(f"{API}{image_id}/", 1024 * 1024))


def thumbnail(image_id):
    """A small preview (Openverse makes these), cached on disk."""
    if not _ID.match(str(image_id)):
        raise ValueError("bad id")
    path = THUMB_DIR / f"{image_id}.jpg"
    if not path.exists():
        data = _request(f"{API}{image_id}/thumb/", 4 * 1024 * 1024, accept="image/*")
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    return path


def import_image(image_id):
    """Downloads one search result and adds it to your library, with its credits. The address
    comes from Openverse itself (never from the page), and only real pictures are accepted."""
    info = detail(image_id)
    lic = str(info.get("license") or "").lower()
    if lic not in LICENSES.split(","):
        raise ValueError("Aerie only adds public-domain pictures (CC0 or Public Domain Mark).")
    data = _request(str(info.get("url") or ""), MAX_IMAGE, timeout=90, accept="image/*")
    ext = next((e for magic, e in _MAGIC if data.startswith(magic)), None)
    if not ext and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        ext = ".webp"
    if not ext:
        raise ValueError("That address didn't give a picture Aerie can use.")
    p = _public(info)
    credit = {"title": p["title"], "author": p["creator"], "source": p["source"] or "Openverse",
              "license": "CC0" if lic == "cc0" else "Public Domain Mark", "url": p["page"]}
    with tempfile.TemporaryDirectory(prefix="aerie-ov-") as tmp:
        name = re.sub(r"[^\w\- ]+", "", p["title"])[:60].strip() or "picture"
        path = Path(tmp) / (name + ext)
        path.write_bytes(data)
        return wallpapers.add_downloaded(path, p["title"], credit, source="openverse")


def clear_cache():
    import shutil
    shutil.rmtree(THUMB_DIR, ignore_errors=True)


def error_message(exc):
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code == 429:
            return "Openverse says too many searches for now. Wait a minute and try again."
        return f"Openverse answered {exc.code}"
    if isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        return "Couldn't reach Openverse. Are you online?"
    return str(exc)
