"""Clipboard history for the hub. Off until you turn it on in the hub or in Aerie Studio.

While it's on, `wl-paste --watch` (from wl-clipboard) runs this module each time you copy
something; it saves the text or picture in ~/.local/share/aerie/clipboard on this computer
only. Things password managers mark as secret are never saved. Turning it off stops the
watcher, and "Clear history" deletes everything saved.
"""

import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from contextlib import contextmanager
from pathlib import Path

from . import paths

DIR = paths.DATA_DIR / "clipboard"
HISTORY = DIR / "history.json"
LIMIT = 200
MAX_TEXT = 200_000
MAX_IMAGE = 25 * 1024 * 1024
IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp", "image/gif")
TEXT_TYPES = ("text/plain;charset=utf-8", "UTF8_STRING", "text/plain", "TEXT", "STRING")
SECRET_HINT = "x-kde-passwordManagerHint"
URL = re.compile(r"^https?://\S+$")


def available():
    return shutil.which("wl-paste") is not None and shutil.which("wl-copy") is not None


@contextmanager
def _locked():
    DIR.mkdir(parents=True, exist_ok=True)
    with open(DIR / ".lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lock, fcntl.LOCK_UN)


def _load():
    try:
        data = json.loads(HISTORY.read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def _save(items):
    tmp = HISTORY.with_suffix(".tmp")
    tmp.write_text(json.dumps(items))
    os.chmod(tmp, 0o600)
    tmp.replace(HISTORY)


def items(query="", kind="all"):
    with _locked():
        out = _load()
    q = query.strip().lower()
    if kind in ("text", "image", "link"):
        out = [i for i in out if i["kind"] == kind]
    if q:
        out = [i for i in out if q in (i.get("text") or "").lower()]
    return out


def _paste(mime):
    r = subprocess.run(["wl-paste", "--no-newline", "--type", mime], capture_output=True, timeout=5)
    return r.stdout if r.returncode == 0 else None


def store():
    """Called by `wl-paste --watch` whenever the clipboard changes."""
    state = os.environ.get("CLIPBOARD_STATE", "data")
    if state != "data":  # cleared, empty, or marked sensitive by the app that copied it
        return
    try:
        sys.stdin.buffer.read()  # wl-paste hands us the data; we pick the best type ourselves
    except OSError:
        pass
    try:
        types = subprocess.run(["wl-paste", "--list-types"], capture_output=True, text=True, timeout=5).stdout.split()
    except (OSError, subprocess.SubprocessError):
        return
    if SECRET_HINT in types:
        hint = _paste(SECRET_HINT)
        if hint is None or b"secret" in hint:
            return
    entry = None
    image_type = next((t for t in IMAGE_TYPES if t in types), None)
    text_type = next((t for t in TEXT_TYPES if t in types), None)
    if image_type:
        data = _paste(image_type)
        if data and len(data) <= MAX_IMAGE:
            digest = hashlib.sha1(data).hexdigest()[:16]
            ext = image_type.split("/")[1]
            DIR.mkdir(parents=True, exist_ok=True)
            (DIR / f"{digest}.{ext}").write_bytes(data)
            entry = {"id": digest, "kind": "image", "file": f"{digest}.{ext}", "mime": image_type,
                     "size": len(data), "text": "", **_image_size(data)}
    elif text_type:
        data = _paste(text_type)
        if data:
            text = data.decode("utf-8", "replace")[:MAX_TEXT]
            if text.strip():
                digest = hashlib.sha1(text.encode()).hexdigest()[:16]
                entry = {"id": digest, "kind": "link" if URL.match(text.strip()) else "text", "text": text}
    if not entry:
        return
    entry["time"] = time.time()
    with _locked():
        history = _load()
        old = next((i for i in history if i["id"] == entry["id"]), None)
        if old:
            entry["pinned"] = old.get("pinned", False)
        history = [entry] + [i for i in history if i["id"] != entry["id"]]
        keep, dropped = [], []
        for i in history:
            (keep if i.get("pinned") or len([k for k in keep if not k.get("pinned")]) < LIMIT else dropped).append(i)
        for i in dropped:
            if i.get("file"):
                (DIR / i["file"]).unlink(missing_ok=True)
        _save(keep)


def _image_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return {"w": int.from_bytes(data[16:20], "big"), "h": int.from_bytes(data[20:24], "big")}
    return {}


def file_path(name):
    if not re.match(r"^[a-f0-9]{16}\.(png|jpeg|webp|gif)$", name or ""):
        return None
    p = DIR / name
    return p if p.is_file() else None


def copy(item_id):
    """Puts a saved item back on the clipboard."""
    with _locked():
        item = next((i for i in _load() if i["id"] == item_id), None)
    if not item:
        return False
    try:
        if item["kind"] == "image":
            with open(DIR / item["file"], "rb") as f:
                subprocess.Popen(["wl-copy", "--type", item.get("mime", "image/png")], stdin=f,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        else:
            p = subprocess.Popen(["wl-copy"], stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
            p.stdin.write(item["text"].encode())
            p.stdin.close()
        return True
    except OSError:
        return False


def pin(item_id, on):
    with _locked():
        history = _load()
        for i in history:
            if i["id"] == item_id:
                i["pinned"] = bool(on)
        _save(history)


def delete(item_id):
    with _locked():
        history = _load()
        for i in history:
            if i["id"] == item_id and i.get("file"):
                (DIR / i["file"]).unlink(missing_ok=True)
        _save([i for i in history if i["id"] != item_id])


def clear(keep_pinned=True):
    with _locked():
        history = _load()
        keep = [i for i in history if keep_pinned and i.get("pinned")]
        for i in history:
            if i not in keep and i.get("file"):
                (DIR / i["file"]).unlink(missing_ok=True)
        _save(keep)


class Watcher:
    """Runs `wl-paste --watch` while clipboard history is on."""

    def __init__(self, log=print):
        self.proc = None
        self.log = log

    def set_enabled(self, on):
        if on and not self.running and available():
            app_dir = str(Path(__file__).resolve().parent.parent)
            env = {**os.environ, "PYTHONPATH": app_dir}
            try:
                self.proc = subprocess.Popen(
                    ["wl-paste", "--watch", sys.executable, "-m", "aerie.clipboard", "store"],
                    env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
                self.log("clipboard history on")
            except OSError as exc:
                self.log(f"clipboard history could not start: {exc}")
        elif not on and self.running:
            self.proc.terminate()
            self.proc = None
            self.log("clipboard history off")

    @property
    def running(self):
        return self.proc is not None and self.proc.poll() is None

    def problem(self):
        """Why it isn't working, in words, or ''."""
        if not available():
            return "Clipboard history needs wl-clipboard (sudo apt install wl-clipboard)."
        if self.proc is not None and self.proc.poll() not in (None, 0):
            err = (self.proc.stderr.read() or b"").decode(errors="replace") if self.proc.stderr else ""
            if "data-control" in err or "Watch mode requires" in err:
                return ("Your COSMIC version doesn't share the clipboard with apps yet. Turn on "
                        "\"Let apps see the clipboard\" in Aerie Studio → Hub, then log out and in.")
            return "Clipboard history stopped unexpectedly."
        return ""


if __name__ == "__main__":
    if sys.argv[1:] == ["store"]:
        store()
