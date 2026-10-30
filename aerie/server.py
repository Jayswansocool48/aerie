"""Local web server that feeds the Aerie page.

Listens on 127.0.0.1 only. Anything that changes state or reads app/system data
needs the per-run token, so other web pages in a browser can't use it.
"""

import json
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import (APP_ID, __version__, assistant, audio, cosmic_look, creator, lockscreen, media_player, openverse,
               package, paths, polyhaven, wallpapers)
from .app_catalog import AppCatalog
from .system_info import SystemInfo

MAX_UPLOAD = 200 * 1024 * 1024
MEDIA_TYPES = {
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg",  # images
    ".glb", ".gltf",  # 3D models
    ".mp4", ".webm",  # video wallpapers
    ".hdr",  # 360° HDR skies
}
_SAFE_NAME = re.compile(r"^[a-f0-9]{32}\.[a-z0-9]{2,5}$")

mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("model/gltf+json", ".gltf")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/vnd.radiance", ".hdr")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("font/woff", ".woff")
mimetypes.add_type("text/plain", ".glsl")
for _ext, _type in ((".mkv", "video/x-matroska"), (".mov", "video/quicktime"), (".m4v", "video/mp4"),
                    (".ogv", "video/ogg"), (".avif", "image/avif"), (".ttf", "font/ttf"), (".wasm", "application/wasm")):
    mimetypes.add_type(_type, _ext)
CHUNK = 1024 * 1024
READ_ONLY_POSTS = {"/api/now-playing"}  # all the lock screen may change
_IDEM_KEY = re.compile(r"^[A-Za-z0-9-]{8,64}$")


class Replies:
    """Remembers the answer to each request sent with an Idempotency-Key for 10 minutes, so a
    retry or a double click (same key) gets the first answer instead of running twice."""

    TTL = 600

    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}  # key -> {"time", "done": Event, "reply": (status, body)}

    def claim(self, key):
        """(entry, first): first is True when this request should do the work."""
        now = time.time()
        with self.lock:
            for k in [k for k, v in self.items.items() if now - v["time"] > self.TTL]:
                del self.items[k]
            entry = self.items.get(key)
            if entry:
                return entry, False
            entry = self.items[key] = {"time": now, "done": threading.Event(), "reply": None}
            return entry, True

    def forget(self, key):
        with self.lock:
            self.items.pop(key, None)


class AerieServer:
    def __init__(self, port=0, read_only=False):
        paths.ensure_dirs()
        self.token = secrets.token_urlsafe(24)
        self.read_only = read_only  # the lock screen: shows things, changes nothing
        self.catalog = AppCatalog()
        self.system = SystemInfo()
        self.on_shell_request = None  # set by the GTK shell: (action, monitor, extra) for quit, hub, reload…
        self.on_snapshot = None  # set by the GTK shell: (monitor, widgets, path) -> path
        self.on_pick = None  # set by the GTK shell: (folder: bool) -> chosen path or None
        self.audio_status = lambda: {"running": False, "problem": ""}  # set by the GTK shell
        self.replies = Replies()  # answers to requests that carried an Idempotency-Key
        handler = _make_handler(self)
        self.httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]
        self.web = WebWallpaperServer()

    @property
    def url(self):
        return self.url_for("index.html")

    def url_for(self, page, monitor=0, extra=""):
        return f"http://127.0.0.1:{self.port}/{page}?monitor={monitor}{extra}#token={self.token}"

    def web_wallpaper_url(self, item):
        """Where a web wallpaper loads from (its own address, apart from Aerie's)."""
        if item["type"] == "url":
            return item["entry"]
        return self.web.url_for(item)

    def start(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        threading.Thread(target=self.catalog.refresh, daemon=True).start()
        self.web.start()

    def stop(self):
        self.httpd.shutdown()
        self.web.stop()

    # ---- config -------------------------------------------------------
    def read_config(self):
        try:
            return json.loads(paths.CONFIG_FILE.read_text())
        except (OSError, ValueError):
            return None

    def write_config(self, data):
        paths.ensure_dirs()  # the folder may have been removed while running
        tmp = paths.CONFIG_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2))
        tmp.replace(paths.CONFIG_FILE)

    def online_allowed(self):
        """You turned on online content (Openverse and Poly Haven) in Studio."""
        g = (self.read_config() or {}).get("general") or {}
        return bool(g.get("online", g.get("libraryConsent")))

    def delete_all_data(self):
        cosmic_look.restore()  # put COSMIC's own look back before forgetting how it was
        _undo_extras()
        shutil.rmtree(paths.DATA_DIR, ignore_errors=True)
        shutil.rmtree(paths.CONFIG_DIR, ignore_errors=True)
        paths.AUTOSTART_FILE.unlink(missing_ok=True)
        paths.ensure_dirs()

    def install_info(self):
        return {"installed": package.INSTALLED, "canUpdate": package.can_update(),
                "version": __version__, "appId": APP_ID}

    def update(self):
        """Gets the newest Aerie from its published package source."""
        if not package.INSTALLED:
            return {"ok": False, "updated": False,
                    "message": "Running from the source folder: update with ./install.sh."}
        if not package.can_update():
            return {"ok": False, "updated": False,
                    "message": "To update this build, run ./install.sh again in the Aerie folder."}
        ok, out = package.update()
        if not ok:
            return {"ok": False, "updated": False, "message": "Could not update right now (cancelled or offline)."}
        updated = "aerie is already the newest version" not in out
        return {"ok": True, "updated": updated,
                "message": "Updated! Restart Aerie to use the new version." if updated else "You have the latest version."}

    def uninstall(self):
        """Removes the app and all of its data. Returns (ok, message)."""
        if not package.INSTALLED:
            return False, "Aerie is running from its source folder, so there is nothing installed to remove."
        cosmic_look.restore()  # give COSMIC its original look back
        _undo_extras()
        ok, _ = package.uninstall()
        if not ok:
            return False, "Uninstall was cancelled or failed. You can also remove Aerie in the COSMIC Store."
        shutil.rmtree(paths.DATA_DIR, ignore_errors=True)
        shutil.rmtree(paths.CONFIG_DIR, ignore_errors=True)
        paths.AUTOSTART_FILE.unlink(missing_ok=True)
        return True, "Aerie was uninstalled. Goodbye!"

    def restart(self):
        """Starts a fresh copy after this one quits (used after an update)."""
        return package.spawn(["sh", "-c", f"sleep 2; {package.launch_command()}"])

    def set_autostart(self, enabled):
        if enabled:
            paths.AUTOSTART_FILE.parent.mkdir(parents=True, exist_ok=True)
            paths.AUTOSTART_FILE.write_text(
                "[Desktop Entry]\nType=Application\nName=Aerie\n"
                f"Comment=3D desktop with widgets\nExec={package.launch_command()} --background\n"
                f"Icon={APP_ID}\nX-GNOME-Autostart-enabled=true\n"
            )
        else:
            paths.AUTOSTART_FILE.unlink(missing_ok=True)
        return paths.AUTOSTART_FILE.exists()


def _undo_extras():
    """Everything Aerie set up outside its own folders: the lock screen choice (the package
    removal takes the system switch away), and the hub shortcuts older versions added."""
    _remove_old_shortcuts()
    lockscreen.FLAG.unlink(missing_ok=True)
    lockscreen.restart_locker()


def _remove_old_shortcuts():
    """Aerie 2.x put Super+D and Super+Shift+W for its hub in COSMIC's custom shortcuts."""
    f = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "cosmic" / \
        "com.system76.CosmicSettings.Shortcuts" / "v1" / "custom"
    try:
        text = f.read_text()
    except OSError:
        return
    lines = text.splitlines(keepends=True)
    kept = [ln for ln in lines if not ("--hub" in ln and "aerie" in ln)]
    if len(kept) != len(lines):
        tmp = f.with_name(".custom.aerie-tmp")
        tmp.write_text("".join(kept))
        tmp.replace(f)


class WebWallpaperServer:
    """Serves web wallpapers from a second address, so their code can't reach Aerie's own
    pages or settings. Each wallpaper gets a random path that only works while Aerie runs."""

    def __init__(self):
        self.routes = {}  # random key -> folder
        server = self

        class Handler(BaseHTTPRequestHandler):
            server_version = "Aerie"

            def log_message(self, *args):
                pass

            def do_GET(self):
                parts = urlparse(self.path).path.lstrip("/").split("/", 1)
                root = server.routes.get(parts[0])
                rel = unquote(parts[1]) if len(parts) > 1 else ""
                if not root or self.headers.get("Host", "") not in (f"127.0.0.1:{server.port}", f"localhost:{server.port}"):
                    self.send_error(404)
                    return
                target = (root / (rel or "index.html")).resolve()
                if root not in target.parents or not target.is_file():
                    self.send_error(404)
                    return
                send_file(self, target, cache=True, extra_headers={"Access-Control-Allow-Origin": "*"})

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.port = self.httpd.server_address[1]

    def url_for(self, item):
        root = Path(item["root"]).resolve()
        key = next((k for k, v in self.routes.items() if v == root), None) or secrets.token_urlsafe(12)
        self.routes[key] = root
        entry = "/".join(item["entry"].replace("\\", "/").split("/"))
        return f"http://127.0.0.1:{self.port}/{key}/{entry}"

    def start(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def stop(self):
        self.httpd.shutdown()


def send_file(handler, path, cache=True, extra_headers=None):
    """Sends a file in pieces, with support for seeking in videos (Range requests)."""
    try:
        size = os.path.getsize(path)
        f = open(path, "rb")
    except OSError:
        handler.send_error(404)
        return
    with f:
        ctype = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        start, end = 0, size - 1
        rng = handler.headers.get("Range", "")
        m = re.match(r"bytes=(\d*)-(\d*)$", rng.strip())
        partial = bool(m) and size > 0
        if partial:
            if m.group(1):
                start = int(m.group(1))
                end = int(m.group(2)) if m.group(2) else size - 1
            else:  # the last N bytes
                start = max(0, size - int(m.group(2) or 0))
            end = min(end, size - 1)
            if start > end:
                handler.send_response(416)
                handler.send_header("Content-Range", f"bytes */{size}")
                handler.end_headers()
                return
        handler.send_response(206 if partial else 200)
        handler.send_header("Content-Type", ctype)
        handler.send_header("Accept-Ranges", "bytes")
        handler.send_header("Content-Length", str(end - start + 1 if size else 0))
        if partial:
            handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        handler.send_header("Cache-Control", "max-age=3600" if cache else "no-cache")
        for k, v in (extra_headers or {}).items():
            handler.send_header(k, v)
        handler.end_headers()
        if handler.command == "HEAD":
            return
        f.seek(start)
        left = end - start + 1
        try:
            while left > 0:
                chunk = f.read(min(CHUNK, left))
                if not chunk:
                    break
                handler.wfile.write(chunk)
                left -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass  # the video player only wanted part of it


def _make_handler(app):
    class Handler(BaseHTTPRequestHandler):
        server_version = "Aerie/" + __version__

        def log_message(self, *args):
            pass

        # ---- helpers ----
        def _host_ok(self):
            host = self.headers.get("Host", "")
            return host in (f"127.0.0.1:{app.port}", f"localhost:{app.port}")

        def _authed(self):
            return secrets.compare_digest(self.headers.get("X-Aerie-Token", ""), app.token)

        def _json(self, data, status=200):
            body = json.dumps(data).encode()
            self.last_reply = (status, body)
            self._send_json_bytes(status, body)
            return True  # "handled", so a route helper's `return self._json(…)` stops the dispatch

        def _send_json_bytes(self, status, body):
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _file(self, path, cache=True):
            if not Path(path).is_file():
                return self._json({"error": "not found"}, 404)
            send_file(self, path, cache)

        def _req(self, body):
            try:
                data = json.loads(body or b"{}")
            except ValueError:
                data = {}
            return data if isinstance(data, dict) else {}

        def _query(self):
            from urllib.parse import parse_qs
            return {k: v[0] for k, v in parse_qs(urlparse(self.path).query).items()}

        def _body(self):
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length > MAX_UPLOAD:
                raise ValueError("too large")
            return self.rfile.read(length) if length else b""

        def _guard(self, need_token=True):
            if not self._host_ok():
                self._json({"error": "bad host"}, 403)
                return False
            if need_token and not self._authed():
                self._json({"error": "unauthorized"}, 401)
                return False
            return True

        # ---- routes ----
        def do_GET(self):
            route = urlparse(self.path).path
            if not self._guard(need_token=route.startswith("/api/")):
                return
            if route == "/api/config":
                return self._json({"config": app.read_config(), "version": __version__, "readOnly": app.read_only})
            if route == "/api/wallpapers":
                return self._json({"items": wallpapers.list_items()})
            if route == "/api/wallpapers/steam":
                return self._json(wallpapers.steam_status())
            if route == "/api/wallpapers/scene":
                try:
                    return self._json(wallpapers.prepare_scene(self._query().get("id", "")))
                except ValueError as exc:
                    return self._json({"error": str(exc)}, 400)
            if route.startswith("/wp/"):
                item_id, _, rel = route[len("/wp/"):].partition("/")
                f = wallpapers.resolve_file(item_id, unquote(rel))
                return self._file(f, cache=False) if f else self._json({"error": "not found"}, 404)
            if route == "/api/lock/status":
                return self._json(lockscreen.status())
            if route == "/api/lock/info":
                import pwd
                user = pwd.getpwuid(os.getuid())
                name = (user.pw_gecos or "").split(",")[0] or user.pw_name
                from . import userinfo
                return self._json({"name": name, "user": user.pw_name, "avatar": bool(userinfo.avatar(user.pw_name)),
                                   "clock24": cosmic_look.clock_24h()})
            if route == "/lock-avatar":
                import pwd
                from . import userinfo
                f = userinfo.avatar(pwd.getpwuid(os.getuid()).pw_name)
                return self._file(f, cache=False) if f else self._json({"error": "none"}, 404)
            if route == "/api/apps":
                return self._json({"apps": app.catalog.list()})
            if route == "/api/system":
                return self._json(app.system.snapshot())
            if route == "/api/autostart":
                return self._json({"enabled": paths.AUTOSTART_FILE.exists()})
            if route == "/api/now-playing":
                info = media_player.status()
                info.pop("artPath", None)
                return self._json(info)
            if route == "/now-playing-art":
                art = media_player.status().get("artPath", "")
                if art and Path(art).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".gif") and Path(art).is_file():
                    return self._file(art, cache=False)
                return self._json({"error": "no art"}, 404)
            if route.startswith("/icon/"):
                icon = app.catalog.icon_path(unquote(route[len("/icon/"):]))
                return self._file(icon) if icon else self._json({"error": "no icon"}, 404)
            if route == "/api/audio":
                ok, why = audio.available()
                return self._json({"available": ok, "why": why, **app.audio_status()})
            # ---- online: Poly Haven (3D) and Openverse (pictures), only after you allowed it
            if route in ("/api/polyhaven", "/api/openverse") or route.startswith(("/polyhaven-thumb/", "/openverse-thumb/")):
                if not app.online_allowed():
                    return self._json({"error": "Online content is off. Turn it on in Studio → Discover."}, 403)
                q = self._query()
                if route == "/api/polyhaven":
                    try:
                        return self._json({"items": polyhaven.search(q.get("kind", "hdris"), q.get("q", ""), 120)})
                    except Exception as exc:  # offline, Poly Haven down, …
                        return self._json({"error": polyhaven.error_message(exc)}, 502)
                if route == "/api/openverse":
                    try:
                        return self._json({"items": openverse.search(q.get("q", ""), int(q.get("page", "1") or 1))})
                    except Exception as exc:
                        return self._json({"error": openverse.error_message(exc)}, 502)
                try:
                    if route.startswith("/polyhaven-thumb/"):
                        return self._file(polyhaven.thumbnail(unquote(route[len("/polyhaven-thumb/"):])))
                    return self._file(openverse.thumbnail(unquote(route[len("/openverse-thumb/"):])))
                except Exception:
                    return self._json({"error": "not found"}, 404)
            if route.startswith("/library/"):
                f = polyhaven.local_file(unquote(route[len("/library/"):]))
                return self._file(f) if f else self._json({"error": "not found"}, 404)
            if route == "/api/polyhaven/local":
                q = self._query()
                f = polyhaven.local(q.get("kind", ""), q.get("id", ""), q.get("res", "2k"))
                url = "/library/" + f.relative_to(polyhaven.LIBRARY_DIR).as_posix() if f else ""
                return self._json({"url": url, "online": app.online_allowed()})
            if route == "/api/assistant":
                return self._json({**assistant.public(), "canPaint": assistant.can_paint()})
            if route == "/api/assistant/ollama-models":
                try:
                    return self._json({"models": assistant.ollama_models()})
                except Exception as exc:
                    return self._json({"models": [], "error": assistant.error_message(exc)})
            if route == "/api/assistant/job":
                job = creator.status(self._query().get("id", ""))
                return self._json(job) if job else self._json({"error": "no such job"}, 404)
            if route.startswith("/media/"):
                name = route[len("/media/"):]
                if not _SAFE_NAME.match(name):
                    return self._json({"error": "not found"}, 404)
                return self._file(paths.MEDIA_DIR / name)
            # static files
            rel = "index.html" if route in ("/", "") else unquote(route.lstrip("/"))
            target = (paths.WEB_DIR / rel).resolve()
            if paths.WEB_DIR.resolve() not in target.parents or not target.is_file():
                return self._json({"error": "not found"}, 404)
            return self._file(target, cache=False)

        def _upload_wallpaper(self):
            """A file dropped into Aerie Studio (streamed to disk: videos can be big)."""
            length = int(self.headers.get("Content-Length", 0) or 0)
            if length <= 0 or length > wallpapers.MAX_IMPORT:
                return self._json({"error": "That file is empty or too big (over 4 GB)."}, 413)
            name = Path(unquote(self.headers.get("X-Filename", "wallpaper"))).name
            tmp_dir = Path(paths.DATA_DIR) / "incoming" / uuid.uuid4().hex
            tmp_dir.mkdir(parents=True, exist_ok=True)
            tmp = tmp_dir / (re.sub(r"[^\w.\- ]+", "_", name)[-100:] or "wallpaper")
            try:
                with open(tmp, "wb") as f:
                    left = length
                    while left > 0:
                        chunk = self.rfile.read(min(CHUNK, left))
                        if not chunk:
                            break
                        f.write(chunk)
                        left -= len(chunk)
                return self._json({"item": wallpapers.import_path(tmp, copy=True)})
            except wallpapers.ImportError_ as exc:
                return self._json({"error": str(exc)}, 400)
            except OSError as exc:
                return self._json({"error": f"Couldn't save that file: {exc.strerror}"}, 500)
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        def _post_more(self, route, body):
            """Library, making wallpapers, online content and the lock screen. None if not one of them."""
            req = self._req(body)
            bad = (wallpapers.ImportError_, ValueError)
            if route == "/api/wallpapers/import":
                try:
                    return self._json({"item": wallpapers.import_path(str(req.get("path", "")), copy=req.get("copy", True) is not False)})
                except wallpapers.ImportError_ as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/pick":
                if not app.on_pick:
                    return self._json({"error": "Only works in the Aerie app"}, 400)
                path = app.on_pick(bool(req.get("folder")))
                if not path:
                    return self._json({"cancelled": True})
                try:
                    return self._json({"item": wallpapers.import_path(path, copy=True)})
                except wallpapers.ImportError_ as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/url":
                try:
                    return self._json({"item": wallpapers.import_url(req.get("url", ""), req.get("title", ""))})
                except wallpapers.ImportError_ as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/remove":
                return self._json({"ok": wallpapers.remove(str(req.get("id", "")))})
            if route == "/api/wallpapers/update":
                return self._json({"ok": bool(wallpapers.update(str(req.get("id", "")), req))})
            if route == "/api/wallpapers/unhide":
                wallpapers.unhide_all()
                return self._json({"ok": True})
            if route == "/api/wallpapers/shader":
                try:
                    if req.get("id"):
                        return self._json({"item": wallpapers.update_shader(str(req["id"]), req.get("code", ""))})
                    return self._json({"item": wallpapers.create_shader(str(req.get("title") or "My shader"), req.get("code", ""))})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/parallax":
                try:
                    return self._json({"item": wallpapers.create_parallax(str(req.get("title") or "My 2D scene"), req.get("spec"))})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/stage":
                try:
                    return self._json({"item": wallpapers.create_stage(str(req.get("title") or "My 3D scene"), req.get("spec"))})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/wallpapers/spec":
                try:
                    spec = req.get("spec") if isinstance(req.get("spec"), dict) else {}
                    item = wallpapers.get(str(req.get("id", "")))
                    if item and item["type"] == "stage" and app.online_allowed():
                        clean = wallpapers.clean_stage(spec)
                        if clean["sky"]["hdri"]:
                            polyhaven.fetch("hdris", clean["sky"]["hdri"], clean["sky"]["res"])
                        for m in clean["models"]:
                            polyhaven.fetch("models", m["asset"], m["res"])
                    return self._json({"item": wallpapers.save_spec(str(req.get("id", "")), spec)})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
                except Exception as exc:  # a download failed
                    return self._json({"error": polyhaven.error_message(exc)}, 502)
            if route == "/api/openverse/import":
                if not app.online_allowed():
                    return self._json({"error": "Online content is off. Turn it on in Studio → Discover."}, 403)
                try:
                    return self._json({"item": openverse.import_image(str(req.get("id", "")))})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
                except Exception as exc:
                    return self._json({"error": openverse.error_message(exc)}, 502)
            if route == "/api/polyhaven/sky":
                # a 360° sky on its own is a wallpaper too: a stage with no models
                if not app.online_allowed():
                    return self._json({"error": "Online content is off. Turn it on in Studio → Discover."}, 403)
                try:
                    asset = polyhaven.find("hdris", str(req.get("id", "")))
                    if not asset:
                        return self._json({"error": "Poly Haven doesn't have that sky"}, 404)
                    polyhaven.fetch("hdris", asset["id"], "2k")
                    spec = {"sky": {"hdri": asset["id"], "res": "2k"}, "ground": {"show": False},
                            "camera": {"auto": False, "position": [0, 1.6, 0.01], "target": [0, 1.6, 0], "orbit": 0.02, "fov": 60}}
                    return self._json({"item": wallpapers.create_stage(asset["name"], spec, source="polyhaven", credit={
                        "title": asset["name"], "author": ", ".join(asset["authors"]), "license": "CC0",
                        "source": "Poly Haven", "url": f"https://polyhaven.com/a/{asset['id']}"})})
                except bad as exc:
                    return self._json({"error": str(exc)}, 400)
                except Exception as exc:
                    return self._json({"error": polyhaven.error_message(exc)}, 502)
            if route == "/api/polyhaven/fetch":
                if not app.online_allowed():
                    return self._json({"error": "Online content is off. Turn it on in Studio → Discover."}, 403)
                try:
                    kind = "hdris" if req.get("kind") == "hdris" else "models"
                    return self._json({"url": polyhaven.fetch(kind, str(req.get("id", "")), str(req.get("res", "1k")))})
                except Exception as exc:
                    return self._json({"error": polyhaven.error_message(exc)}, 502)
            if route == "/api/assistant/settings":
                try:
                    return self._json(assistant.update(req))
                except (ValueError, OSError) as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/assistant/create":
                needs_online = req.get("mode") in ("find", "3d") or (req.get("mode") in ("auto", None) and not req.get("revise"))
                if needs_online and not app.online_allowed():
                    return self._json({"error": "Finding art and building 3D scenes needs online content. "
                                                "Turn it on in Studio → Discover."}, 403)
                try:
                    return self._json({"job": creator.start(req.get("prompt", ""), str(req.get("mode") or "auto"),
                                                            req.get("revise") if isinstance(req.get("revise"), dict) else None)})
                except ValueError as exc:
                    return self._json({"error": str(exc)}, 400)
            if route == "/api/lock/enable":
                ok, message = lockscreen.set_enabled(bool(req.get("on")))
                return self._json({"ok": ok, "message": message, "status": lockscreen.status()})
            if route == "/api/lock/remove-switch":
                ok, message = lockscreen.remove_switch()
                return self._json({"ok": ok, "message": message, "status": lockscreen.status()})
            if route == "/api/lock/preview":
                return self._json({"ok": lockscreen.preview()})
            if route == "/api/lock/now":
                return self._json({"ok": lockscreen.lock_now()})
            if route == "/api/cache/clear":
                wallpapers.clear_cache()
                openverse.clear_cache()
                return self._json({"ok": True})
            return None

        def _raw_into(self, item_id, fn):
            """Routes that take a file as the request body (a layer picture, a preview)."""
            try:
                body = self._body()
            except ValueError:
                return self._json({"error": "That file is too big."}, 413)
            try:
                return self._json(fn(item_id, body))
            except wallpapers.ImportError_ as exc:
                return self._json({"error": str(exc)}, 400)

        def do_HEAD(self):
            self.do_GET()

        def do_PUT(self):
            if not self._guard():
                return
            if app.read_only:
                return self._json({"error": "read only"}, 403)
            if urlparse(self.path).path == "/api/config":
                try:
                    data = json.loads(self._body())
                except ValueError:
                    return self._json({"error": "bad json"}, 400)
                app.write_config(data)
                return self._json({"ok": True})
            self._json({"error": "not found"}, 404)

        def do_POST(self):
            if not self._guard():
                return
            key = self.headers.get("Idempotency-Key", "")
            if not _IDEM_KEY.match(key):
                return self._do_post()
            entry, first = app.replies.claim(key)
            if not first:
                # the same request again: wait for the first one, then give its answer
                self._discard_body()
                entry["done"].wait(300)
                status, body = entry["reply"] or (409, b'{"error": "still working on it"}')
                return self._send_json_bytes(status, body)
            self.last_reply = None
            try:
                self._do_post()
            finally:
                entry["reply"] = self.last_reply
                entry["done"].set()
                if not self.last_reply or self.last_reply[0] >= 400:
                    app.replies.forget(key)  # only successes are replayed; a retry after a failure runs again

        def _discard_body(self):
            length = int(self.headers.get("Content-Length") or 0)
            while length > 0:
                chunk = self.rfile.read(min(length, 1 << 20))
                if not chunk:
                    break
                length -= len(chunk)

        def _do_post(self):
            route = urlparse(self.path).path
            if app.read_only and route not in READ_ONLY_POSTS:
                return self._json({"error": "read only"}, 403)
            if route == "/api/wallpapers/upload":
                return self._upload_wallpaper()
            if route == "/api/wallpapers/layer":
                name = Path(unquote(self.headers.get("X-Filename", "layer.png"))).name
                return self._raw_into(self._query().get("id", ""),
                                      lambda i, b: {"file": wallpapers.add_layer(i, name, b)})
            if route == "/api/wallpapers/preview":
                return self._raw_into(self._query().get("id", ""),
                                      lambda i, b: {"item": wallpapers.set_preview(i, b)})
            try:
                body = self._body()
            except ValueError:
                return self._json({"error": "file too large (max 200 MB)"}, 413)
            handled = self._post_more(route, body)
            if handled is not None:
                return handled
            if route == "/api/launch":
                app_id = json.loads(body or b"{}").get("id", "")
                return self._json({"ok": app.catalog.launch(app_id)})
            if route == "/api/apps/refresh":
                app.catalog.refresh()
                return self._json({"apps": app.catalog.list()})
            if route == "/api/media":
                ext = Path(unquote(self.headers.get("X-Filename", ""))).suffix.lower()
                if ext not in MEDIA_TYPES:
                    return self._json({"error": f"unsupported file type {ext or '(none)'}"}, 400)
                name = uuid.uuid4().hex + ext
                (paths.MEDIA_DIR / name).write_bytes(body)
                return self._json({"url": "/media/" + name})
            if route == "/api/autostart":
                enabled = bool(json.loads(body or b"{}").get("enabled"))
                return self._json({"enabled": app.set_autostart(enabled)})
            if route == "/api/install-info":
                return self._json(app.install_info())
            if route == "/api/update":
                return self._json(app.update())
            if route == "/api/restart":
                ok = app.restart()
                if ok and app.on_shell_request:
                    app.on_shell_request("quit", None, None)
                return self._json({"ok": ok})
            if route == "/api/uninstall":
                ok, message = app.uninstall()
                if ok and app.on_shell_request:
                    app.on_shell_request("quit-later", None, None)
                return self._json({"ok": ok, "message": message})
            if route == "/api/now-playing":
                action = json.loads(body or b"{}").get("action", "")
                return self._json({"ok": media_player.control(action)})
            if route == "/api/delete-data":
                app.delete_all_data()
                return self._json({"ok": True})
            if route == "/api/shell":
                if not app.on_shell_request:  # server running on its own, no desktop window
                    return self._json({"ok": False})
                req = json.loads(body or b"{}")
                monitor = req.get("monitor")
                app.on_shell_request(req.get("action", ""), monitor if isinstance(monitor, int) else None,
                                     req.get("extra") if isinstance(req.get("extra"), (str, dict)) else None)
                return self._json({"ok": True})
            self._json({"error": "not found"}, 404)

    return Handler


def main():
    """Run only the server and print the URL (for testing in a normal browser)."""
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args()
    server = AerieServer(args.port)
    print(server.url, flush=True)
    server.httpd.serve_forever()


if __name__ == "__main__":
    main()
