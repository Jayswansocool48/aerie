"""Aerie's lock screen: your live wallpaper, a clock and a password box.

Uses the Wayland session-lock protocol, the same one COSMIC's own lock screen uses: while
locked, COSMIC shows only this screen and sends all keys to it, and if this program ever
crashes the session *stays locked* (it is restarted, and after repeated failures COSMIC's
own lock screen takes over). Your password is checked with PAM like at login.

Modes:
  --daemon    run in the background and lock whenever the session should lock (started by
              COSMIC in place of its lock screen once you turn the Aerie lock screen on)
  --now       lock right away (and quit after unlocking)
  --preview   show the lock screen in a normal window, without locking, to try it out
"""

import ctypes
import json
import os
import pwd
import signal
import sys
import threading
import time
from pathlib import Path

for _lib in ("libgtk4-layer-shell.so.0", "libgtk4-layer-shell.so"):
    try:
        ctypes.CDLL(_lib)
        break
    except OSError:
        continue

import gi  # noqa: E402

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
from gi.repository import Gdk, Gio, GLib, Gtk  # noqa: E402

try:
    gi.require_version("Gtk4SessionLock", "1.0")
    from gi.repository import Gtk4SessionLock as SessionLock  # noqa: E402
except (ValueError, ImportError):
    SessionLock = None

from . import APP_ID, pam, paths, surfaces, wallpapers  # noqa: E402
from .server import AerieServer  # noqa: E402

LOGIND = "org.freedesktop.login1"
LOG_FILE = Path(GLib.get_user_cache_dir()) / "aerie-lock.log"
STATE_DIR = Path(os.environ.get("XDG_RUNTIME_DIR") or f"/tmp/aerie-{os.getuid()}") / "aerie-lock"
LOCKED_MARK = STATE_DIR / "locked"


def log(message):
    try:
        LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
        if LOG_FILE.exists() and LOG_FILE.stat().st_size > 200_000:
            LOG_FILE.unlink()
        with LOG_FILE.open("a") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except OSError:
        pass


class LockApp(Gtk.Application):
    def __init__(self, mode):
        super().__init__(application_id=APP_ID + ".Lock", flags=Gio.ApplicationFlags.NON_UNIQUE)
        self.mode = mode
        self.user = pwd.getpwuid(os.getuid()).pw_name
        self.server = None
        self.instance = None
        self.windows = []
        self.checking = False
        self.failures = 0
        self.bus = None
        self.session_path = None
        self.sleep_fd = -1
        self.exit_code = 0

    def do_activate(self):
        if self.server:
            return
        self.hold()
        STATE_DIR.mkdir(parents=True, exist_ok=True)
        self.server = AerieServer(read_only=True)
        self.server.start()
        surfaces.direct_connection()
        surfaces.transparent_windows()
        if self.mode == "preview":
            self.show_preview()
            return
        if SessionLock is None or not SessionLock.is_supported():
            log("this desktop doesn't support locking by other programs")
            self.exit_code = 3
            self.quit()
            return
        if self.mode == "daemon":
            self.watch_logind()
            if LOCKED_MARK.exists():
                log("was locked when restarted: locking again")
                self.lock()
        else:
            self.lock()

    # ---- logind: when to lock ------------------------------------------------------------------
    def watch_logind(self):
        try:
            self.bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
            self.session_path = self.find_session()
        except GLib.Error as exc:
            log(f"can't reach logind: {exc.message}")
            self.exit_code = 4
            self.quit()
            return
        sub = self.bus.signal_subscribe
        sub(LOGIND, LOGIND + ".Session", "Lock", self.session_path, None, Gio.DBusSignalFlags.NONE,
            lambda *a: self.lock())
        sub(LOGIND, LOGIND + ".Session", "Unlock", self.session_path, None, Gio.DBusSignalFlags.NONE,
            lambda *a: self.unlock("unlocked by the system"))
        sub(LOGIND, LOGIND + ".Manager", "PrepareForSleep", "/org/freedesktop/login1", None,
            Gio.DBusSignalFlags.NONE, self.on_sleep)
        self.take_sleep_delay()
        log(f"watching session {self.session_path}")

    def find_session(self):
        sid = os.environ.get("XDG_SESSION_ID")
        if sid:
            try:
                return self.call("/org/freedesktop/login1", "Manager", "GetSession", GLib.Variant("(s)", (sid,)))[0]
            except GLib.Error:
                pass
        pid = os.getpid()
        for _ in range(8):  # our parent chain leads to the session (cosmic-session)
            try:
                return self.call("/org/freedesktop/login1", "Manager", "GetSessionByPID", GLib.Variant("(u)", (pid,)))[0]
            except GLib.Error:
                pid = _parent(pid)
                if pid <= 1:
                    break
        return self.call("/org/freedesktop/login1", "Manager", "GetSession", GLib.Variant("(s)", ("auto",)))[0]

    def call(self, path, iface, method, args):
        return self.bus.call_sync(LOGIND, path, f"{LOGIND}.{iface}", method, args, None,
                                  Gio.DBusCallFlags.NONE, 5000, None).unpack()

    def take_sleep_delay(self):
        """Asks logind to wait a moment before sleeping, so the screen is locked first."""
        if self.sleep_fd >= 0 or not self.bus:
            return
        try:
            _, fds = self.bus.call_with_unix_fd_list_sync(
                LOGIND, "/org/freedesktop/login1", LOGIND + ".Manager", "Inhibit",
                GLib.Variant("(ssss)", ("sleep", "Aerie", "Aerie locks the screen before sleeping", "delay")),
                None, Gio.DBusCallFlags.NONE, 5000, None, None)
            self.sleep_fd = fds.get(0)
        except GLib.Error as exc:
            log(f"no sleep delay: {exc.message}")

    def release_sleep_delay(self):
        if self.sleep_fd >= 0:
            os.close(self.sleep_fd)
            self.sleep_fd = -1

    def on_sleep(self, _conn, _sender, _path, _iface, _signal, params):
        going = params.unpack()[0]
        if going:
            if self.instance and self.instance.is_locked():
                self.release_sleep_delay()
            else:
                self.lock()  # the delay is released once the screen is locked
        else:
            self.take_sleep_delay()
            for win in self.windows:
                surfaces.run_js(win.page, "window.lockScreen && window.lockScreen.woke()")

    def set_locked_hint(self, on):
        if self.bus and self.session_path:
            try:
                self.call(self.session_path, "Session", "SetLockedHint", GLib.Variant("(b)", (on,)))
            except GLib.Error:
                pass

    # ---- locking ---------------------------------------------------------------------------
    def lock(self):
        if self.instance and self.instance.is_locked():
            return
        if not self.instance:
            self.instance = SessionLock.Instance.new()
            self.instance.connect("monitor", self.on_monitor)
            self.instance.connect("locked", self.on_locked)
            self.instance.connect("failed", self.on_failed)
            self.instance.connect("unlocked", self.on_unlocked)
        self.failures = 0
        log("locking")
        if not self.instance.lock():
            log("lock request refused")

    def on_monitor(self, instance, monitor):
        monitors = Gdk.Display.get_default().get_monitors()
        index = next((i for i in range(monitors.get_n_items()) if monitors.get_item(i) == monitor), 0)
        win = self.make_window(index, primary=index == 0)
        instance.assign_window_to_monitor(win, monitor)

    def on_locked(self, _instance):
        LOCKED_MARK.touch()
        self.set_locked_hint(True)
        self.release_sleep_delay()
        log("locked")

    def on_failed(self, _instance):
        log("couldn't lock: another lock screen is active")
        self.close_windows()
        if self.mode == "now":
            self.exit_code = 3
            self.quit()

    def on_unlocked(self, _instance):
        log("unlocked")
        LOCKED_MARK.unlink(missing_ok=True)
        self.set_locked_hint(False)
        self.close_windows()
        self.take_sleep_delay()
        if self.mode == "now":
            self.quit()

    def unlock(self, why=""):
        if self.instance and self.instance.is_locked():
            log(f"unlocking ({why})")
            self.instance.unlock()

    def close_windows(self):
        for win in self.windows:
            win.destroy()
        self.windows = []

    # ---- the screen itself -------------------------------------------------------------------
    def make_window(self, index, primary=True):
        win = Gtk.Window(application=self)
        win.add_css_class("aerie-surface")
        overlay = Gtk.Overlay()
        win.set_child(overlay)
        base = Gtk.Box()
        overlay.set_child(base)
        url = self.server.url_for("lock.html", monitor=index, extra="&preview=1" if self.mode == "preview" else "")
        page = surfaces.page_view(url, on_message=lambda msg, w=win: self.on_page_message(w, msg), log=log)
        page.set_hexpand(True)
        page.set_vexpand(True)
        overlay.add_overlay(page)
        win.page = page
        win.index = index
        win.wallpaper = None
        self.add_web_wallpaper(win, overlay, base)
        self.windows.append(win)
        return win

    def add_web_wallpaper(self, win, overlay, base):
        """Web wallpapers run in their own sandboxed view under the lock screen."""
        cfg = self.server.read_config() or {}
        choice = (cfg.get("screens") or {}).get(str(win.index)) or cfg.get("wallpaper") or {}
        item = wallpapers.get(choice.get("id")) if choice.get("type") == "library" else None
        if not item or item["type"] not in ("web", "url"):
            return
        url = self.server.web_wallpaper_url(item)
        if not url:
            return
        view = surfaces.wallpaper_view(url, muted=True, log=log)
        view.set_hexpand(True)
        view.set_vexpand(True)
        view.set_can_target(False)
        overlay.set_child(view)
        win.wallpaper = view
        props = ((cfg.get("wallpaperProps") or {}).get(item["id"])) or {}
        view.connect("load-changed", lambda v, e: e == 3 and surfaces.apply_wallpaper_settings(v, props, item))

    def on_page_message(self, win, msg):
        kind = msg.get("type")
        if kind == "unlock":
            password = msg.get("password")
            if not isinstance(password, str) or self.checking:
                return
            self.checking = True
            threading.Thread(target=self.check_password, args=(password,), daemon=True).start()
        elif kind == "power" and msg.get("action") in ("sleep", "shutdown", "restart"):
            from . import controls
            controls.power(msg["action"])
        elif kind == "close-preview" and self.mode == "preview":
            self.quit()

    def check_password(self, password):
        ok, message = pam.authenticate(self.user, password)
        GLib.idle_add(self.password_checked, ok, message)

    def password_checked(self, ok, message):
        self.checking = False
        if ok:
            for win in self.windows:
                surfaces.run_js(win.page, "window.lockScreen && window.lockScreen.success()")
            if self.mode == "preview":
                GLib.timeout_add(500, lambda: self.quit() or False)
            else:
                GLib.timeout_add(350, lambda: self.unlock("password") or False)
        else:
            self.failures += 1
            log("wrong password")
            for win in self.windows:
                surfaces.run_js(win.page, f"window.lockScreen && window.lockScreen.failed({json.dumps(message)})")
        return False

    # ---- trying it out ---------------------------------------------------------------------------
    def show_preview(self):
        win = self.make_window(0)
        win.set_title("Aerie lock screen (preview)")
        win.connect("close-request", lambda *_: self.quit() or False)
        keys = Gtk.EventControllerKey()
        keys.connect("key-pressed", lambda _c, keyval, *_: keyval == Gdk.KEY_Escape and (self.quit() or True))
        win.add_controller(keys)
        win.fullscreen()
        win.present()

    def do_shutdown(self):
        self.release_sleep_delay()
        if self.server:
            self.server.stop()
        Gtk.Application.do_shutdown(self)


def _parent(pid):
    try:
        for line in Path(f"/proc/{pid}/status").read_text().splitlines():
            if line.startswith("PPid:"):
                return int(line.split()[1])
    except (OSError, ValueError):
        pass
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    mode = "daemon" if "--daemon" in argv else "preview" if "--preview" in argv else "now"
    paths.ensure_dirs()
    app = LockApp(mode)
    # Never let Ctrl+C or a stray signal unlock: quitting while locked keeps COSMIC locked.
    GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, signal.SIGTERM, app.quit)
    app.run([sys.argv[0]])
    return app.exit_code


if __name__ == "__main__":
    sys.exit(main())
