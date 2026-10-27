"""Tests idempotency keys (a repeated request gets the first answer, a failed one runs again)
and the BlurHash placeholders the library keeps for wallpaper previews."""

import json
import os
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

TMP = tempfile.mkdtemp(prefix="aerie-test-")
os.environ["XDG_DATA_HOME"] = TMP + "/data"
os.environ["XDG_CONFIG_HOME"] = TMP + "/config"
os.environ["XDG_CACHE_HOME"] = TMP + "/cache"
os.environ["HOME"] = TMP
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from aerie import wallpapers  # noqa: E402
from aerie.server import AerieServer, Replies  # noqa: E402


def test_replies():
    r = Replies()
    entry, first = r.claim("abcdefgh-1")
    assert first
    again, first2 = r.claim("abcdefgh-1")
    assert again is entry and not first2
    r.forget("abcdefgh-1")
    _, first3 = r.claim("abcdefgh-1")
    assert first3


def post(server, path, body, key=None):
    headers = {"X-Aerie-Token": server.token, "Content-Type": "application/json"}
    if key:
        headers["Idempotency-Key"] = key
    req = urllib.request.Request(f"http://127.0.0.1:{server.port}{path}", json.dumps(body).encode(), headers, method="POST")
    try:
        with urllib.request.urlopen(req) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def test_same_key_imports_once():
    src = Path(TMP) / "web.png"
    src.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    server = AerieServer()
    server.start()
    try:
        key = "0123456789abcdef-import"
        results = []
        threads = [threading.Thread(target=lambda: results.append(post(server, "/api/wallpapers/import", {"path": str(src)}, key))) for _ in range(3)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        ids = {r[1]["item"]["id"] for r in results}
        assert len(ids) == 1, results  # three clicks, one wallpaper
        mine = [it for it in wallpapers.list_items(include_steam=False) if it["source"] != "default"]
        assert len(mine) == 1
        # a failure isn't remembered: the same key runs again
        status, _ = post(server, "/api/wallpapers/import", {"path": "/nope"}, "0123456789abcdef-fail")
        assert status >= 400
        src2 = Path(TMP) / "two.png"
        src2.write_bytes(b"\x89PNG\r\n\x1a\nfake2")
        status, body = post(server, "/api/wallpapers/import", {"path": str(src2)}, "0123456789abcdef-fail")
        assert status == 200 and body["item"]["title"], body
        # a bad key is ignored (the request just runs)
        status, _ = post(server, "/api/wallpapers/import", {"path": str(src2)}, "x")
        assert status == 200
    finally:
        server.stop() if hasattr(server, "stop") else server.httpd.shutdown()


def test_blurhash():
    src = Path(TMP) / "blur.png"
    src.write_bytes(b"\x89PNG\r\n\x1a\nfake3")
    it = wallpapers.import_path(src)
    assert wallpapers.update(it["id"], {"blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj"})
    listed = next(x for x in wallpapers.list_items(include_steam=False) if x["id"] == it["id"])
    assert listed["blurhash"] == "LEHV6nWB2yk8pyo0adR*.7kCMdnj"
    assert wallpapers.update(it["id"], {"blurhash": "<script>"}) is None
    assert wallpapers.update("0000000000000000", {"blurhash": "LEHV6nWB2yk8pyo0adR*.7kCMdnj"}) is None


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
