"""The AI that makes wallpapers with you: Claude, ChatGPT or a local Ollama model.

Your API keys are kept in ~/.config/aerie/assistant.json (readable only by you) and are only
ever sent to the service they belong to. The page never sees them. What the AI gets: what you
type, the lists of free Poly Haven assets it can choose from, and (when you ask it to change a
wallpaper it made) that wallpaper's shader code or layout. Never your files, notes or anything else.
The jobs themselves (finding art, drawing, shaders, 3D stages) are in creator.py.
"""

import json
import os
import re
import urllib.error
import urllib.request

from . import __version__, paths

SETTINGS_FILE = paths.CONFIG_DIR / "assistant.json"
PROVIDERS = ("claude", "openai", "ollama")
DEFAULTS = {
    "provider": "",
    "models": {"claude": "claude-sonnet-5-5", "openai": "gpt-5-mini", "ollama": "", "openaiImage": "gpt-image-1"},
    "ollamaUrl": "http://127.0.0.1:11434",
    "keys": {},
}

def _private_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=1)
    os.replace(tmp, path)


def load():
    data = json.loads(json.dumps(DEFAULTS))
    try:
        saved = json.loads(SETTINGS_FILE.read_text())
        data.update({k: v for k, v in saved.items() if k in data and k != "models"})
        data["models"].update(saved.get("models") or {})
    except (OSError, ValueError):
        pass
    return data


def public():
    """Settings for the page: everything except the keys themselves."""
    s = load()
    return {"provider": s["provider"], "models": s["models"], "ollamaUrl": s["ollamaUrl"],
            "hasKey": {p: bool(s["keys"].get(p)) for p in ("claude", "openai")}}


def update(changes):
    s = load()
    if changes.get("provider") in PROVIDERS + ("",):
        s["provider"] = changes["provider"]
    for p, model in (changes.get("models") or {}).items():
        if p in PROVIDERS + ("openaiImage",) and isinstance(model, str) and len(model) < 120:
            s["models"][p] = model.strip()
    url = changes.get("ollamaUrl")
    if isinstance(url, str) and re.match(r"^https?://[^\s]+$", url.strip()):
        s["ollamaUrl"] = url.strip().rstrip("/")
    for p, key in (changes.get("keys") or {}).items():
        if p in ("claude", "openai") and isinstance(key, str):
            if key.strip():
                s["keys"][p] = key.strip()
            else:
                s["keys"].pop(p, None)  # empty = forget the key
    _private_write(SETTINGS_FILE, s)
    return public()


def forget():
    SETTINGS_FILE.unlink(missing_ok=True)


def _post(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": f"Aerie/{__version__}", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return json.loads(res.read(8 * 1024 * 1024))


def ollama_models():
    s = load()
    req = urllib.request.Request(s["ollamaUrl"] + "/api/tags", headers={"User-Agent": f"Aerie/{__version__}"})
    with urllib.request.urlopen(req, timeout=5) as res:
        data = json.loads(res.read(2 * 1024 * 1024))
    return [m.get("name") for m in data.get("models", []) if m.get("name")]


def complete(system, messages, max_tokens=4000, timeout=300):
    """Asks the chosen AI. messages: [{role: user|assistant, content}] (latest last).
    Returns the text of its answer (the prompts ask for JSON)."""
    s = load()
    provider = s["provider"]
    if provider not in PROVIDERS:
        raise ValueError("Pick an AI in Studio → Create → AI settings first")
    history = [{"role": m["role"], "content": str(m["content"])[:60000]}
               for m in messages[-12:] if m.get("role") in ("user", "assistant") and m.get("content")]
    if not history or history[-1]["role"] != "user":
        raise ValueError("Nothing to answer")
    model = s["models"].get(provider) or DEFAULTS["models"][provider]
    if provider == "claude":
        key = s["keys"].get("claude")
        if not key:
            raise ValueError("Add your Claude API key in Studio → Create → AI settings")
        data = _post("https://api.anthropic.com/v1/messages",
                     {"model": model, "max_tokens": max_tokens, "system": system, "messages": history},
                     {"x-api-key": key, "anthropic-version": "2023-06-01"}, timeout=timeout)
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    if provider == "openai":
        key = s["keys"].get("openai")
        if not key:
            raise ValueError("Add your OpenAI API key in Studio → Create → AI settings")
        data = _post("https://api.openai.com/v1/chat/completions",
                     {"model": model, "messages": [{"role": "system", "content": system}] + history,
                      "response_format": {"type": "json_object"}},
                     {"Authorization": f"Bearer {key}"}, timeout=timeout)
        return (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if not model:
        raise ValueError("Pick one of your Ollama models in Studio → Create → AI settings")
    data = _post(s["ollamaUrl"] + "/api/chat",
                 {"model": model, "stream": False, "format": "json",
                  "messages": [{"role": "system", "content": system}] + history}, {}, timeout=max(timeout, 600))
    return data.get("message", {}).get("content", "")


def can_paint():
    """True when an OpenAI key is set, so the image AI can paint pictures."""
    return bool(load()["keys"].get("openai"))


def paint(prompt, size="1536x1024"):
    """Asks OpenAI's image model for a picture. Returns PNG/JPEG bytes."""
    import base64
    s = load()
    key = s["keys"].get("openai")
    if not key:
        raise ValueError("Painting pictures needs an OpenAI API key (Studio → Create → AI settings)")
    data = _post("https://api.openai.com/v1/images/generations",
                 {"model": s["models"].get("openaiImage") or "gpt-image-1", "prompt": str(prompt)[:3800],
                  "size": size, "n": 1},
                 {"Authorization": f"Bearer {key}"}, timeout=300)
    first = (data.get("data") or [{}])[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"])
    raise ValueError("The image AI didn't send a picture back")


def parse_json(text):
    """The first JSON object in an AI answer (they sometimes wrap it in words or code fences)."""
    text = text or ""
    for m in re.finditer(r"\{", text):
        depth, in_str, esc = 0, False, False
        for i in range(m.start(), len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        data = json.loads(text[m.start():i + 1])
                        if isinstance(data, dict):
                            return data
                    except ValueError:
                        pass
                    break
    raise ValueError("The AI's answer wasn't in the expected form. Try again, or try another model.")


def error_message(exc):
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403):
            return "The AI service didn't accept the API key. Check it in the assistant's settings."
        if exc.code == 404:
            return "The AI service doesn't know that model name. Check it in the assistant's settings."
        if exc.code == 429:
            return "The AI service says you've hit a limit (or your account needs credit). Try again later."
        return f"The AI service answered with an error ({exc.code})."
    if isinstance(exc, urllib.error.URLError):
        if load()["provider"] == "ollama":
            return "Couldn't reach Ollama. Is it installed and running? (ollama serve)"
        return "Couldn't reach the AI service. Are you online?"
    if isinstance(exc, TimeoutError):
        return "The AI took too long to answer. Try again, or a smaller model."
    return str(exc)
