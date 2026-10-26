#!/usr/bin/env bash
# Builds dist/aerie_<version>_<arch>.deb for Pop!_OS 24.04 (COSMIC).
#
# Pop!_OS 24.04 doesn't ship gtk4-layer-shell (the library that lets Aerie sit on the
# desktop as a live wallpaper), so a private copy is built and bundled in /usr/lib/aerie/lib.
# Needs: meson ninja-build gcc libgtk-4-dev libwayland-dev wayland-protocols
#        gobject-introspection libgirepository1.0-dev dpkg-dev git
set -euo pipefail

SRC=$(cd "$(dirname "$0")/.." && pwd)
LAYER_SHELL_TAG=v1.3.0
LAYER_SHELL_COMMIT=1c963c51514581c41b9bdae08cdf69171265cdda
VERSION=$(python3 -c "import sys; sys.path.insert(0, '$SRC'); import aerie; print(aerie.__version__)")
APP_ID=$(python3 -c "import sys; sys.path.insert(0, '$SRC'); import aerie; print(aerie.APP_ID)")
ARCH=$(dpkg --print-architecture)
WORK="$SRC/build"
mkdir -p "$WORK" "$SRC/dist"

# ---- gtk4-layer-shell (cached between builds) ------------------------------
LS_PREFIX="$WORK/layer-shell-$LAYER_SHELL_TAG"
if [ ! -f "$LS_PREFIX/lib/libgtk4-layer-shell.so.0" ]; then
  echo "==> Building gtk4-layer-shell $LAYER_SHELL_TAG"
  rm -rf "$WORK/gtk4-layer-shell"
  git clone --quiet --depth 1 --branch "$LAYER_SHELL_TAG" https://github.com/wmww/gtk4-layer-shell.git "$WORK/gtk4-layer-shell"
  [ "$(git -C "$WORK/gtk4-layer-shell" rev-parse HEAD)" = "$LAYER_SHELL_COMMIT" ] \
    || { echo "gtk4-layer-shell $LAYER_SHELL_TAG is not the expected commit"; exit 1; }
  meson setup "$WORK/gtk4-layer-shell/_build" "$WORK/gtk4-layer-shell" \
    --prefix="$LS_PREFIX" --libdir=lib --buildtype=release \
    -Dexamples=false -Ddocs=false -Dtests=false -Dsmoke-tests=false -Dvapi=false -Dintrospection=true
  ninja -C "$WORK/gtk4-layer-shell/_build" install >/dev/null
fi

# ---- package tree ----------------------------------------------------------
echo "==> Assembling aerie $VERSION"
PKG="$WORK/pkg"
rm -rf "$PKG"
LIB="$PKG/usr/lib/aerie"
mkdir -p "$LIB/lib/girepository-1.0" "$LIB/bin" "$PKG/usr/bin" "$PKG/DEBIAN" \
  "$PKG/usr/share/applications" "$PKG/usr/share/metainfo" \
  "$PKG/usr/share/icons/hicolor/scalable/apps" "$PKG/usr/share/doc/aerie"

cp -r "$SRC/aerie" "$SRC/web" "$LIB/"
find "$LIB" -name __pycache__ -prune -exec rm -rf {} +
install -m 755 "$SRC/bin/aerie" "$SRC/bin/aerie-lock" "$SRC/bin/aerie-system" "$SRC/bin/cosmic-greeter-wrapper" "$LIB/bin/"
ln -s ../lib/aerie/bin/aerie "$PKG/usr/bin/aerie"
ln -s ../lib/aerie/bin/aerie-lock "$PKG/usr/bin/aerie-lock"
# the lock screen checks your password the way logging in does
mkdir -p "$PKG/etc/pam.d" "$PKG/usr/share/polkit-1/actions"
install -m 644 "$SRC/data/pam/aerie-lock" "$PKG/etc/pam.d/aerie-lock"
install -m 644 "$SRC/data/$APP_ID.policy" "$PKG/usr/share/polkit-1/actions/"

cp -P "$LS_PREFIX"/lib/libgtk4-layer-shell.so.* "$LIB/lib/"
cp "$LS_PREFIX"/lib/girepository-1.0/Gtk4LayerShell-1.0.typelib "$LIB/lib/girepository-1.0/"
cp "$LS_PREFIX"/lib/girepository-1.0/Gtk4SessionLock-1.0.typelib "$LIB/lib/girepository-1.0/"
strip --strip-unneeded "$LIB"/lib/libgtk4-layer-shell.so.*.* 2>/dev/null || true

install -m 644 "$SRC/data/$APP_ID.desktop" "$PKG/usr/share/applications/"
install -m 644 "$SRC/data/$APP_ID.metainfo.xml" "$PKG/usr/share/metainfo/"
install -m 644 "$SRC/data/$APP_ID.svg" "$PKG/usr/share/icons/hicolor/scalable/apps/"
install -m 644 "$SRC/LICENSE" "$SRC/PRIVACY.md" "$SRC/TERMS.md" "$PKG/usr/share/doc/aerie/"
install -m 644 "$SRC/web/vendor/THREE-LICENSE" "$PKG/usr/share/doc/aerie/"
install -m 644 "$SRC/tools/GTK4-LAYER-SHELL-LICENSE" "$PKG/usr/share/doc/aerie/"
install -m 644 "$SRC/web/fonts/Outfit-OFL.txt" "$SRC/web/fonts/DelaGothicOne-OFL.txt" "$SRC/web/vendor/DRACO-LICENSE" "$PKG/usr/share/doc/aerie/"

# COSMIC Store listing: the store reads app catalogs from /usr/share/swcatalog and matches
# them to installed packages by <pkgname>, so Aerie shows up there once installed.
mkdir -p "$PKG/usr/share/swcatalog/xml"
python3 "$SRC/tools/make-catalog.py" "$SRC/data/$APP_ID.metainfo.xml" aerie \
  | gzip -9n > "$PKG/usr/share/swcatalog/xml/aerie.xml.gz"

SIZE=$(du -sk "$PKG/usr" | cut -f1)
cat > "$PKG/DEBIAN/control" <<EOF
Package: aerie
Version: $VERSION
Section: x11
Priority: optional
Architecture: $ARCH
Installed-Size: $SIZE
Depends: python3 (>= 3.10), python3-gi, gir1.2-gtk-4.0, gir1.2-webkit-6.0, libgtk-4-1, libwayland-client0, libglib2.0-bin, libpam0g, policykit-1 | pkexec
Recommends: wl-clipboard, gstreamer1.0-libav, gstreamer1.0-plugins-good, gstreamer1.0-plugins-bad
Conflicts: deskscape
Replaces: deskscape
Provides: deskscape
Maintainer: Jayswansocool48 <Jayswansocool48@users.noreply.github.com>
Homepage: https://github.com/Jayswansocool48/aerie
Description: Live wallpapers for Pop!_OS COSMIC, like Wallpaper Engine
 Aerie plays live wallpapers on the COSMIC desktop and lock screen: 3D scenes
 made in Blender, videos, pictures, web pages and Wallpaper Engine wallpapers
 (from the Steam Workshop or a folder). A hub drops down from the top of the
 screen with quick controls, stats, clipboard history, apps and wallpapers, and
 Aerie Studio holds your library and every setting. Formerly Deskscape.
EOF

# Before removal: put COSMIC's own lock screen back if Aerie's switch is on.
cat > "$PKG/DEBIAN/prerm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
  /usr/lib/aerie/bin/aerie-system lockscreen-off >/dev/null 2>&1 || true
fi
EOF
# When the package is purged, also remove the update source it added.
cat > "$PKG/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "purge" ]; then
  rm -f /etc/apt/sources.list.d/aerie.sources /usr/share/keyrings/aerie.gpg
fi
EOF
cat > "$PKG/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
# Aerie was called Deskscape: drop that name's old update source, Aerie has its own.
rm -f /etc/apt/sources.list.d/deskscape.sources /usr/share/keyrings/deskscape.gpg
command -v update-desktop-database >/dev/null && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true
EOF
printf '/etc/pam.d/aerie-lock\n' > "$PKG/DEBIAN/conffiles"
chmod 755 "$PKG/DEBIAN/postrm" "$PKG/DEBIAN/postinst" "$PKG/DEBIAN/prerm"

OUT="$SRC/dist/aerie_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$PKG" "$OUT" >/dev/null
echo "==> Built $OUT"
