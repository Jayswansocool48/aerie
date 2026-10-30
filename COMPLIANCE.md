# Release checklist

The Pop!_OS app standards, checked for Aerie. Aerie is a free desktop app with no accounts, payments, emails or data collection, and it stays offline unless you use an online feature. Where Aerie meets an item by not having that feature, the row says so.

## Project requirements

| Requirement | Status | How |
|---|---|---|
| Uninstall button that deletes all of the app | Done | Studio → Settings → **Uninstall Aerie** purges the package (app, icon, store listing, update source, lock screen switch through `prerm`) and deletes your setup, wallpapers, downloads, AI keys, media, log and autostart entry |
| Icon that stays in Applications and opens the app | Done | Desktop entry and icon (`data/io.github.jayswansocool48.Aerie.*`), installed by the package. Right-click actions: Aerie Studio, Make a Wallpaper, Quit |
| Flatpak | Exception | A live wallpaper draws on COSMIC's desktop layer, and cosmic-comp hides layer-shell from Flatpak apps. Aerie ships as a `.deb` with its own COSMIC Store listing and a signed apt source on GitHub Pages. Decided Oct 9, 2026 (as Deskscape) |
| In the COSMIC Store | Done | The package installs `/usr/share/swcatalog/xml/aerie.xml.gz`, so Aerie shows under Installed and you can remove it there. Updates arrive on the store's Updates page from the published package source |
| Easy install | Done | One command from the install page (`curl … install.sh \| bash`), or `./install.sh` from a clone |
| Easy update | Done | COSMIC Store Updates, or Settings → Check for updates |
| Easy uninstall | Done | Settings button, COSMIC Store, or `./install.sh --uninstall`. `./install.sh --check` reports problems |
| On GitHub | Done | https://github.com/Jayswansocool48/aerie (public), listed in the `apps` catalog. The `pop-os` topic needs adding by hand (repo → About → Topics); the session's GitHub access can't set topics |
| Release workflow | Done | Runs from Actions → Release, on a tag, and on any push to main that changes `VERSION`. It stops when `VERSION`, `aerie/__init__.py` and the tag disagree |

## The 20 items

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | Privacy policy | Done | `PRIVACY.md`, linked from Settings → About and the install page |
| 2 | Terms of service | Done | `TERMS.md` |
| 3 | Refund policy | Done | In `TERMS.md`: Aerie is free, so there's nothing to refund |
| 4 | Cookie policy | Done | In `PRIVACY.md`: no cookies. Studio keeps one convenience in local storage (the last library list) and no tokens |
| 5 | Cookie consent banner | Not needed | No cookies, so no banner. The install page sets none either |
| 6 | Checkbox consents | Done | One box comes pre-checked: "Send this shader's code / scene's layout to the AI with my request", shown right under the request, because the AI can't change a wallpaper it can't see. Unticking it stops the request. Online content (Discover), the AI, autostart, the lock screen and Mature wallpapers stay off until you turn them on. Discover shows a consent card that names Openverse and Poly Haven before anything goes online. The lock screen's system change asks for your password and explains itself |
| 7 | No unnecessary data | Done | Aerie stores your setup, your wallpapers and their credits on this computer. Window states, now-playing, stats and sound levels stay in memory. The AI gets your request, asset names to pick from and, if the box is ticked, the wallpaper you're changing. Music-reactive wallpapers hear the speaker output, never the microphone, and nothing is recorded |
| 8 | Audit third-party SDKs | Done | Bundled: three.js r169 with its GLTF, Draco, meshopt and RGBE loaders (MIT; Draco decoder Apache 2.0), gtk4-layer-shell 1.3.0 (MIT), Phosphor icons (MIT). Python: numpy for the sound levels. Services, each only when you use it: the Openverse API, the Poly Haven API, the Anthropic or OpenAI API with your own key, a local Ollama. Aerie calls them over plain HTTPS from its own code. No analytics, ads or tracking |
| 9 | Remove dark patterns | Done | Quit, delete-data and uninstall are plain buttons. Deletes show an Undo toast instead of a scary dialog. Turning online content off is one switch. No nagging |
| 10 | Remove hidden fees | Not needed | Free, no purchases. The AI uses your own API key, and Studio says the provider may charge you |
| 11 | Remove fake reviews | Done | No reviews or testimonials anywhere, store listing included |
| 12 | Remove unsupported claims | Done | README and store listing describe features that exist, and say what Wallpaper Engine scenes and "application" wallpapers can't do. |
| 13 | Accessibility alt text | Done | Labeled tablist for Studio pages, switches with `aria-pressed`, wallpaper tiles with name, kind and credit, Discover results with their title and author, album art described, decorative icons hidden, labeled password field and buttons, live regions for toasts and AI progress, a labeled combobox for Ctrl+K |
| 14 | Fix color contrast | Done | Theme "Teal Mist", measured WCAG ratios: text on background 16.7:1, secondary text 7.2:1 (5.9:1 on raised panels), teal on background 8.2:1, dark text on teal buttons 7.4:1, chip text 5.0:1, red 5.8:1, input borders 3.8:1. The lock screen darkens the wallpaper behind the clock, and Studio warns when a widget's text and card fall under 4.5:1 |
| 15 | Keyboard navigation | Done | Studio: Ctrl+1–6 pages, arrows along the tabs, Ctrl+K command menu, Ctrl+O add a file, Ctrl+Shift+O add a folder, Ctrl+L add a web site, arrows, Enter and Delete in the library, Ctrl+Enter sends an AI request or runs the shader, Ctrl+S saves what you build, a skip link. Desktop: Ctrl+E Studio, Ctrl+Space app drawer, Ctrl+Z brings back a removed widget. The right-click menu works with arrows, Enter and Esc. Visible focus rings everywhere |
| 16 | Add business details | Done | Publisher and contact in `TERMS.md`, `PRIVACY.md`, the store listing (`<developer>`) and the package metadata |
| 17 | Age consent for kids' data | Not needed | Aerie collects no personal data and has no sign-up. The privacy policy points children to Ollama or no AI. Openverse searches always exclude mature results. OARS: none |
| 18 | Unsubscribe link in emails | Not needed | Aerie sends no email |
| 19 | License fonts/images | Done | Outfit and JetBrains Mono (SIL OFL) with license files, Phosphor icons (MIT). Bundled wallpapers are CC0 or public domain and credited in `web/wallpapers/README.md` and in Studio. Openverse imports accept only CC0 and public-domain marks and keep their credit. Poly Haven assets are CC0, and Studio names Poly Haven as their terms ask. No audio files |
| 20 | Data deletion request | Done | Studio → Settings → "Delete all my Aerie data" clears your setup, wallpapers, downloads, keys and lock screen choice. Uninstalling removes everything |

## Legal holes AI-built apps miss

| Check | Status | How |
|---|---|---|
| Self-host fonts, icons and scripts | Done | Fonts in `web/fonts/`, Phosphor icons inlined in `web/js/icons.js`, three.js and loaders in `web/vendor/`. Every page's Content-Security-Policy allows only Aerie's own address, so a stray CDN link can't load. Discover thumbnails come through Aerie's own server |
| No session-replay keystroke capture | Done | No analytics or session replay at all. The CI-only key logging (`AERIE_DEBUG_KEYS`) records the key name, never the characters you type |
| Age check on sign-up | Not needed | No sign-up or accounts |
| CAN-SPAM email | Not needed | No email |
| Renewal terms at checkout | Not needed | No purchases or subscriptions |
| Disclaimer on uploads | Done | Aerie uploads nothing. The library, the drop zone and Discover state the rule: add only wallpapers you made or may use; they stay on this computer; report Workshop items on Steam |

## Security

| Rule | Status | How |
|---|---|---|
| No session tokens in localStorage | Done | The per-run server key lives in the page address fragment, never in storage. AI keys stay in a mode 600 file on the native side |
| Server-side permission checks | Done | The local server checks the key on every request and refuses writes from the lock screen (read-only mode). Online routes refuse to run while online content is off. `bin/aerie-system` accepts a fixed list of actions through pkexec |
| Untrusted files | Done | Picture downloads and preview images are checked by their first bytes before saving. SVG layers lose scripts, event handlers and outside links. Zips with unsafe paths are refused. Shaders run in WebGL, web wallpapers in a sandboxed profile |
| Verify email/phone, rate-limit login, password rules | Not needed | No accounts. The lock screen hands your password to PAM, which applies the system's own delay and lockout rules |
| AI keys native-only, sharing checkbox, privacy policy | Done | `aerie/assistant.py` keeps keys server-side and returns only "has a key". The Create page shows the "Send this … to the AI" checkbox under the request. `PRIVACY.md` says what goes to Anthropic or OpenAI |
| Retries never run twice | Done | Imports, uploads, web sites, new shaders, layers and scenes, Discover imports, AI requests and app launches carry an `Idempotency-Key`; the server answers a repeat with the first answer (`Replies` in `aerie/server.py`) |

## Design

- Theme "Teal Mist" by serafimcloud on [21st.dev](https://21st.dev): near-black teal surfaces, one teal accent, a muted teal for chips. No orange, no cream, no pure black or white, no gradients in the chrome, no glass, no glow, no purple.
- Components adapted from 21st.dev: the library filter chips from "Filter Grid" (ddoemonn) and the sliders from "Slider" (halaska-studio), rebuilt in plain JavaScript and CSS.
- Fonts: Outfit for text and JetBrains Mono for code, numbers and shortcuts. No Inter, Geist or Space Grotesk.
- Icons: Phosphor (regular weight). No Lucide, no sparkles, no emoji.
- Corners: continuous squircle corners (`web/js/squircle.js`) with radii that differ by size.
- Page names carry a small Japanese label, a nod to anime wallpapers.
- Widget card styles are Solid, Outline and No card. Aerie's own panels never use glass.

## Motion

- Every UI movement runs on closed-form damped springs (`web/js/motion.js`): the tab underline, page changes, toasts, menus, the app drawer, filter chips and the lock screen shake.
- Parallax wallpapers follow the mouse on a critically damped spring, and shader wallpapers smooth the mouse the same way.
- Springs keep their velocity, so you can reverse a move mid-flight.
- A few CSS details (switch knobs, slider thumbs, desktop widget transitions) use `linear()` curves sampled from the same springs.
- Looping content (shader time, 3D orbits, skeleton pulses) keeps steady loops, since a spring has no loop.
- Reduce motion stops drifting, orbiting and swaying. It follows the system setting, and Settings can force it on or off.
- No promo video yet. When one is made, it comes from a `promo/` render pipeline (Playwright frames + ffmpeg).

## UX patterns

| Pattern | Where |
|---|---|
| Skeleton loaders | Studio library, Discover results, AI progress |
| Optimistic updates | Favorites (the heart fills at once and empties again if saving fails), wallpaper rename |
| Command menu | Ctrl+K in Studio, with every page, action and wallpaper |
| Shortcut hints | `kbd` labels on buttons, tabs, menus and the command menu; tooltips name the shortcut |
| Undo toasts | Removing a wallpaper, removing a widget, switching wallpaper |
| Stale-while-revalidate | The library shows the last list at once with an "Updating" mark |
| Pre-rendering | Hovering a Studio page fetches its data; hovering a tile loads its full preview |
| BlurHash placeholders | Every wallpaper preview, computed on first load and kept in the library |
| View transitions | Studio pages (where WebKit supports them; a spring slide otherwise) |
| Interruptible animations | All springs |
| Hit slop | Small buttons, chips, tabs and toggles have 44 × 44 px targets |
| Safe area insets | Studio, the lock screen and toasts pad for screen edges |
| Tabular numbers | Clocks, timers, stats, battery, sizes, counts, slider values and shortcut labels |
| Balanced headlines | `text-wrap: balance` on headings, `pretty` on paragraphs |
| Continuous corners | `web/js/squircle.js` |
| Idempotency keys | See Security |
| Safe triangle menus | The desktop right-click menu's Wallpaper submenu |
| Skipped: swipe-to-dismiss | The hub it served is gone; nothing else slides away |
| Skipped: predictive back | Studio has flat navigation with no back stack |
| Skipped: one-time code autofill | No codes to enter |

## Writing

App text, the README, store listing and release notes follow the stop-slop rules: no em dashes, active voice, "you".
