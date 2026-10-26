"""Internet speed test for the hub's Stats tab. Runs only when you press "Run speed test".

It downloads and uploads test data with Cloudflare's public speed-test service
(speed.cloudflare.com), the same one their own speed test web page uses. Cloudflare
sees your IP address, like any web site you visit; Aerie sends nothing else.
"""

import time
import urllib.request

from . import __version__

DOWN = "https://speed.cloudflare.com/__down?bytes={n}"
UP = "https://speed.cloudflare.com/__up"
AGENT = f"Aerie/{__version__} (+https://github.com/Jayswansocool48/aerie)"


def _mbps(nbytes, seconds):
    return round(nbytes * 8 / max(seconds, 1e-6) / 1e6, 1)


def run(progress=None):
    """Returns {'ping': ms, 'down': Mbps, 'up': Mbps}. `progress(stage)` is told what is happening."""
    def tell(stage):
        if progress:
            progress(stage)

    tell("ping")
    pings = []
    for _ in range(4):
        t = time.perf_counter()
        _get(DOWN.format(n=0))
        pings.append((time.perf_counter() - t) * 1000)
    ping = round(sorted(pings)[len(pings) // 2])

    tell("download")
    total, t0 = 0, time.perf_counter()
    for size in (1_000_000, 10_000_000, 25_000_000):
        total += len(_get(DOWN.format(n=size), timeout=30))
        if time.perf_counter() - t0 > 8:
            break
    down = _mbps(total, time.perf_counter() - t0)

    tell("upload")
    sent, t0 = 0, time.perf_counter()
    for size in (1_000_000, 5_000_000, 10_000_000):
        _post(UP, b"0" * size)
        sent += size
        if time.perf_counter() - t0 > 8:
            break
    up = _mbps(sent, time.perf_counter() - t0)
    tell("done")
    return {"ping": ping, "down": down, "up": up, "time": time.time()}


def _get(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()


def _post(url, data, timeout=30):
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"User-Agent": AGENT, "Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read()
