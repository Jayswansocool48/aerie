#!/usr/bin/env bash
# Aerie installer for Pop!_OS (COSMIC).
#
#   ./install.sh               install, or update if already installed
#   ./install.sh --uninstall   remove Aerie and all of its data
#   ./install.sh --check       show what is installed and why Aerie might not work
#
# Aerie is installed as a regular Pop!_OS package (not a Flatpak): COSMIC only lets
# apps outside the Flatpak sandbox draw on the desktop layer, which a live wallpaper needs.
# Once installed it appears in the COSMIC Store, which can also uninstall it.
set -euo pipefail

APP_ID=io.github.jayswansocool48.Aerie
SRC=$(cd "$(dirname "$0")" && pwd)
PUBLISHED=https://jayswansocool48.github.io/aerie
BUILD_DEPS="meson ninja-build gcc pkg-config libgtk-4-dev libwayland-dev wayland-protocols gobject-introspection libgirepository1.0-dev dpkg-dev git"

say() { printf '\n\033[1;33m==>\033[0m %s\n' "$*"; }

remove_old_copies() {
  # Aerie used to be called Deskscape. Your setup carries over by itself (Aerie copies it on first
  # start); here the old app goes away: its package, its update source and early test copies.
  OLD_ID=io.github.jayswansocool48.Deskscape
  if dpkg -s deskscape >/dev/null 2>&1; then
    say "Replacing Deskscape with Aerie (asks for your password)"
    deskscape --quit 2>/dev/null || true
    sudo apt-get purge -y deskscape
  fi
  sudo rm -f /etc/apt/sources.list.d/deskscape.sources /usr/share/keyrings/deskscape.gpg 2>/dev/null || true
  if command -v flatpak >/dev/null && flatpak info "$OLD_ID" >/dev/null 2>&1; then
    flatpak kill "$OLD_ID" 2>/dev/null || true
    flatpak uninstall -y --noninteractive "$OLD_ID" || true
  fi
  if command -v flatpak >/dev/null; then
    flatpak remote-delete --user --force deskscape-local 2>/dev/null || true
    flatpak remote-delete --user --force deskscape 2>/dev/null || true
  fi
  rm -rf "$HOME/.local/share/deskscape-flatpak-repo" "$HOME/.cache/deskscape-build" \
    "$HOME/.local/lib/deskscape" "$HOME/.local/bin/deskscape" \
    "$HOME/.local/share/applications/deskscape.desktop" \
    "$HOME/.local/share/icons/hicolor/scalable/apps/deskscape.svg" \
    "$HOME/.config/autostart/deskscape.desktop"
}

case "${1:-}" in
  --check)
    say "Installed package"
    dpkg -s aerie 2>/dev/null | grep -E "^(Status|Version)" || echo "Aerie is NOT installed. Run ./install.sh"
    say "Old Deskscape copies (should say 'none')"
    (dpkg -s deskscape 2>/dev/null | grep -E "^Version") || echo "none"
    say "Update source"
    cat /etc/apt/sources.list.d/aerie.sources 2>/dev/null || echo "none (run ./install.sh to add it)"
    say "Desktop: ${XDG_CURRENT_DESKTOP:-unknown}, session: ${XDG_SESSION_TYPE:-unknown}"
    if command -v aerie >/dev/null; then
      say "Starting Aerie for 15 seconds to catch errors"
      aerie --quit 2>/dev/null || true
      sleep 1
      timeout 15 aerie 2>&1 | tail -30 || true
      say "What Aerie sees of your windows (8 seconds)"
      aerie --windows 2>&1 | tail -20 || true
      say "Aerie log"
      aerie --log | tail -30
    fi
    echo
    echo "Copy everything above and send it to Claude if Aerie still doesn't work."
    exit 0
    ;;
  --uninstall)
    say "Removing Aerie (asks for your password)"
    aerie --quit 2>/dev/null || true
    aerie --restore-cosmic-look 2>/dev/null || true
    aerie --undo-extras 2>/dev/null || true
    sudo /usr/lib/aerie/bin/aerie-system lockscreen-off 2>/dev/null || true
    remove_old_copies
    sudo apt-get purge -y aerie || true
    rm -rf "$HOME/.config/aerie" "$HOME/.local/share/aerie" "$HOME/.cache/aerie.log" \
      "$HOME/.config/autostart/$APP_ID.desktop" "$SRC/build" "$SRC/dist"
    echo "Aerie and all of its data are gone."
    exit 0
    ;;
esac

remove_old_copies

if curl -fsSL --max-time 10 -o /dev/null "$PUBLISHED/aerie.gpg" 2>/dev/null; then
  # Released: add Aerie's package source, so updates arrive with your other updates
  # (COSMIC Store → Updates) and Settings → Check for updates works.
  say "Adding Aerie's update source (asks for your password)"
  curl -fsSL "$PUBLISHED/aerie.gpg" | sudo tee /usr/share/keyrings/aerie.gpg >/dev/null
  curl -fsSL "$PUBLISHED/aerie.sources" | sudo tee /etc/apt/sources.list.d/aerie.sources >/dev/null
  sudo apt-get update -qq
  say "Installing Aerie"
  sudo apt-get install -y aerie
else
  # Not released yet: build the package on this computer from this folder.
  if [ -d "$SRC/.git" ]; then
    say "Getting the newest code"
    before=$(git -C "$SRC" rev-parse HEAD)
    git -C "$SRC" pull --ff-only || echo "Could not pull (no internet or local changes). Building what is here."
    # If this script itself changed, run the new copy.
    [ "$(git -C "$SRC" rev-parse HEAD)" = "$before" ] || exec "$SRC/install.sh" "$@"
  fi
  say "Installing build tools (asks for your password, first time only)"
  # shellcheck disable=SC2086
  sudo apt-get install -y --no-install-recommends $BUILD_DEPS
  say "Building Aerie"
  rm -f "$SRC"/dist/aerie_*.deb
  "$SRC/tools/build-deb.sh"
  say "Installing Aerie"
  sudo apt-get install -y --reinstall "$(ls "$SRC"/dist/aerie_*.deb)"
fi

say "Starting Aerie"
aerie --quit 2>/dev/null || true
sleep 1
(setsid aerie >/dev/null 2>&1 &)

echo
echo "Done! Aerie is now your live wallpaper. It opened with the Customize panel;"
echo "click Done and it settles behind your windows. Find it in your app list and the COSMIC Store."
echo "Update:    COSMIC Store → Updates, or Aerie → Settings → Check for updates"
echo "Uninstall: Settings → Uninstall Aerie, the COSMIC Store, or ./install.sh --uninstall"
