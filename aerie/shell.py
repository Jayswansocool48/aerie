"""The Aerie app: the live wallpaper on every screen, and the Aerie Studio window.

- Wallpaper: a full-screen surface per monitor above COSMIC's wallpaper and below your
  windows (wlr-layer-shell; COSMIC offers it only to apps outside a sandbox). Web wallpapers
  run in their own sandboxed view underneath Aerie's page.
- Studio: a normal window for your library, making wallpapers, widgets and every setting.
- Sound: wallpapers that react to music get the sound your speakers play (see audio.py).
Window mode (--window) shows the wallpaper in a normal window, for testing or other desktops.
"""

import ctypes
import json
import os
import signal
import sys
import threading
import time
import traceback
from pathlib import Path

# gtk4-layer-shell has to be loaded before GTK connects to Wayland, so load it first.
for _lib in ("libgtk4-layer-shell.so.0", "libgtk4-layer-shell.so"):
    try:
        ctypes.CDLL(_lib)
        break
    except OSError:
        continue

import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

try:
    gi.require_version("Gtk4LayerShell", "1.0")
    from gi.repository import Gtk4LayerShell as LayerShell  # noqa: E402
except (ValueError, ImportError):
    LayerShell = None

from . import APP_ID, __version__, audio, cosmic_look, desktop_watch, surfaces, wallpapers  # noqa: E402
from .server import AerieServer  # noqa: E402


class AerieApp(Gtk.Application):
    def __init__(self):
        super().__init__(application_id=APP_ID, flags=Gio.ApplicationFlags.HANDLES_COMMAND_LINE)
        self.server = None
        self.windows = []
        self.layered = False
        self.debug = False
        self.watch = None
        self.desktop_state = {}
        self.prefs = {}
        self.rebuild_timer = 0
        self.studio = None
        self.studio_audio = False
        self.sound = None
        self.add_main_option("window", ord("w"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Show the wallpaper in a normal window instead of on the desktop", None)
        self.add_main_option("studio", ord("s"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Open Aerie Studio (also what happens when you open Aerie from the app list)", None)
        self.add_main_option("page", 0, GLib.OptionFlags.NONE, GLib.OptionArg.STRING,
                             "With --studio: the page to open (library, discover, create, widgets, lock, settings)", "PAGE")
        self.add_main_option("background", ord("b"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Start quietly (used when starting at login)", None)
        self.add_main_option("quit", ord("q"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Quit the running Aerie", None)
        self.add_main_option("debug", ord("d"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Enable the web inspector", None)
        self.add_main_option("version", ord("v"), GLib.OptionFlags.NONE, GLib.OptionArg.NONE,
                             "Show version", None)

    # ---- startup ------------------------------------------------------
    def do_command_line(self, command_line):
        try:
            return self.start(command_line)
        except Exception:
            log("startup failed:\n" + traceback.format_exc())
            if not self.server:
                raise
            for win in self.windows:
                win.destroy()
            self.windows = []
            self.layered = False
            self.build_windows()
            self.open_studio()
            log("fell back to a normal window")
            return 0

    def start(self, command_line):
        opts = command_line.get_options_dict().end().unpack()
        if opts.get("version"):
            print(f"aerie {__version__}")
            return 0
        if opts.get("quit"):
            log("quitting (asked from the command line)")
            self.quit()
            return 0
        studio = opts.get("page")
        if self.server:  # already running: this is a second launch asking for something
            self.open_studio(studio or None)
            return 0
        self.debug = bool(opts.get("debug"))
        want_layer = not opts.get("window")
        if want_layer and (LayerShell is None or not LayerShell.is_supported()):
            msg = ("layer-shell not available, using a normal window "
                   "(the desktop must be COSMIC or another Wayland desktop with layer-shell)")
            print("aerie: " + msg, file=sys.stderr)
            log(msg)
            want_layer = False
        self.layered = want_layer
        self.hold()
        self.server = AerieServer()
        self.server.on_shell_request = lambda action, monitor=None, extra=None: GLib.idle_add(
            self.handle_shell_request, action, monitor, extra)
        self.server.on_snapshot = self.snapshot_from_thread
        self.server.on_pick = self.pick_from_thread
        self.sound = audio.AudioMonitor(lambda bars, tex: GLib.idle_add(self.send_sound, bars, tex), log)
        self.server.audio_status = lambda: {"running": self.sound.running, "problem": self.sound.problem}
        self.server.start()
        surfaces.direct_connection()
        surfaces.transparent_windows()
        self.load_prefs()
        cosmic_look.maximized_style(False)  # in case Aerie stopped while a window was maximized
        self.build_windows()
        if self.layered:
            Gdk.Display.get_default().get_monitors().connect("items-changed", self.on_monitors_changed)
            self.watch = desktop_watch.watch(lambda state: GLib.idle_add(self.on_desktop_state, state), log)
        if not opts.get("background"):
            # opened from the app list: show Studio, so you see something happen
            GLib.timeout_add(300, lambda: self.open_studio(studio or None) and False)
        log(f"started {__version__} (layer-shell: {self.layered}, monitors: {len(self.windows)})")
        return 0

    # ---- the wallpaper on each screen ------------------------------------------------------
    def build_windows(self):
        if self.layered:
            monitors = Gdk.Display.get_default().get_monitors()
            for i in range(monitors.get_n_items()):
                self.windows.append(self.make_window(monitors.get_item(i), i))
        else:
            self.windows.append(self.make_window(None, 0))
        self.update_web_wallpapers()

    def make_window(self, monitor, index):
        win = Gtk.ApplicationWindow(application=self, title="Aerie")
        win.add_css_class("aerie-surface")
        overlay = Gtk.Overlay()
        win.set_child(overlay)
        win.base = Gtk.Box()
        overlay.set_child(win.base)
        win.overlay = overlay
        url = self.server.url_for("index.html", monitor=index)
        view = surfaces.page_view(url, debug=self.debug, log=log,
                                  allowed_prefix=f"http://127.0.0.1:{self.server.port}/")
        view.set_hexpand(True)
        view.set_vexpand(True)
        overlay.add_overlay(view)
        view.connect("load-changed", self.on_load_changed, win)
        win.webview = view
        win.wallpaper = None
        win.wallpaper_key = None
        win.item = None
        win.index = index
        win.paused = None
        win.connector = monitor.get_connector() if monitor is not None else None
        if self.layered:
            LayerShell.init_for_window(win)
            LayerShell.set_namespace(win, "aerie")
            LayerShell.set_layer(win, LayerShell.Layer.BOTTOM)
            for edge in (LayerShell.Edge.TOP, LayerShell.Edge.BOTTOM, LayerShell.Edge.LEFT, LayerShell.Edge.RIGHT):
                LayerShell.set_anchor(win, edge, True)
            LayerShell.set_exclusive_zone(win, -1)
            LayerShell.set_keyboard_mode(win, LayerShell.KeyboardMode.ON_DEMAND)
            if monitor is not None:
                LayerShell.set_monitor(win, monitor)
        else:
            win.set_default_size(1280, 800)
        win.present()
        return win

    def update_web_wallpapers(self):
        """Web wallpapers (and web sites) run in their own sandboxed view under Aerie's page."""
        cfg = self.server.read_config() or {}
        for win in self.windows:
            choice = (cfg.get("screens") or {}).get(str(win.index)) or cfg.get("wallpaper") or {}
            item = None
            if choice.get("type") in ("library", "default"):
                item = wallpapers.get(choice.get("id")) if choice.get("id") else None
            win.item = item
            if item and item["type"] not in ("web", "url"):
                item = None
            settings = ((cfg.get("wallpaperProps") or {}).get(item["id"]) or {}) if item else {}
            key = item["id"] if item else None
            if key != win.wallpaper_key:
                if win.wallpaper:
                    win.overlay.set_child(win.base)
                    win.wallpaper = None
                if item:
                    url = self.server.web_wallpaper_url(item)
                    view = surfaces.wallpaper_view(url, muted=not settings.get("sound"), log=log)
                    view.set_hexpand(True)
                    view.set_vexpand(True)
                    win.overlay.set_child(view)
                    win.wallpaper = view
                    view.connect("load-changed", lambda v, e, it=item, w=win: e == WebKit.LoadEvent.FINISHED
                                 and self.send_web_settings(w, it))
                    log(f"web wallpaper on screen {win.index}: {item['title']}")
                win.wallpaper_key = key
            elif win.wallpaper and item:
                win.wallpaper.set_is_muted(not settings.get("sound"))
                self.send_web_settings(win, item)
            # with no widgets on top, let the mouse reach the web wallpaper itself
            has_widgets = any(w.get("visible", True) for w in cfg.get("widgets") or [])
            win.webview.set_can_target(not (win.wallpaper and not has_widgets))
        self.update_sound()

    def send_web_settings(self, win, item):
        cfg = self.server.read_config() or {}
        props = (((cfg.get("wallpaperProps") or {}).get(item["id"]) or {}).get("props")) or {}
        fps = ((cfg.get("general") or {}).get("fps")) or 30
        if win.wallpaper:
            surfaces.apply_wallpaper_settings(win.wallpaper, props, item, fps)

    # ---- sound-reactive wallpapers ------------------------------------------------------------
    def wants_sound(self, win):
        """This screen shows a wallpaper that reacts to sound, and isn't paused."""
        cfg = self.server.read_config() or {}
        if (cfg.get("general") or {}).get("audioReactive", True) is False or win.paused:
            return False
        item = win.item
        if not item or not item.get("audio"):
            return False
        props = ((cfg.get("wallpaperProps") or {}).get(item["id"]) or {})
        return props.get("react", True) is not False

    def update_sound(self):
        """Works out (on changes, not every frame) which screens get sound, and runs the capture only then."""
        if not self.sound:
            return
        cfg = self.server.read_config() or {}
        allowed = (cfg.get("general") or {}).get("audioReactive", True) is not False
        for win in self.windows:
            win.sound = self.wants_sound(win)
        self.sound.set_wanted(any(w.sound for w in self.windows) or bool(self.studio_audio and allowed and self.studio))

    def send_sound(self, bars, tex):
        payload = json.dumps(bars)
        for win in self.windows:
            if not getattr(win, "sound", False):
                continue
            surfaces.run_js(win.webview, f"window.__aerieAudio && window.__aerieAudio({payload}, '{tex}')")
            if win.wallpaper:
                surfaces.run_js(win.wallpaper, f"window.__aerieAudio && window.__aerieAudio({payload})")
        if self.studio and self.studio_audio:
            surfaces.run_js(self.studio.webview, f"window.__aerieAudio && window.__aerieAudio({payload}, '{tex}')")
        return False

    # ---- Aerie Studio ---------------------------------------------------------------------
    def open_studio(self, page=None):
        if self.studio:
            self.studio.present()
            if page:
                surfaces.run_js(self.studio.webview, f"window.studio && window.studio.go({json.dumps(page)})")
            return False
        win = Gtk.ApplicationWindow(application=self, title="Aerie Studio")
        win.set_default_size(1320, 860)
        win.set_icon_name(APP_ID)
        extra = f"&page={page}" if page else ""
        view = surfaces.page_view(self.server.url_for("studio.html", monitor=-1, extra=extra), debug=self.debug, log=log,
                                  allowed_prefix=f"http://127.0.0.1:{self.server.port}/")
        win.set_child(view)
        win.webview = view
        win.connect("close-request", self.on_studio_closed)
        self.studio = win
        win.present()
        return False

    def on_studio_closed(self, win):
        self.studio = None
        self.studio_audio = False
        self.update_sound()
        return False

    # ---- page → shell -------------------------------------------------------------------
    def handle_shell_request(self, action, monitor=None, extra=None):
        mine = [w for w in self.windows if monitor is None or w.index == monitor] or self.windows[:1]
        if action == "quit":
            self.quit()
        elif action == "quit-later":
            GLib.timeout_add(1500, lambda: self.quit() or False)
        elif action == "reload":
            for win in self.windows:
                win.webview.reload()
        elif action == "studio":
            log("opening Studio")
            self.open_studio(extra if isinstance(extra, str) else None)
        elif action == "studio-sound":
            # Studio's preview shows a wallpaper that reacts to sound
            self.studio_audio = extra == "on"
            self.update_sound()
        elif action in ("front", "back") and self.layered:
            # "front": above your windows (app drawer or moving widgets); only the screen that asked
            layer = LayerShell.Layer.TOP if action == "front" else LayerShell.Layer.BOTTOM
            for win in mine:
                LayerShell.set_layer(win, layer)
                if action == "front":
                    win.present()
        elif action == "pause-overridden":
            win = mine[0]
            log(f"pause was wrong on {win.connector}: windows looked like {self.desktop_state.get(win.connector)}")
        elif action == "config-changed":
            # every page shows the new setup; web wallpapers and pausing may have changed
            self.load_prefs()
            for win in self.windows:
                if monitor is None or win.index != monitor:
                    surfaces.run_js(win.webview, "window.aerie && window.aerie.reloadConfig()")
            if self.studio and monitor != -1:
                surfaces.run_js(self.studio.webview, "window.aeriePage && window.aeriePage.configChanged()")
            self.update_web_wallpapers()
            self.apply_pause()
        return False

    # ---- pausing while you use apps ---------------------------------------------------------
    def load_prefs(self):
        cfg = self.server.read_config() if self.server else None
        general = (cfg or {}).get("general") or {}
        self.prefs = {"pauseWhen": general.get("pauseWhen", "maximized")}

    def on_desktop_state(self, state):
        if state != self.desktop_state:
            log("windows: " + ", ".join(f"{name}: " + (" ".join(k for k, v in s.items() if v) or "clear")
                                        for name, s in sorted(state.items())))
        self.desktop_state = state
        self.apply_pause()
        return False

    def apply_pause(self):
        mode = self.prefs.get("pauseWhen", "maximized")
        for win in self.windows:
            s = self.desktop_state.get(win.connector) or {}
            if not s and len(self.windows) == 1 and len(self.desktop_state) == 1:
                s = next(iter(self.desktop_state.values()))
            paused = (mode != "never" and bool(s.get("maximized"))) or (mode == "focused" and bool(s.get("focused")))
            reason = ("a window is full screen" if s.get("fullscreen") else
                      "a window is maximized on this screen" if s.get("maximized") else "you are using an app")
            if paused != win.paused:
                win.paused = paused
                surfaces.run_js(win.webview, f"window.aerie && window.aerie.setPaused({json.dumps(paused)}, {json.dumps(reason)})")
                if win.wallpaper:
                    surfaces.run_js(win.wallpaper, f"window.__aeriePause && window.__aeriePause({json.dumps(paused)})")
        self.update_sound()

    def on_load_changed(self, webview, event, win):
        if event == WebKit.LoadEvent.FINISHED and win.paused:
            win.paused = None
            GLib.timeout_add(300, lambda: self.apply_pause() or False)

    # ---- screens plugged in or removed --------------------------------------------------------
    def on_monitors_changed(self, *_):
        if self.rebuild_timer:
            GLib.source_remove(self.rebuild_timer)
        self.rebuild_timer = GLib.timeout_add(800, self.rebuild_windows)

    def rebuild_windows(self):
        self.rebuild_timer = 0
        log("screens changed; rebuilding")
        old, self.windows = self.windows, []
        self.build_windows()
        for win in old:
            win.destroy()
        self.apply_pause()
        return False

    # ---- file picker for imports (asked by Studio) ----------------------------------------------
    def pick_from_thread(self, folder, timeout=600):
        done = threading.Event()
        result = {}

        def finish(path):
            result["path"] = path
            done.set()

        GLib.idle_add(self.pick, folder, finish)
        done.wait(timeout)
        return result.get("path")

    def pick(self, folder, finish):
        dialog = Gtk.FileDialog()
        dialog.set_title("Choose a wallpaper folder" if folder else "Choose a wallpaper")
        dialog.set_modal(True)
        if not folder:
            filters = Gio.ListStore.new(Gtk.FileFilter)
            f = Gtk.FileFilter()
            f.set_name("Wallpapers (pictures, videos, 3D scenes, shaders, web pages, Wallpaper Engine, Lively, zip)")
            for pattern in ("*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif", "*.avif", "*.apng", "*.svg", "*.mp4", "*.webm",
                            "*.mkv", "*.mov", "*.glb", "*.gltf", "*.glsl", "*.frag", "*.fs", "*.shader", "*.html", "*.zip",
                            "project.json", "LivelyInfo.json", "parallax.json", "stage.json"):
                f.add_pattern(pattern)
            filters.append(f)
            dialog.set_filters(filters)
        parent = self.studio

        def done(d, res):
            try:
                file = d.select_folder_finish(res) if folder else d.open_finish(res)
                finish(file.get_path() if file else None)
            except GLib.Error:
                finish(None)

        if folder:
            dialog.select_folder(parent, None, done)
        else:
            dialog.open(parent, None, done)
        return False

    # ---- snapshots (previews) -----------------------------------------------------------------
    def snapshot_from_thread(self, monitor, widgets, path, timeout=15, width=0):
        done = threading.Event()
        result = {}

        def finish(error=None):
            result["error"] = error
            done.set()

        GLib.idle_add(self.snapshot, monitor, widgets, path, finish, width)
        if not done.wait(timeout):
            raise RuntimeError("taking the picture took too long")
        if result.get("error"):
            raise RuntimeError(result["error"])
        return path

    def snapshot(self, monitor, widgets, path, finish, width=0):
        win = next((w for w in self.windows if w.index == monitor), None) or self.windows[0]
        hide = "snapshot" + ("" if widgets else " snapshot-no-widgets")
        surfaces.run_js(win.webview, f"document.documentElement.classList.add(...{json.dumps(hide.split())})")

        def restore():
            surfaces.run_js(win.webview, "document.documentElement.classList.remove('snapshot', 'snapshot-no-widgets')")

        def done(widget, res):
            try:
                texture = widget.get_snapshot_finish(res)
                texture.save_to_png(str(path))
                if width:
                    shrink(path, width)
                finish()
            except (GLib.Error, AttributeError) as exc:
                finish(f"could not take the picture: {exc}")
            restore()

        GLib.timeout_add(450, lambda: win.webview.get_snapshot(WebKit.SnapshotRegion.VISIBLE,
                                                               WebKit.SnapshotOptions.NONE, None, done) or False)
        return False

    def do_shutdown(self):
        if self.watch:
            self.watch.stop()
        if self.sound:
            self.sound.set_wanted(False)
        try:
            cosmic_look.maximized_style(False)  # never leave your taskbar in its temporary look
        except OSError:
            pass
        if self.server:
            self.server.stop()
        Gtk.Application.do_shutdown(self)


def shrink(path, width):
    """Scales a saved PNG down to `width` pixels wide (for preview pictures)."""
    try:
        gi.require_version("GdkPixbuf", "2.0")
        from gi.repository import GdkPixbuf
        pix = GdkPixbuf.Pixbuf.new_from_file_at_scale(str(path), width, -1, True)
        pix.savev(str(path), "png", [], [])
    except (ValueError, ImportError, GLib.Error) as exc:
        log(f"could not shrink {path}: {exc}")


LOG_FILE = Path(GLib.get_user_cache_dir()) / "aerie.log"


def log(message):
    """Keeps a short log so problems can be found later (aerie --log shows it)."""
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        with LOG_FILE.open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except OSError:
        pass


def _log_crash(kind, value, tb):
    log("crash:\n" + "".join(traceback.format_exception(kind, value, tb)))
    sys.__excepthook__(kind, value, tb)


def main():
    if "--log" in sys.argv:
        print(LOG_FILE.read_text() if LOG_FILE.exists() else "No log yet.")
        return 0
    if LOG_FILE.exists() and LOG_FILE.stat().st_size > 200_000:
        LOG_FILE.unlink()
    sys.excepthook = _log_crash
    app = AerieApp()
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGINT, app.quit)
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, app.quit)
    return app.run(sys.argv)
