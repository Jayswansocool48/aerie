"""Web views used by the desktop, the hub, Aerie Studio and the lock screen.

Two kinds:
- Aerie's own pages (desktop, hub, studio, lock), loaded from the local server.
- Web wallpapers (Wallpaper Engine / Lively web wallpapers and web sites). These are other
  people's code, so each runs in its own view with a private, throw-away browser profile:
  it can't see Aerie's pages, your cookies or the key that unlocks Aerie's settings, and it
  can't take keyboard focus.
"""

import json

import gi

gi.require_version("Gtk", "4.0")
gi.require_version("Gdk", "4.0")
gi.require_version("WebKit", "6.0")
from gi.repository import Gdk, Gio, GLib, Gtk, WebKit  # noqa: E402

_css_done = False


def transparent_windows():
    global _css_done
    if _css_done:
        return
    css = Gtk.CssProvider()
    css.load_from_string("window.aerie-surface, window.aerie-surface > * { background: transparent; }")
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION)
    _css_done = True


def direct_connection():
    """Talk to the local server directly (proxy lookups go through a portal that can fail)."""
    try:
        WebKit.NetworkSession.get_default().set_proxy_settings(WebKit.NetworkProxyMode.NO_PROXY, None)
    except (AttributeError, TypeError, GLib.Error):
        pass


def page_view(url, *, debug=False, on_message=None, allowed_prefix="", log=print):
    """A view for one of Aerie's own pages. `on_message(dict)` gets messages the page sends
    with window.webkit.messageHandlers.aerie.postMessage(...)."""
    manager = WebKit.UserContentManager()
    if on_message:
        manager.register_script_message_handler("aerie", None)

        def received(_m, value):
            try:
                on_message(json.loads(value.to_json(0)))
            except (ValueError, GLib.Error) as exc:
                log(f"bad page message: {exc}")
        manager.connect("script-message-received::aerie", received)
    view = WebKit.WebView(user_content_manager=manager)
    s = view.get_settings()
    s.set_enable_webgl(True)
    s.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
    s.set_enable_developer_extras(debug)
    s.set_enable_back_forward_navigation_gestures(False)
    s.set_media_playback_requires_user_gesture(False)
    view.set_background_color(Gdk.RGBA(0, 0, 0, 0))
    view.connect("context-menu", lambda *a: not debug)
    view.connect("decide-policy", _keep_inside, allowed_prefix or url.split("#")[0].rsplit("/", 1)[0] + "/", log)
    view.connect("web-process-terminated", lambda v, reason: (log(f"page stopped ({reason}); reloading"),
                                                             GLib.timeout_add(1000, lambda: v.reload() or False)))
    view.load_uri(url)
    return view


def _keep_inside(view, decision, kind, prefix, log):
    """Aerie's pages never navigate away; links to the internet open in your browser."""
    if kind not in (WebKit.PolicyDecisionType.NAVIGATION_ACTION, WebKit.PolicyDecisionType.NEW_WINDOW_ACTION):
        return False
    uri = decision.get_navigation_action().get_request().get_uri()
    if uri.startswith(prefix) or uri.startswith("about:") or uri.startswith("blob:"):
        return False
    decision.ignore()
    if uri.startswith(("https://", "http://")):
        try:
            Gio.AppInfo.launch_default_for_uri(uri, None)
        except GLib.Error as exc:
            log(f"could not open {uri}: {exc.message}")
    return True


# Wallpaper Engine and Lively web wallpapers expect these to exist.
WALLPAPER_SHIM = r"""
(() => {
  const audio = [];
  window.wallpaperRegisterAudioListener = cb => { if (typeof cb === 'function') audio.push(cb); };
  window.wallpaperRegisterMediaStatusListener = () => {};
  window.wallpaperRegisterMediaPropertiesListener = () => {};
  window.wallpaperRegisterMediaThumbnailListener = () => {};
  window.wallpaperRegisterMediaPlaybackListener = () => {};
  window.wallpaperRegisterMediaTimelineListener = () => {};
  window.wallpaperRequestRandomFileForProperty = () => {};
  window.__aerieAudio = levels => { for (const cb of audio) try { cb(levels); } catch (e) {} };
  window.__aerieApply = (props, general, lively) => {
    try { window.wallpaperPropertyListener?.applyGeneralProperties?.(general); } catch (e) {}
    try { window.wallpaperPropertyListener?.applyUserProperties?.(props); } catch (e) {}
    if (lively && typeof window.livelyPropertyListener === 'function') {
      for (const [k, v] of Object.entries(lively)) try { window.livelyPropertyListener(k, v); } catch (e) {}
    }
  };
  window.__aeriePause = on => {
    try { window.wallpaperPropertyListener?.setPaused?.(on); } catch (e) {}
    for (const m of document.querySelectorAll('video, audio')) { try { on ? m.pause() : m.play(); } catch (e) {} }
  };
})();
"""


def wallpaper_view(url, *, muted=True, log=print):
    """A sandboxed view for a web wallpaper."""
    manager = WebKit.UserContentManager()
    manager.add_script(WebKit.UserScript.new(WALLPAPER_SHIM, WebKit.UserContentInjectedFrames.ALL_FRAMES,
                                             WebKit.UserScriptInjectionTime.START, None, None))
    try:
        session = WebKit.NetworkSession.new_ephemeral()
        view = WebKit.WebView(user_content_manager=manager, network_session=session)
    except (AttributeError, TypeError):
        view = WebKit.WebView(user_content_manager=manager)
    s = view.get_settings()
    s.set_enable_webgl(True)
    s.set_hardware_acceleration_policy(WebKit.HardwareAccelerationPolicy.ALWAYS)
    s.set_media_playback_requires_user_gesture(False)
    s.set_enable_back_forward_navigation_gestures(False)
    s.set_javascript_can_open_windows_automatically(False)
    try:
        s.set_enable_webrtc(False)
        s.set_enable_media_stream(False)
    except AttributeError:
        pass
    view.set_is_muted(muted)
    view.set_can_focus(False)
    view.set_focusable(False)
    view.connect("context-menu", lambda *a: True)
    view.connect("permission-request", lambda v, req: (req.deny(), True)[1])  # no camera, mic, location…
    view.connect("create", lambda *a: None)  # no pop-up windows
    view.connect("decide-policy", _wallpaper_policy, url, log)
    view.connect("web-process-terminated", lambda v, reason: (log(f"web wallpaper stopped ({reason}); reloading"),
                                                             GLib.timeout_add(3000, lambda: v.reload() or False)))
    view.load_uri(url)
    return view


def _wallpaper_policy(view, decision, kind, start_url, log):
    """A wallpaper may load its own pages, but link clicks open in your browser instead."""
    if kind == WebKit.PolicyDecisionType.NEW_WINDOW_ACTION:
        decision.ignore()
        return True
    if kind != WebKit.PolicyDecisionType.NAVIGATION_ACTION:
        return False
    action = decision.get_navigation_action()
    uri = action.get_request().get_uri()
    if action.is_user_gesture() and action.get_navigation_type() == WebKit.NavigationType.LINK_CLICKED \
            and uri.startswith(("http://", "https://")) and not uri.startswith(start_url.split("#")[0]):
        decision.ignore()
        try:
            Gio.AppInfo.launch_default_for_uri(uri, None)
        except GLib.Error:
            pass
        return True
    return False


def run_js(view, script):
    view.evaluate_javascript(script, -1, None, None, None, None, None)


def apply_wallpaper_settings(view, props, item, fps=30):
    """Sends a web wallpaper its settings (Wallpaper Engine user properties / Lively properties)."""
    we, lively = {}, {}
    for key, p in (item.get("properties") or {}).items():
        value = props.get(key, p.get("value"))
        if p.get("lively"):
            lively[key] = value
        else:
            we[key] = {"value": value}
    general = {"fps": fps}
    run_js(view, f"window.__aerieApply && window.__aerieApply({json.dumps(we)}, {json.dumps(general)}, {json.dumps(lively)})")
