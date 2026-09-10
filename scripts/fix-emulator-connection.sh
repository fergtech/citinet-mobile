#!/usr/bin/env bash
# Fixes the Android emulator dev client getting stuck on
# "Loading from <LAN IP>:8081..." forever instead of reaching Metro.
#
# Root cause: the dev client remembers whatever bundler URL it last
# connected through. If that was a LAN address (e.g. 10.0.0.188:8081) and
# the emulator's virtual network can't reach it this session, it just hangs
# retrying that same address with no error. `adb reverse` (which maps the
# emulator's own localhost:8081 to this machine's localhost:8081) fixes the
# path, but the client still needs to be told to use localhost — this script
# does both: sets up the tunnel, then force-relaunches the app via a deep
# link that points it at localhost:8081 explicitly.
#
# `adb reverse` is NOT persistent — it's tied to the current adb connection
# and is wiped on emulator cold boot / `adb kill-server` / a reboot. Re-run
# this script any time the "Loading from 10.x.x.x:8081..." hang shows up
# again after a fresh `expo start`.
#
# Usage: ./scripts/fix-emulator-connection.sh [device-id]
#   device-id defaults to the first device `adb devices` reports (fine for
#   a single running emulator, e.g. emulator-5554).

set -euo pipefail
cd "$(dirname "$0")/.."

PORT=8081
SCHEME=$(grep -m1 '"scheme"' app.json | sed -E 's/.*"scheme"\s*:\s*"([^"]+)".*/\1/')
PACKAGE=$(grep -m1 '"package"' app.json | sed -E 's/.*"package"\s*:\s*"([^"]+)".*/\1/')

if [ -z "$SCHEME" ] || [ -z "$PACKAGE" ]; then
  echo "Couldn't read scheme/package from app.json — check it hasn't changed shape." >&2
  exit 1
fi

DEVICE="${1:-$(adb devices | awk 'NR==2{print $1}')}"
if [ -z "$DEVICE" ]; then
  echo "No adb device/emulator found — start the emulator first." >&2
  exit 1
fi

echo "Device:  $DEVICE"
echo "Package: $PACKAGE"
echo "Scheme:  $SCHEME"

echo "→ Tunneling emulator's localhost:$PORT to this machine's Metro server..."
adb -s "$DEVICE" reverse "tcp:$PORT" "tcp:$PORT"

echo "→ Force-stopping the app..."
adb -s "$DEVICE" shell am force-stop "$PACKAGE"

echo "→ Relaunching, pointed at localhost:$PORT..."
adb -s "$DEVICE" shell am start -a android.intent.action.VIEW \
  -d "${SCHEME}://expo-development-client/?url=http%3A%2F%2Flocalhost%3A${PORT}"

echo "Done. Make sure 'npx expo start' is running, then check the emulator."
