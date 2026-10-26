"""Keyboard shortcuts for the hub, added to COSMIC's own custom shortcuts (the same list you
see in COSMIC Settings → Keyboard → Custom shortcuts), so they work everywhere.

  Super+D          open or close the hub
  Super+Shift+W    open the hub on the Wallpaper tab

Aerie only adds or removes its own lines; your other custom shortcuts are left alone.
"""

import os
import re
from pathlib import Path

from . import package

FILE = (Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
        / "cosmic" / "com.system76.CosmicSettings.Shortcuts" / "v1" / "custom")
MARK = "aerie"


def _command(args):
    return f"{package.launch_command()} {args}"


def entries():
    return [
        ('(modifiers: [Super], key: "d")', _command("--hub")),
        ('(modifiers: [Super, Shift], key: "w")', _command("--hub --tab=wallpaper")),
    ]


def _read():
    try:
        return FILE.read_text()
    except OSError:
        return ""


def _split_entries(text):
    """The `key: action` entries of COSMIC's RON map, however they are laid out."""
    text = text.strip()
    if not (text.startswith("{") and text.endswith("}")):
        return []
    body = text[1:-1]
    entries, depth, current, in_str, escaped = [], 0, [], False, False
    for ch in body:
        current.append(ch)
        if in_str:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            current.pop()
            entries.append("".join(current).strip())
            current = []
    tail = "".join(current).strip()
    if tail:
        entries.append(tail)
    return [e for e in entries if e]


def _ours(entry):
    return "--hub" in entry and "aerie" in entry


def installed():
    return any(_ours(e) for e in _split_entries(_read()))


def set_installed(on):
    current = _read()
    entries_now = _split_entries(current)
    if current.strip() and not entries_now and current.strip() not in ("{}", "{\n}"):
        raise ValueError("COSMIC's custom shortcuts file looks unusual, so Aerie left it alone")
    keep = [e for e in entries_now if not _ours(e)]
    if on:
        keep += [f'{keys}: Spawn("{cmd}")' for keys, cmd in entries()]
    new = "{\n" + "".join(f"    {e},\n" for e in keep) + "}\n"
    FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_name(".custom.aerie-tmp")
    tmp.write_text(new)
    tmp.replace(FILE)
    return installed()
