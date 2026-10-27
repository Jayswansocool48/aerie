"""Changes COSMIC's own look and its real taskbar: frosted glass, window corners and gaps,
dark/light mode, and the top panel and dock themselves: where they sit, how they look,
which applets they hold (clock, tray, app list…), which apps are pinned, and whether the
dock is there at all.

COSMIC keeps each setting as a small file under ~/.config/cosmic/<id>/v<version>/<key>
holding a RON value (system defaults live in /usr/share/cosmic), and its compositor and
panel pick up changes right away. Before Aerie changes anything the first time, it
saves your current settings so "Restore my COSMIC look" (and uninstalling Aerie)
puts everything back.
"""

import json
import os
import re
from pathlib import Path

from . import paths

COSMIC_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "cosmic"
SYSTEM_DIRS = [Path(d) / "cosmic" for d in
               os.environ.get("XDG_DATA_DIRS", "/usr/local/share:/usr/share").split(":") if d]
BACKUP_FILE = paths.DATA_DIR / "cosmic-backup.json"

THEMES = ["com.system76.CosmicTheme.Dark/v2", "com.system76.CosmicTheme.Light/v2",
          "com.system76.CosmicTheme.Dark.Builder/v2", "com.system76.CosmicTheme.Light.Builder/v2"]
MODE = "com.system76.CosmicTheme.Mode/v1"
CONTAINER = "com.system76.CosmicPanel/v1"
APP_LIST = "com.system76.CosmicAppList/v1"
CLOCK = "com.system76.CosmicAppletTime/v1"  # the panel clock; the lock screen uses its 12/24-hour choice
BARS = {"panel": ("Panel", "com.system76.CosmicPanel.Panel/v1"),
        "dock": ("Dock", "com.system76.CosmicPanel.Dock/v1")}

BLUR_LEVELS = ["ExtremelyLow", "ExtremelyLow2", "VeryLow", "VeryLow2", "Low", "Low2", "Medium",
               "Medium2", "High", "High2", "VeryHigh", "VeryHigh2", "ExtremelyHigh", "ExtremelyHigh2"]
CORNERS = {  # the same three styles COSMIC Settings offers
    "Round": [0, 4, 8, 16, 32, 160],
    "SlightlyRound": [0, 2, 8, 8, 8, 8],
    "Square": [0, 2, 2, 2, 2, 2],
}
FROSTED = {"frostedWindows": "frosted_windows", "frostedPanel": "frosted_panel",
           "frostedApplets": "frosted_applets", "frostedSystem": "frosted_system_interface",
           "frostedMaximized": "frosted_maximized_apps"}
ANCHORS = ["Top", "Bottom", "Left", "Right"]
SIZES = ["XS", "S", "M", "L", "XL"]
AUTOHIDE = ["Never", "OnOverlap", "Always"]
BACKGROUNDS = ["ThemeDefault", "Dark", "Light"]

# Applets that come with COSMIC, with plain names. Others are found from their desktop files.
APPLETS = {
    "com.system76.CosmicPanelLauncherButton": "Launcher",
    "com.system76.CosmicPanelAppButton": "Applications",
    "com.system76.CosmicPanelWorkspacesButton": "Workspaces overview",
    "com.system76.CosmicAppletWorkspaces": "Workspace numbers",
    "com.system76.CosmicAppList": "Pinned and open apps",
    "com.system76.CosmicAppletMinimize": "Minimized windows",
    "com.system76.CosmicAppletTime": "Date and time",
    "com.system76.CosmicAppletStatusArea": "System tray",
    "com.system76.CosmicAppletAudio": "Sound",
    "com.system76.CosmicAppletNetwork": "Network",
    "com.system76.CosmicAppletBluetooth": "Bluetooth",
    "com.system76.CosmicAppletBattery": "Battery",
    "com.system76.CosmicAppletNotifications": "Notifications",
    "com.system76.CosmicAppletPower": "Power",
    "com.system76.CosmicAppletTiling": "Tiling",
    "com.system76.CosmicAppletInputSources": "Keyboard layout",
    "com.system76.CosmicAppletA11y": "Accessibility",
}

# COSMIC's own defaults (cosmic-panel-config), used when a setting was never written.
DEFAULT_BARS = {
    "panel": {"enabled": True, "anchor": "Top", "size": "XS", "opacity": 1.0, "autohide": "Never",
              "floating": False, "stretch": True, "radius": 0, "margin": 0, "padding": 0, "spacing": 0,
              "background": "ThemeDefault",
              "left": ["com.system76.CosmicPanelWorkspacesButton", "com.system76.CosmicPanelAppButton"],
              "center": ["com.system76.CosmicAppletTime"],
              "right": ["com.system76.CosmicAppletInputSources", "com.system76.CosmicAppletA11y",
                        "com.system76.CosmicAppletStatusArea", "com.system76.CosmicAppletTiling",
                        "com.system76.CosmicAppletAudio", "com.system76.CosmicAppletBluetooth",
                        "com.system76.CosmicAppletNetwork", "com.system76.CosmicAppletBattery",
                        "com.system76.CosmicAppletNotifications", "com.system76.CosmicAppletPower"]},
    "dock": {"enabled": True, "anchor": "Bottom", "size": "L", "opacity": 1.0, "autohide": "Never",
             "floating": False, "stretch": False, "radius": 12, "margin": 0, "padding": 4, "spacing": 0,
             "background": "ThemeDefault", "left": [], "right": [],
             "center": ["com.system76.CosmicPanelLauncherButton", "com.system76.CosmicPanelWorkspacesButton",
                        "com.system76.CosmicPanelAppButton", "com.system76.CosmicAppList",
                        "com.system76.CosmicAppletMinimize"]},
}
DEFAULTS = {
    "isDark": True, "blur": 6, "corners": "Round", "gapOuter": 0, "gapInner": 8, "activeHint": 3,
    **{k: False for k in FROSTED},
    **DEFAULT_BARS,
    "pinned": [],
}
_ID = re.compile(r"^[A-Za-z0-9_.\-]{1,200}$")


def available():
    return COSMIC_DIR.is_dir()


# ---- reading ------------------------------------------------------------
def _user_raw(rel):
    held = _held()
    if rel in held:  # temporarily "normal" while a window is maximized: report your real setting
        return held[rel]
    try:
        return (COSMIC_DIR / rel).read_text().strip()
    except OSError:
        return None


def _raw(rel):
    """Your setting if you have one, otherwise the system default."""
    text = _user_raw(rel)
    if text is not None:
        return text
    for base in SYSTEM_DIRS:
        try:
            return (base / rel).read_text().strip()
        except OSError:
            continue
    return None


def _value(text, default):
    if text is None:
        return default
    if text in ("true", "false"):
        return text == "true"
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    if re.fullmatch(r"-?\d*\.\d+(e-?\d+)?", text):
        return float(text)
    return text.strip('"')


def _lists(text):
    """All string lists in a RON value: `Some((["a"], ["b"]))` -> [["a"], ["b"]]."""
    if not text or text.strip() == "None":
        return None
    return [re.findall(r'"([^"]*)"', body) for body in re.findall(r"\[([^\]]*)\]", text, re.S)]


def _background(text):
    if not text:
        return "ThemeDefault"
    if text in BACKGROUNDS:
        return text
    nums = re.findall(r"-?\d*\.?\d+", text)
    if text.startswith("Color") and len(nums) >= 3:
        return "#" + "".join(f"{_clamp(round(float(n) * 255), 0, 255):02x}" for n in nums[:3])
    return "ThemeDefault"


def entries():
    found = _lists(_raw(f"{CONTAINER}/entries"))
    return found[0] if found else ["Panel", "Dock"]


def applets():
    """Every panel applet installed: [{id, name}], COSMIC's own first."""
    found = dict(APPLETS)
    dirs = [Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))] + [b.parent for b in SYSTEM_DIRS]
    for base in dirs:
        apps = base / "applications"
        if not apps.is_dir():
            continue
        for f in apps.glob("*.desktop"):
            try:
                text = f.read_text(errors="replace")
            except OSError:
                continue
            if not re.search(r"^X-CosmicApplet\s*=\s*true", text, re.M):
                continue
            app_id = f.name[: -len(".desktop")]
            if app_id not in found:
                m = re.search(r"^Name\s*=\s*(.+)$", text, re.M)
                found[app_id] = m.group(1).strip() if m else app_id
    return [{"id": k, "name": v} for k, v in found.items()]


def read():
    """Your current COSMIC look, as simple values for the editor."""
    out = json.loads(json.dumps(DEFAULTS))
    if not available():
        return {"available": False, **out, "applets": applets()}
    theme = THEMES[0]
    out["isDark"] = _value(_raw(f"{MODE}/is_dark"), True)
    for key, field in FROSTED.items():
        out[key] = _value(_raw(f"{theme}/{field}"), False)
    blur = _raw(f"{theme}/frosted")
    out["blur"] = BLUR_LEVELS.index(blur) if blur in BLUR_LEVELS else DEFAULTS["blur"]
    gaps = re.findall(r"\d+", _raw(f"{theme}/gaps") or "")
    if len(gaps) == 2:
        out["gapOuter"], out["gapInner"] = int(gaps[0]), int(gaps[1])
    out["activeHint"] = _value(_raw(f"{theme}/active_hint"), 3)
    radii = _raw(f"{theme}/corner_radii") or ""
    m = re.search(r"radius_m:\s*\(\s*([\d.]+)", radii)
    if m:
        r = float(m.group(1))
        out["corners"] = "Round" if r >= 15 else "SlightlyRound" if r >= 7 else "Square"
    names = entries()
    for bar, (name, rel) in BARS.items():
        b = out[bar]
        b["enabled"] = name in names
        b["anchor"] = _value(_raw(f"{rel}/anchor"), b["anchor"])
        size = _raw(f"{rel}/size")
        b["size"] = size if size in SIZES else b["size"]
        b["opacity"] = _value(_raw(f"{rel}/opacity"), b["opacity"])
        b["autohide"] = _value(_raw(f"{rel}/autohide"), b["autohide"])
        if b["autohide"] not in AUTOHIDE:  # older COSMIC stores a struct here
            b["autohide"] = "Never" if b["autohide"] in (None, "None") else "Always"
        b["floating"] = _value(_raw(f"{rel}/anchor_gap"), b["floating"])
        b["stretch"] = _value(_raw(f"{rel}/expand_to_edges"), b["stretch"])
        for key, field in (("radius", "border_radius"), ("margin", "margin"),
                           ("padding", "padding"), ("spacing", "spacing")):
            b[key] = _value(_raw(f"{rel}/{field}"), b[key])
        b["background"] = _background(_raw(f"{rel}/background"))
        # COSMIC's own setting: drop the floating/see-through style while a window is maximized
        b["normalOnMaximize"] = not _value(_raw(f"{rel}/keep_style_on_maximize"), False)
        wings = _raw(f"{rel}/plugins_wings")
        if wings is not None:
            lists = _lists(wings) or [[], []]
            b["left"], b["right"] = (lists + [[], []])[:2]
        center = _raw(f"{rel}/plugins_center")
        if center is not None:
            b["center"] = (_lists(center) or [[]])[0]
    out["clock24"] = _value(_raw(f"{CLOCK}/military_time"), False)
    fav = _lists(_raw(f"{APP_LIST}/favorites"))
    out["pinned"] = fav[0] if fav else []
    return {"available": True, "backedUp": BACKUP_FILE.exists(), **out, "applets": applets()}


# ---- writing ------------------------------------------------------------
def _ron_list(items):
    if not isinstance(items, (list, tuple)):
        raise ValueError("expected a list of names")
    return "[" + ", ".join(json.dumps(i) for i in items if _ID.match(str(i))) + "]"


def _ron_background(value):
    if value in BACKGROUNDS:
        return value
    m = re.fullmatch(r"#?([0-9a-fA-F]{6})", str(value or ""))
    if not m:
        return "ThemeDefault"
    h = m.group(1)
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return f"Color(({r:.3f}, {g:.3f}, {b:.3f}))"


def _files_for(changes):
    """Turns editor values into {relative file: RON text}."""
    files = {}
    if "isDark" in changes:
        files[f"{MODE}/is_dark"] = _bool(changes["isDark"])
    for key, field in FROSTED.items():
        if key in changes:
            for theme in THEMES:
                files[f"{theme}/{field}"] = _bool(changes[key])
    if "blur" in changes:
        level = BLUR_LEVELS[max(0, min(len(BLUR_LEVELS) - 1, int(changes["blur"])))]
        for theme in THEMES:
            files[f"{theme}/frosted"] = level
    if "corners" in changes and changes["corners"] in CORNERS:
        names = ["radius_0", "radius_xs", "radius_s", "radius_m", "radius_l", "radius_xl"]
        body = ",\n".join(f"    {n}: ({', '.join([f'{float(v):.1f}'] * 4)})"
                          for n, v in zip(names, CORNERS[changes["corners"]]))
        for theme in THEMES:
            files[f"{theme}/corner_radii"] = "(\n" + body + ",\n)"
    if "gapOuter" in changes or "gapInner" in changes:
        cur = read()
        outer = int(changes.get("gapOuter", cur["gapOuter"]))
        inner = int(changes.get("gapInner", cur["gapInner"]))
        for theme in THEMES:
            files[f"{theme}/gaps"] = f"({_clamp(outer, 0, 64)}, {_clamp(inner, 0, 64)})"
    if "activeHint" in changes:
        for theme in THEMES:
            files[f"{theme}/active_hint"] = str(_clamp(int(changes["activeHint"]), 0, 16))

    current = None
    names = entries()
    for bar, (name, rel) in BARS.items():
        b = changes.get(bar) or {}
        if not isinstance(b, dict) or not b:
            continue
        if "enabled" in b:
            if b["enabled"] and name not in names:
                names = names + [name] if bar == "dock" else [name] + names
                if _raw(f"{rel}/anchor") is None:  # never set up on this computer: give it COSMIC's defaults
                    files.update(_bar_files(rel, name, DEFAULT_BARS[bar]))
            elif not b["enabled"] and name in names:
                names = [n for n in names if n != name]
            files[f"{CONTAINER}/entries"] = _ron_list(names)
        files.update(_bar_files(rel, None, b))
        if any(k in b for k in ("left", "right")):
            current = current or read()
            left = b.get("left", current[bar]["left"])
            right = b.get("right", current[bar]["right"])
            files[f"{rel}/plugins_wings"] = (f"Some(({_ron_list(left)}, {_ron_list(right)}))"
                                             if left or right else "None")
    if "clock24" in changes:
        files[f"{CLOCK}/military_time"] = _bool(changes["clock24"])
    if isinstance(changes.get("pinned"), list):
        files[f"{APP_LIST}/favorites"] = _ron_list(changes["pinned"])
    return files


def _bar_files(rel, name, b):
    files = {}
    if name:
        files[f"{rel}/name"] = json.dumps(name)
        files[f"{rel}/output"] = "All"
        files[f"{rel}/layer"] = "Top"
        files[f"{rel}/keyboard_interactivity"] = "OnDemand"
        files[f"{rel}/exclusive_zone"] = _bool(name == "Panel")
        if "right" not in b and "left" not in b:
            files[f"{rel}/plugins_wings"] = "None"
        if b.get("left") or b.get("right"):
            files[f"{rel}/plugins_wings"] = f"Some(({_ron_list(b.get('left', []))}, {_ron_list(b.get('right', []))}))"
    if b.get("anchor") in ANCHORS:
        files[f"{rel}/anchor"] = b["anchor"]
    if b.get("size") in SIZES:
        files[f"{rel}/size"] = b["size"]
    if "opacity" in b:
        files[f"{rel}/opacity"] = f"{max(0.0, min(1.0, float(b['opacity']))):.2f}"
    if b.get("autohide") in AUTOHIDE and not name:
        files[f"{rel}/autohide"] = b["autohide"]
    if "floating" in b:
        files[f"{rel}/anchor_gap"] = _bool(b["floating"])
    if "stretch" in b:
        files[f"{rel}/expand_to_edges"] = _bool(b["stretch"])
    for key, field, hi in (("radius", "border_radius", 64), ("margin", "margin", 64),
                           ("padding", "padding", 32), ("spacing", "spacing", 32)):
        if key in b:
            files[f"{rel}/{field}"] = str(_clamp(int(b[key]), 0, hi))
    if "background" in b:
        files[f"{rel}/background"] = _ron_background(b["background"])
    if "normalOnMaximize" in b:
        files[f"{rel}/keep_style_on_maximize"] = _bool(not b["normalOnMaximize"])
    if "center" in b:
        files[f"{rel}/plugins_center"] = f"Some({_ron_list(b['center'])})" if b["center"] else "None"
    return files


def apply(changes):
    """Writes the changes into COSMIC's settings. Returns the new look."""
    if not available():
        raise RuntimeError("COSMIC settings were not found on this computer")
    if not isinstance(changes, dict):
        raise ValueError("expected an object of changes")
    files = _files_for(changes)
    holding = bool(_held())
    if holding:
        maximized_style(False)  # write over your real settings, not the temporary ones
    _backup(files)
    for rel, text in files.items():
        _write(rel, text)
    if holding:
        maximized_style(True)
    return read()


def _write(rel, text):
    path = COSMIC_DIR / rel
    if text is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".aerie-tmp")
    tmp.write_text(text)
    tmp.replace(path)


# ---- a normal-looking taskbar while a window is maximized --------------------------
HOLD_FILE = paths.DATA_DIR / "cosmic-maximized.json"
NORMAL = {"opacity": "1.0", "anchor_gap": "false", "expand_to_edges": "true", "margin": "0",
          "border_radius": "0", "background": "ThemeDefault"}
_hold_cache = (None, {})


def _held():
    """Your real panel and dock settings while Aerie has them looking normal ({} otherwise)."""
    global _hold_cache
    try:
        stamp = HOLD_FILE.stat().st_mtime_ns
    except OSError:
        return {}
    if _hold_cache[0] != stamp:
        try:
            _hold_cache = (stamp, json.loads(HOLD_FILE.read_text()))
        except (OSError, ValueError):
            _hold_cache = (stamp, {})
    return _hold_cache[1]


def _is_normal(rel, field, want):
    cur = _raw(rel + "/" + field)
    if field == "background":
        return _background(cur) == "ThemeDefault"
    if cur is None:
        return False
    return _value(cur, None) == _value(want, None)


def maximized_style(on):
    """on=True: make the panel and dock look like COSMIC's plain default (solid, attached,
    square, theme color) so a maximized window looks right. on=False: put your style back.
    Returns True if anything changed."""
    if not available():
        return False
    held = _held()
    if on:
        if held:
            return False
        saved = {}
        for _, rel in BARS.values():
            if _raw(rel + "/anchor") is None:
                continue  # this bar doesn't exist here
            for field, want in NORMAL.items():
                if not _is_normal(rel, field, want):
                    saved[f"{rel}/{field}"] = _user_raw(f"{rel}/{field}")
        if not saved:
            return False
        HOLD_FILE.parent.mkdir(parents=True, exist_ok=True)
        HOLD_FILE.write_text(json.dumps(saved, indent=1))  # first, so a crash can still undo it
        for rel in saved:
            _write(rel, NORMAL[rel.rsplit("/", 1)[1]])
        return True
    if not held:
        HOLD_FILE.unlink(missing_ok=True)
        return False
    HOLD_FILE.unlink(missing_ok=True)
    for rel, text in held.items():
        _write(rel, text)
    return True


def _backup(files):
    """Remembers the original contents of every file before Aerie first changes it."""
    saved = {}
    if BACKUP_FILE.exists():
        try:
            saved = json.loads(BACKUP_FILE.read_text())
        except ValueError:
            saved = {}
    added = False
    for rel in files:
        if rel not in saved:
            saved[rel] = _user_raw(rel)  # None = it was COSMIC's default; restore deletes our file
            added = True
    if added:
        BACKUP_FILE.parent.mkdir(parents=True, exist_ok=True)
        BACKUP_FILE.write_text(json.dumps(saved, indent=1))


def restore():
    """Puts back the COSMIC look you had before Aerie changed it."""
    maximized_style(False)
    from . import account
    pictured = account.restore_avatar()
    if not BACKUP_FILE.exists():
        return pictured
    try:
        saved = json.loads(BACKUP_FILE.read_text())
    except ValueError:
        return False
    # the list of bars last, so a dock that comes back already has its settings
    for rel in sorted(saved, key=lambda r: r.endswith("/entries")):
        text = saved[rel]
        path = COSMIC_DIR / rel
        if text is None:
            path.unlink(missing_ok=True)
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
    BACKUP_FILE.unlink(missing_ok=True)
    return True


def _bool(v):
    return "true" if v else "false"


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


# ---- wallpaper and lock screen ----------------------------------------------------
# COSMIC's lock screen (and login screen) show the wallpaper cosmic-bg is showing,
# so setting the wallpaper is how the lock screen picture is changed.
BACKGROUND = "com.system76.CosmicBackground/v1"


def clock_24h():
    """Whether COSMIC's clock shows 24-hour time."""
    return bool(_value(_raw(f"{CLOCK}/military_time"), False))


def wallpaper():
    m = re.search(r'source:\s*Path\("((?:[^"\\]|\\.)*)"\)', _raw(f"{BACKGROUND}/all") or "")
    return json.loads(f'"{m.group(1)}"') if m else None


def set_wallpaper(image):
    """Shows `image` as COSMIC's wallpaper on every screen, and so on the lock screen."""
    if not available():
        raise RuntimeError("COSMIC settings were not found on this computer")
    entry = ("(\n    output: \"all\",\n    source: Path(" + json.dumps(str(image)) + "),\n"
             "    filter_by_theme: false,\n    rotation_frequency: 3600,\n    filter_method: Lanczos,\n"
             "    scaling_mode: Zoom,\n    sampling_method: Alphanumeric,\n)")
    files = {f"{BACKGROUND}/all": entry, f"{BACKGROUND}/same-on-all": "true"}
    _backup(files)
    for rel, text in files.items():
        _write(rel, text)
    return wallpaper()
