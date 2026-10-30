"""Sleep and shut down from the lock screen, through logind (the same way COSMIC does it)."""

import shutil
import subprocess

COMMANDS = {
    "sleep": ["systemctl", "suspend"],
    "restart": ["systemctl", "reboot"],
    "shutdown": ["systemctl", "poweroff"],
}


def power(action):
    """Starts `action` (sleep, restart or shutdown). Returns False if it couldn't start."""
    cmd = COMMANDS.get(action)
    if not cmd:
        raise ValueError("unknown action")
    if not shutil.which(cmd[0]):
        return False
    try:
        subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        return True
    except OSError:
        return False
