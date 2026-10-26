"""Quick controls for the hub: Wi-Fi, Bluetooth, sound, brightness, dark mode, do not
disturb and power. Uses the same tools COSMIC itself uses (NetworkManager, BlueZ,
PipeWire, logind and COSMIC's settings daemon); nothing leaves the computer.
"""

import os
import re
import shutil
import subprocess
from pathlib import Path

COSMIC_DIR = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config")) / "cosmic"
DND_FILE = COSMIC_DIR / "com.system76.CosmicNotifications" / "v1" / "do_not_disturb"
CSD = ["com.system76.CosmicSettingsDaemon", "/com/system76/CosmicSettingsDaemon", "com.system76.CosmicSettingsDaemon"]


def _run(cmd, timeout=4):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C"})
        return r.returncode == 0, r.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return False, ""


def _has(tool):
    return shutil.which(tool) is not None


# ---- reading ------------------------------------------------------------------------------


def status():
    return {"wifi": wifi(), "bluetooth": bluetooth(), "audio": audio(), "brightness": brightness(),
            "dark": dark_mode(), "dnd": dnd()}


def wifi():
    if not _has("nmcli"):
        return None
    ok, radio = _run(["nmcli", "-t", "radio", "wifi"])
    if not ok:
        return None
    on = radio.strip() == "enabled"
    name = ""
    if on:
        _, out = _run(["nmcli", "-t", "-f", "ACTIVE,SSID", "dev", "wifi"])
        for line in out.splitlines():
            if line.startswith("yes:"):
                name = line[4:].replace("\\:", ":")
                break
    return {"on": on, "name": name}


def bluetooth():
    if not _has("bluetoothctl"):
        return None
    ok, out = _run(["bluetoothctl", "show"])
    if not ok or "Controller" not in out:
        return None
    on = bool(re.search(r"Powered:\s*yes", out))
    device = ""
    if on:
        _, devs = _run(["bluetoothctl", "devices", "Connected"])
        first = devs.splitlines()[0] if devs else ""
        device = first.split(" ", 2)[2] if first.count(" ") >= 2 else ""
    return {"on": on, "name": device}


def audio():
    if not _has("wpctl"):
        return None
    ok, out = _run(["wpctl", "get-volume", "@DEFAULT_AUDIO_SINK@"])
    if not ok:
        return None
    m = re.search(r"Volume:\s*([\d.]+)", out)
    volume = round(float(m.group(1)) * 100) if m else 0
    _, info = _run(["wpctl", "inspect", "@DEFAULT_AUDIO_SINK@"])
    name = ""
    for key in ("node.description", "node.nick"):
        m2 = re.search(rf'{re.escape(key)} = "([^"]*)"', info)
        if m2:
            name = m2.group(1)
            break
    return {"volume": min(150, volume), "muted": "[MUTED]" in out, "name": name}


def brightness():
    if not _has("busctl"):
        return None
    ok, cur = _run(["busctl", "--user", "get-property", *CSD, "DisplayBrightness"])
    ok2, top = _run(["busctl", "--user", "get-property", *CSD, "MaxDisplayBrightness"])
    try:
        value, maximum = int(cur.split()[-1]), int(top.split()[-1])
    except (ValueError, IndexError):
        return None
    if not (ok and ok2) or maximum <= 0:
        return None
    return {"value": round(100 * value / maximum)}


def dark_mode():
    from . import cosmic_look
    try:
        return bool(cosmic_look.read().get("isDark"))
    except Exception:  # COSMIC not installed (testing)
        return None


def dnd():
    try:
        return DND_FILE.read_text().strip() == "true"
    except OSError:
        return False


# ---- changing -----------------------------------------------------------------------------


def set_control(name, value):
    """Changes one control. Returns the new status."""
    if name == "wifi":
        _run(["nmcli", "radio", "wifi", "on" if value else "off"], timeout=8)
    elif name == "bluetooth":
        if value and _has("rfkill"):
            _run(["rfkill", "unblock", "bluetooth"])
        _run(["bluetoothctl", "power", "on" if value else "off"], timeout=8)
    elif name == "volume":
        v = max(0, min(150, int(value)))
        _run(["wpctl", "set-volume", "-l", "1.5", "@DEFAULT_AUDIO_SINK@", f"{v / 100:.2f}"])
    elif name == "mute":
        _run(["wpctl", "set-mute", "@DEFAULT_AUDIO_SINK@", "1" if value else "0"])
    elif name == "brightness":
        info = brightness()
        ok, top = _run(["busctl", "--user", "get-property", *CSD, "MaxDisplayBrightness"])
        if info is not None and ok:
            maximum = int(top.split()[-1])
            raw = max(1, round(maximum * max(1, min(100, int(value))) / 100))
            _run(["busctl", "--user", "set-property", *CSD, "DisplayBrightness", "i", str(raw)])
    elif name == "dark":
        from . import cosmic_look
        cosmic_look.apply({"isDark": bool(value)})
    elif name == "dnd":
        DND_FILE.parent.mkdir(parents=True, exist_ok=True)
        DND_FILE.write_text("true" if value else "false")
    else:
        raise ValueError("unknown control")
    return status()


POWER = {
    "lock": ["loginctl", "lock-session"],
    "sleep": ["systemctl", "suspend"],
    "restart": ["systemctl", "reboot"],
    "shutdown": ["systemctl", "poweroff"],
    "logout": ["cosmic-osd", "log-out"],
}


def power(action):
    cmd = POWER.get(action)
    if not cmd:
        raise ValueError("unknown action")
    if action == "logout" and not _has("cosmic-osd"):
        sid = os.environ.get("XDG_SESSION_ID", "")
        cmd = ["loginctl", "terminate-session", sid] if sid else None
    if not cmd:
        return False
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True
    except OSError:
        return False
