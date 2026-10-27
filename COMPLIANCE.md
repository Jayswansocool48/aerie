# Release checklist

The Pop!_OS app standards, checked for Aerie. Aerie is a free desktop app with no accounts, payments, emails or data collection, and it stays offline unless you use an online feature. Where Aerie meets an item by not having that feature, the row says so.

## Project requirements

| Requirement | Status | How |
|---|---|---|
| Uninstall button that deletes all of the app | Done | Studio → Settings → **Uninstall Aerie** purges the package (app, icon, store listing, update source, lock screen switch through `prerm`) and deletes your setup, wallpapers, clipboard history, media, log, hub shortcuts and autostart entry |
| Icon that stays in Applications and opens the app | Done | Desktop entry and icon (`data/io.github.jayswansocool48.Aerie.*`), installed by the package. Right-click actions: Open the Hub, Aerie Studio, Change Wallpaper, Quit |
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
| 4 | Cookie policy | Done | In `PRIVACY.md`: no cookies. Aerie keeps two conveniences in the page's local storage (the last hub tab and the last library list) and no tokens |
| 5 | Cookie consent banner | Not needed | No cookies, so no banner. The install page sets none either |
| 6 | Checkbox consents | Done | Nothing comes pre-checked except the assistant's "send a description of my design" box, which shows its wording beside the chat. Autostart, ambient sound, the online library, the assistant, clipboard history, the hub shortcuts, the lock screen and Mature wallpapers stay off until you turn them on. The lock screen's system change asks for your password and explains itself. Presets with 360° skies ask before downloading |
| 7 | No unnecessary data | Done | Aerie stores your setup, pins, the last 12 apps you opened and the files you add, on this computer. Window states, now-playing and stats stay in memory. The assistant gets your message and, if you leave the box ticked, a design summary. It never gets notes, to-dos, names or files |
| 8 | Audit third-party SDKs | Done | Bundled: three.js r169 (MIT), gtk4-layer-shell 1.3.0 (MIT), meshoptimizer decoder (MIT), Draco decoder (Apache 2.0). Services, each only when you use it: Cloudflare's speed test, the Anthropic or OpenAI API with your own key, a local Ollama, the Poly Haven API. Aerie calls them over plain HTTPS from its own code. No analytics, ads or tracking |
| 9 | Remove dark patterns | Done | Quit, delete-data and uninstall are plain buttons. Deletes show an Undo toast instead of a scary dialog. COSMIC changes are labeled, backed up first and one click to restore. No nagging |
| 10 | Remove hidden fees | Not needed | Free, no purchases |
| 11 | Remove fake reviews | Done | No reviews or testimonials anywhere, store listing included |
| 12 | Remove unsupported claims | Done | README and store listing describe features that exist, and say what Wallpaper Engine scenes and "application" wallpapers can't do |
| 13 | Accessibility alt text | Done | Labeled tablist in the hub, switches with `aria-pressed`, wallpaper cards with name and kind, stat rings with `role="img"` and a label, album art described, decorative icons hidden, labeled password field and buttons, a live region for toasts, a labeled combobox for Ctrl+K |
| 14 | Fix color contrast | Done | Measured WCAG ratios: text on background 15.1:1, secondary text 8.3:1, dimmest labels 4.9:1, vermilion on background 5.2:1, dark text on vermilion 5.2:1, ochre 6.9:1, lock screen text 17.3:1. The lock screen darkens the wallpaper behind the clock, and Studio warns when a widget's text and card fall under 4.5:1 |
| 15 | Keyboard navigation | Done | Ctrl+K command menu in the hub and Studio. Hub: Super+D, Ctrl+1–7, Ctrl+Tab, arrows and Home/End in the carousel, Enter, Delete in the clipboard, Esc. Studio: Ctrl+1–9 pages, Ctrl+O add a file, Ctrl+Shift+O add a folder, Ctrl+L add a web site, Enter to use and Delete to remove the selected wallpaper, a skip link. Ctrl+Z presses Undo on a toast. The right-click menu works with arrows, Enter and Esc. Visible focus rings everywhere, drawn on the continuous corners too |
| 16 | Add business details | Done | Publisher and contact in `TERMS.md`, `PRIVACY.md`, the store listing (`<developer>`) and the package metadata |
| 17 | Age consent for kids' data | Not needed | Aerie collects no personal data and has no sign-up. The privacy policy points children to Ollama or no assistant, since Claude and ChatGPT accounts have their own age rules. OARS: none |
| 18 | Unsubscribe link in emails | Not needed | Aerie sends no email |
| 19 | License fonts/images | Done | Outfit and Dela Gothic One (SIL OFL) with license files. No audio files: Aerie synthesizes every sound. Default Blender scenes must be your own or openly licensed (docs/BLENDER.md). Preset previews are screenshots of Aerie, the icon is original, and Poly Haven skies are CC0 and credited |
| 20 | Data deletion request | Done | Studio → Settings → "Delete all my Aerie data" clears your setup, clipboard history, hub shortcuts and lock screen choice, and restores COSMIC's look. Uninstalling removes everything |

## Legal holes AI-built apps miss

| Check | Status | How |
|---|---|---|
| Self-host fonts, icons and scripts | Done | Fonts in `web/fonts/`, icons drawn in `web/js/icons.js`, three.js and decoders in `web/vendor/`. Every page's Content-Security-Policy allows only Aerie's own address, so a stray CDN link can't load |
| No session-replay keystroke capture | Done | No analytics or session replay at all. The CI-only key logging (`AERIE_DEBUG_KEYS`) records the key name, never the characters you type |
| Age check on sign-up | Not needed | No sign-up or accounts |
| CAN-SPAM email | Not needed | No email |
| Renewal terms at checkout | Not needed | No purchases or subscriptions |
| Disclaimer on uploads | Done | Aerie uploads nothing. The library and the drop zone still state the rule: add only wallpapers you made or may use; they stay on this computer; report Workshop items on Steam |

## Security

| Rule | Status | How |
|---|---|---|
| No session tokens in localStorage | Done | The per-run server key lives in the page address fragment, never in storage. AI keys stay in a mode 600 file on the native side |
| Server-side permission checks | Done | The local server checks the key on every request and refuses writes from the lock screen (read-only mode). `bin/aerie-system` accepts a fixed list of actions through pkexec |
| Verify email/phone, rate-limit login, password rules | Not needed | No accounts. The lock screen hands your password to PAM, which applies the system's own delay and lockout rules |
| AI keys native-only, sharing checkbox, privacy policy | Done | `aerie/assistant.py` keeps keys server-side and returns only "has a key". The chat shows a "send a description of my design" checkbox. `PRIVACY.md` says what goes to Anthropic or OpenAI |
| Retries never run twice | Done | Imports, uploads, web sites, the speed test and app launches carry an `Idempotency-Key`; the server answers a repeat with the first answer (`Replies` in `aerie/server.py`) |

## Design

- Palette "Sumi": warm ink surfaces, paper text, one vermilion accent, ochre for focus, moss for done. No gradients in the chrome, no glass, no glow, no purple.
- Fonts: Outfit and Dela Gothic One. No Inter, Geist or Space Grotesk.
- Icons: Aerie's own 24 px line set. No Lucide, no sparkles, no emoji.
- Corners: continuous squircle corners (`web/js/squircle.js`) on panels and cards, with radii that differ by size (22, 14, 9, 6, 4 px).
- Widget card styles "Frosted glass", "Liquid glass" and "Neon edge" remain as choices for your own desktop widgets. The default is "Solid", and Aerie's own panels never use them.

## Motion

- Every UI movement runs on closed-form damped springs (`web/js/motion.js`): the hub panel, tab underline, carousel, toasts, menus, page changes and the lock screen shake.
- Springs keep their velocity, so you can grab the hub or the carousel mid-flight, or reverse a move.
- A few CSS details (switch knobs, desktop widget transitions) use `linear()` curves sampled from the same springs.
- Looping content (wallpaper particles, the music bars, skeleton pulses) keeps steady loops, since a spring has no loop.
- Aerie synthesizes its sounds with Web Audio. The hub and Studio play no UI sounds, so there's nothing to time.
- No promo video yet. When one is made, it comes from a `promo/` render pipeline (Playwright frames + ffmpeg).

## UX patterns

| Pattern | Where |
|---|---|
| Skeleton loaders | Studio library, hub controls, stats, clipboard, apps and carousel |
| Optimistic updates | Hub toggles (roll back with a toast on failure), clipboard pins, wallpaper rename |
| Command menu | Ctrl+K in the hub and Studio |
| Shortcut hints | `kbd` labels on buttons, tabs, menus and the command menu; tooltips name the shortcut |
| Undo toasts | Removing a wallpaper, hiding a Workshop item, deleting a to-do, clipboard item or saved look, clearing clipboard history, switching wallpaper, applying a preset, resetting |
| Stale-while-revalidate | The library and carousel show the last list at once with an "Updating" mark; hub tabs show their last data |
| Pre-rendering | Hovering a Studio page or hub tab fetches its data; the carousel loads the next pictures |
| BlurHash placeholders | Every wallpaper preview, computed on first load and kept in the library |
| View transitions | Studio pages (title and preview morph where WebKit supports it, a spring slide otherwise); the hub's tab underline slides between tabs |
| Swipe-to-dismiss | Drag the hub up to close it; Esc too |
| Interruptible animations | All springs |
| Hit slop | Small buttons, chips, tabs and toggles have 44 × 44 px targets |
| Safe area insets | The hub stays clear of COSMIC's panel and dock (layer-shell exclusive zone 0); lock screen and toasts pad for screen edges |
| Tabular numbers | Clocks, timers, stats, battery, sizes, counts and shortcut labels |
| Balanced headlines | `text-wrap: balance` on headings, `pretty` on paragraphs |
| Continuous corners | `web/js/squircle.js` |
| Idempotency keys | See Security |
| Safe triangle menus | The desktop right-click menu's Wallpaper submenu |
| Skipped: predictive back | Studio and the hub have flat navigation with no back stack |
| Skipped: one-time code autofill | No codes to enter |

## Writing

App text, the README, store listing and release notes follow the stop-slop rules: no em dashes, active voice, "you".

Also: Aerie follows the system "reduce motion" setting, and Settings can force it on or off.
