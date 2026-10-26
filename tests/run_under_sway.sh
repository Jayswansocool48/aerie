#!/usr/bin/env bash
# Starts a headless sway, runs Aerie in it and takes screenshots (used by the Checks workflow).
set -u
OUT="$PWD/shots"
mkdir -p "$OUT" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
export HOME="$PWD/build/home"
unset XDG_CONFIG_HOME XDG_DATA_HOME XDG_CACHE_HOME  # GitHub sets these; use the test home
export AERIE_DEBUG_KEYS=1  # pages report which keys reach them
mkdir -p "$HOME/.config/aerie"
LOG="$OUT/run.log"
: > "$LOG"
say() { echo "== $*" | tee -a "$LOG"; }

cat > /tmp/sway.conf <<'EOF'
output HEADLESS-1 resolution 1600x900 position 0,0
default_border none
EOF

eval "$(dbus-launch --sh-syntax)"
sway -c /tmp/sway.conf --unsupported-gpu >"$OUT/sway.log" 2>&1 &
for _ in $(seq 40); do
  WAYLAND_DISPLAY=$(ls "$XDG_RUNTIME_DIR" 2>/dev/null | grep -m1 '^wayland-[0-9]*$') && [ -n "$WAYLAND_DISPLAY" ] && break
  sleep 0.5
done
export WAYLAND_DISPLAY
say "sway is on $WAYLAND_DISPLAY"
swaymsg -t get_outputs | head -5 >>"$LOG" 2>&1

# a test scene in the library, so the wallpaper is a Blender-style 3D scene
python3 tests/make_test_scene.py /tmp/test-scene.glb >>"$LOG"

shot() { sleep "${2:-4}"; grim "$OUT/$1.png" && say "screenshot $1"; }
# wtype's virtual keyboard loses the first key of each command (it sends a new keymap first),
# so start every command with a harmless Shift press
key() { wtype -k Shift_L -s 300 -k "$1"; }
typ() { wtype -k Shift_L -s 300 -d 60 "$1"; }

say "starting Aerie"
bin/aerie --background >"$OUT/aerie.out" 2>&1 &
AERIE=$!
sleep 12
shot desktop 2
if grep -q "layer-shell: True" "$HOME/.cache/aerie.log" 2>/dev/null; then say "on the desktop layer"; else say "FAIL: not on the desktop layer"; fi

say "importing the test scene"
python3 - <<'EOF' >>"$LOG" 2>&1
import json, os, sys
sys.path.insert(0, os.getcwd())
from aerie import wallpapers
item = wallpapers.import_path("/tmp/test-scene.glb")
cfg_file = os.path.expanduser("~/.config/aerie/config.json")
cfg = json.load(open(cfg_file)) if os.path.exists(cfg_file) else {}
cfg["wallpaper"] = {"type": "library", "id": item["id"]}
json.dump(cfg, open(cfg_file, "w"))
print("imported", item["id"])
EOF
bin/aerie --quit
for _ in $(seq 20); do kill -0 "$AERIE" 2>/dev/null || break; sleep 0.5; done
if kill -0 "$AERIE" 2>/dev/null; then say "FAIL: --quit didn't stop Aerie"; kill "$AERIE"; sleep 2; else say "Aerie quit"; fi
bin/aerie --background >>"$OUT/aerie.out" 2>&1 &
AERIE=$!
sleep 12
shot desktop-scene 2

say "opening the hub"
bin/aerie --hub >>"$OUT/aerie.out" 2>&1
shot hub 3
bin/aerie --hub --tab=wallpaper >>"$OUT/aerie.out" 2>&1
shot hub-wallpaper 3
bin/aerie --hub --tab=stats >>"$OUT/aerie.out" 2>&1
shot hub-stats 3
bin/aerie --hub --tab=apps >>"$OUT/aerie.out" 2>&1; sleep 3
typ "vim"; sleep 2
shot hub-apps 1
key Escape; sleep 3
grep "hub says\|hub active" "$HOME/.cache/aerie.log" | tail -6 >>"$LOG"
grep -q "hub says: close" "$HOME/.cache/aerie.log" && say "Esc closed the hub" || say "FAIL: Esc didn't close the hub"
shot hub-closed 1

say "opening Aerie Studio"
bin/aerie --studio >>"$OUT/aerie.out" 2>&1
shot studio 6
bin/aerie --studio --page=lock >>"$OUT/aerie.out" 2>&1
shot studio-lock 4
swaymsg kill >/dev/null 2>&1

say "locking the screen (as a test user with a password)"
echo "$(id -un):aerie-test-pw" | sudo chpasswd
sudo install -m 644 data/pam/aerie-lock /etc/pam.d/aerie-lock
bin/aerie-lock --now >"$OUT/lock.out" 2>&1 &
LOCK=$!
shot locked 8
if grep -q " locked$" "$HOME/.cache/aerie-lock.log" 2>/dev/null; then say "the screen locked"; else say "FAIL: the screen did not lock"; fi
typ "wrong-password"; sleep 0.5; key Return
shot wrong-password 4
grep -c "page says: key" "$HOME/.cache/aerie-lock.log" | sed "s/^/keys that reached the lock screen: /" >>"$LOG"; grep "page says" "$HOME/.cache/aerie-lock.log" | tail -4 >>"$LOG"
for _ in $(seq 30); do grep -q "wrong password" "$HOME/.cache/aerie-lock.log" && break; sleep 0.5; done
typ "aerie-test-pw"; sleep 0.5; key Return
for _ in $(seq 40); do kill -0 "$LOCK" 2>/dev/null || break; sleep 0.5; done
if grep -q "wrong password" "$HOME/.cache/aerie-lock.log" 2>/dev/null; then say "a wrong password was refused"; else say "FAIL: the wrong password wasn't refused"; fi
if kill -0 "$LOCK" 2>/dev/null; then say "FAIL: still locked after the right password"; elif grep -q "^.* unlocked$" "$HOME/.cache/aerie-lock.log"; then say "unlocked with the right password"; else say "FAIL: the lock screen quit without unlocking"; fi
shot unlocked 1

bin/aerie --quit
sleep 2
kill "$AERIE" 2>/dev/null
cp "$HOME/.cache/aerie.log" "$OUT/aerie.log" 2>/dev/null
cp "$HOME/.cache/aerie-lock.log" "$OUT/aerie-lock.log" 2>/dev/null
say "done"
grep -q "FAIL" "$LOG" && exit 1
ls "$OUT"/*.png >/dev/null 2>&1 || { echo "no screenshots"; exit 1; }
exit 0
