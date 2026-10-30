import sys

if "--restore-cosmic-look" in sys.argv:
    # Used by ./install.sh --uninstall: put COSMIC's own look back the way it was.
    from .cosmic_look import restore

    print("COSMIC look restored." if restore() else "Nothing to restore.")
    sys.exit(0)

if "--undo-extras" in sys.argv:
    # Used by ./install.sh --uninstall: remove the lock screen choice.
    from .server import _undo_extras

    _undo_extras()
    print("Lock screen choice removed.")
    sys.exit(0)

if "--windows" in sys.argv:
    # Shows what Aerie sees of your windows (for "it pauses when it shouldn't").
    import time

    from .desktop_watch import watch

    args = [a for a in sys.argv[1:] if a.isdigit()]
    seconds = int(args[0]) if args else 8
    print(f"Watching your windows for {seconds} seconds (maximize, minimize or switch workspaces to see changes)…")
    w = watch(lambda s: print(time.strftime("%H:%M:%S"), {k: [n for n, on in v.items() if on] or "clear" for k, v in s.items()}, flush=True),
              log=lambda m: print(m, flush=True))
    if not w:
        sys.exit("Not running on Wayland.")
    time.sleep(seconds)
    sys.exit(0)

from .shell import main  # noqa: E402

sys.exit(main())
