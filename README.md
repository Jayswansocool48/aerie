# Aerie

Live wallpapers for Pop!_OS (COSMIC), like Wallpaper Engine — on your desktop **and your lock screen**.

- **3D scenes made in Blender** play live, with their own camera, lights and animations, and move with your mouse. They are Aerie's default themes (see [docs/BLENDER.md](docs/BLENDER.md)).
- **Wallpaper Engine wallpapers**: the ones you subscribed to in the Steam Workshop show up by themselves; or add a Wallpaper Engine folder or `.zip`. Video, web and picture wallpapers play like in Wallpaper Engine, with their settings; scene wallpapers show their picture layers with mouse depth.
- **Your own videos, pictures, web pages and web sites**, and Lively web wallpapers.
- **A hub** that drops down from the top of the screen (Super+D): Controls (Wi-Fi, Bluetooth, sound, brightness, dark mode, do not disturb, music), Today (week, focus timer, to-dos), Stats (CPU, graphics, memory, top apps, network, speed test), Clipboard history, Apps, Wallpaper (cover flow) and Power.
- **A live lock screen**: your wallpaper, a big clock, what's playing and a password box.
- **Aerie Studio**, a normal window for your library and every setting, with a live preview. Widgets, a 3D look you design yourself, the design assistant (Claude, ChatGPT or a free local Ollama) and restyling COSMIC's own panel and dock are all still there.

![The desktop](docs/screenshots/desktop.png)

*Aerie was called Deskscape. Your setup, saved looks and pictures carry over automatically.*

## Install, update, uninstall

| | How |
| --- | --- |
| **Install** | `curl -fsSL https://jayswansocool48.github.io/aerie/install.sh \| bash` (or `./install.sh` in this folder) |
| **Open** | Press **Super**, type **Aerie**. That opens Aerie Studio. **Super+D** opens the hub (turn the shortcut on in Studio → Hub). |
| **Update** | Automatic with your other updates in the **COSMIC Store**, or Studio → Settings → **Check for updates** |
| **Uninstall** | Studio → Settings → **Uninstall Aerie** (removes the app and all its data, the hub shortcuts, and puts COSMIC's lock screen and look back), the COSMIC Store, or `./install.sh --uninstall` |
| **Not working?** | `./install.sh --check`, and send the output |

Aerie is a regular Pop!_OS package, not a Flatpak: COSMIC only lets apps outside the Flatpak sandbox draw on the desktop layer and lock the screen.

Recommended extras (installed with Aerie when available): `wl-clipboard` for clipboard history, `gstreamer1.0-libav` for more video formats.

## Wallpapers

| Kind | Where from | How it plays |
| --- | --- | --- |
| 3D scene (`.glb`, `.gltf`) | Blender (File → Export → glTF), or any 3D app | Live, with its camera, lights, shadows and animations, plus mouse depth |
| Video (`.mp4`, `.webm`, `.mkv`, `.mov`) | Your files, Wallpaper Engine | Loops; speed, fit and sound in Studio |
| Picture (`.jpg`, `.png`, `.webp`, `.gif`, `.avif`) | Your files | Fill, fit, stretch or center |
| Web (`index.html` + files) | Wallpaper Engine "web", Lively, your own | In a sandbox, with its own settings (Wallpaper Engine user properties) |
| Web site | Any address | Loaded live in a sandbox |
| Wallpaper Engine scene (`scene.pkg`) | Steam Workshop | Its picture layers, with the scene's mouse parallax. Shader effects, particles and scripts only run in Wallpaper Engine itself |

**Wallpaper Engine:** install Steam, then Wallpaper Engine (it runs with Proton: right-click → Properties → Compatibility), and subscribe to wallpapers in its Workshop. Aerie finds them in Steam's folders (normal and Flatpak Steam, and other Steam libraries) and never changes them. "Application" wallpapers are Windows programs and can't run. Wallpapers rated Mature are hidden unless you turn them on in Studio → Hub.

## The lock screen

Studio → Lock screen → **Use Aerie as my lock screen**. COSMIC starts its own lock screen program in every session; turning this on sets that program aside with `dpkg-divert` (so COSMIC updates keep working) and puts a small switch (`bin/cosmic-greeter-wrapper`) in its place, after you confirm with your password. The switch starts Aerie's lock screen only for people who turned it on; everyone else, and the login screen, get COSMIC's own.

- Your password is checked by PAM, like at login (`/etc/pam.d/aerie-lock`), and never stored.
- It uses the same Wayland session-lock protocol as COSMIC's lock screen: if Aerie's lock screen crashes, the session **stays locked**; it restarts, and after 3 failures in 2 minutes COSMIC's own lock screen takes over until you log in again.
- Turning it off brings COSMIC's lock screen back immediately; "Remove the system switch" (and uninstalling) undoes the system change completely.
- `aerie-lock --preview` shows it without locking.

## What's inside

- `aerie/shell.py` — the wallpaper surface on every screen (gtk4-layer-shell), the hub, Aerie Studio; web wallpapers run in their own sandboxed view
- `aerie/lock.py`, `aerie/pam.py` — the lock screen (gtk4-layer-shell's session lock + PAM); `bin/aerie-system` makes the system change (via pkexec, fixed actions only)
- `aerie/wallpapers.py`, `aerie/wetex.py` — the library, importing, Steam Workshop and Wallpaper Engine `.pkg`/`.tex` reading
- `aerie/server.py` — local server on `127.0.0.1` only, protected by a random per-run key; web wallpapers get their own address
- `aerie/controls.py`, `aerie/clipboard.py`, `aerie/speedtest.py`, `aerie/system_info.py` — the hub's controls, clipboard history, speed test and stats
- `aerie/assistant.py`, `aerie/cosmic_look.py`, `aerie/desktop_watch.py` — design assistant, COSMIC restyling, pausing while you use apps
- `web/` — the pages (desktop, hub, studio, lock), the Blender scene player (`js/modelscene.js`, three.js), widgets and sounds
- `tests/` — unit tests, and `run_under_sway.sh`, which runs the whole app under a headless Wayland desktop in CI and saves screenshots

```bash
python3 -m aerie.server --port 8765   # the pages only, in a normal browser (index.html, hub.html, studio.html, lock.html)
./bin/aerie                           # the whole app from this folder (run tools/build-deb.sh once for layer-shell)
python3 tests/test_library.py && python3 tests/test_wetex.py && python3 tests/test_desktop_watch.py
```

**Releasing:** bump `aerie/__init__.py` and add a `<release>` to `data/io.github.jayswansocool48.Aerie.metainfo.xml`, then GitHub → **Actions → Release → Run workflow**.

## Credits and licenses

- Aerie: MIT — see `LICENSE`
- [three.js](https://threejs.org) r169 (MIT), [gtk4-layer-shell](https://github.com/wmww/gtk4-layer-shell) 1.3.0 (MIT), [meshoptimizer](https://github.com/zeux/meshoptimizer) decoder (MIT), [Draco](https://github.com/google/draco) decoder (Apache 2.0) — bundled with their licenses
- Fonts: [Outfit](https://github.com/Outfitio/Outfit-Fonts) and [Dela Gothic One](https://github.com/syakuzen/DelaGothic), SIL Open Font License (`web/fonts/`)
- No bundled audio; sounds are synthesized in code. Preset previews are screenshots of Aerie; the icon is original
- Optional 360° skies and models: [Poly Haven](https://polyhaven.com), CC0
- Wallpaper Engine is a product of Wallpaper Engine Team / Kristjan Skutta; Aerie is not affiliated with it and only reads wallpapers you have. Lively is by rocksdanister.

See `PRIVACY.md`, `TERMS.md` and `COMPLIANCE.md`.
