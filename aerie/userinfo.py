"""Your name and profile picture, for the lock screen."""

from pathlib import Path


def avatar(user):
    """Your profile picture (as set in COSMIC Settings), if there is one."""
    for p in (Path("/var/lib/AccountsService/icons") / user, Path.home() / ".face"):
        try:
            if p.is_file() and p.stat().st_size > 0:
                return p
        except OSError:
            continue
    return None
