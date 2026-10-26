"""Turning the Aerie lock screen on and off.

On: a flag in ~/.config/aerie says you want it, and (the first time, with your password) a
small system switch lets Aerie take the place of COSMIC's lock screen. COSMIC then starts
Aerie's lock screen in your session. Off: the flag goes and COSMIC's own lock screen comes
back right away; "Remove the system switch" also puts COSMIC's file back as it was.
"""

import os
import signal
import subprocess
from pathlib import Path

from . import package, paths

FLAG = paths.CONFIG_DIR / "lock.enabled"
SWITCH = Path("/usr/bin/cosmic-greeter.real")
HELPER = package.INSTALL_DIR / "bin" / "aerie-system"
STATE = Path(os.environ.get("XDG_RUNTIME_DIR") or f"/tmp/aerie-{os.getuid()}") / "aerie-lock"


def status():
    return {
        "enabled": FLAG.exists(),
        "switch": SWITCH.exists(),
        "cosmic": Path("/usr/bin/cosmic-greeter").exists() or SWITCH.exists(),
        "installed": package.INSTALLED,
        "running": bool(_lockers("aerie")),
        "fellBack": (STATE / "use-cosmic").exists(),
    }


def set_enabled(on):
    """Returns (ok, message)."""
    if on:
        if not package.INSTALLED:
            return False, "Install Aerie first (the lock screen can't run from the source folder)."
        if not status()["cosmic"]:
            return False, "COSMIC's lock screen isn't installed, so there is nothing to replace."
        if not SWITCH.exists():
            ok, out = package.run(["pkexec", str(HELPER), "lockscreen-on"], timeout=300)
            if not ok:
                return False, "The system switch wasn't installed (cancelled?)."
        FLAG.parent.mkdir(parents=True, exist_ok=True)
        FLAG.write_text("Aerie lock screen on. Delete this file (or turn it off in Aerie Studio) to use COSMIC's.\n")
        (STATE / "use-cosmic").unlink(missing_ok=True)
        (STATE / "failures").unlink(missing_ok=True)
        restart_locker()
        return True, "Aerie is your lock screen now. Press Super+Escape to try it."
    FLAG.unlink(missing_ok=True)
    restart_locker()
    return True, "COSMIC's lock screen is back."


def remove_switch():
    FLAG.unlink(missing_ok=True)
    if SWITCH.exists():
        ok, _ = package.run(["pkexec", str(HELPER), "lockscreen-off"], timeout=300)
        if not ok:
            return False, "The system switch is still there (cancelled?)."
    restart_locker()
    return True, "COSMIC's lock screen is back, exactly as it was."


def _lockers(which="any"):
    """Lock screen programs running for you right now: [(pid, kind)]."""
    found = []
    uid = os.getuid()
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit():
            continue
        try:
            if proc.stat().st_uid != uid:
                continue
            args = (proc / "cmdline").read_bytes().split(b"\0")
        except OSError:
            continue
        line = b" ".join(args)
        if b"aerie.lock" in line and b"--daemon" in line or (args and args[0].endswith(b"/aerie-lock") and b"--daemon" in line):
            found.append((int(proc.name), "aerie"))
        elif args and os.path.basename(args[0]) in (b"cosmic-greeter", b"cosmic-greeter.real"):
            found.append((int(proc.name), "cosmic"))
    return [f for f in found if which == "any" or f[1] == which]


def restart_locker():
    """COSMIC restarts its lock screen program when it stops, so stopping the current one
    (only while unlocked) makes the change take effect without logging out."""
    if (STATE / "locked").exists():
        return
    for pid, _ in _lockers():
        try:
            os.kill(pid, signal.SIGTERM)
        except OSError:
            pass


def lock_now():
    try:
        return subprocess.run(["loginctl", "lock-session"], capture_output=True, timeout=10).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def preview():
    """Shows the lock screen in a window to try it, without locking."""
    cmd = [str(package.INSTALL_DIR / "bin" / "aerie-lock")] if package.INSTALLED else \
        ["python3", "-m", "aerie.lock"]
    return package.spawn(cmd + ["--preview"]) if package.INSTALLED else _spawn_dev(cmd + ["--preview"])


def _spawn_dev(cmd):
    try:
        subprocess.Popen(cmd, cwd=str(package.APP_DIR), start_new_session=True,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except OSError:
        return False
