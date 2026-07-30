# Setup Guide

This document lists the external CLI prerequisites for each device backend and how to verify them. See [README.md](./README.md) for which backends are actually implemented — installing a backend's tools doesn't help if the backend itself is still a stub.

The app's own **Environment Check** panel (Settings button on the left rail) checks most of these for you and now includes step-by-step install instructions per tool — it's the easiest way to verify your setup without leaving the app.

## Quick Start (macOS)

If you only need iOS Simulator support (the most common dev use case, and the only backend with zero manual setup beyond Xcode):

```bash
# 1. Ensure Xcode is installed with command line tools
xcode-select --install

# 2. Install dependencies
npm install

# 3. Run the app
npm run dev
```

---

## iOS Simulator — ✅ implemented

**Prerequisites:**
- macOS (required)
- Xcode installed from the App Store
- Xcode Command Line Tools

**Installation:**
```bash
# Install command line tools if not already installed
xcode-select --install

# Accept Xcode license (run once after installing/updating Xcode)
sudo xcodebuild -license accept
```

**Verification:**
```bash
# Check simctl is available
xcrun simctl help

# List available simulators (should show device types and runtimes)
xcrun simctl list devices

# Check location simulation commands exist
xcrun simctl location --help
```

**Expected output:**
```
Usage: simctl location <device> <subcommand>
Subcommands:
    clear    Stop spoofing device location
    set      Set the location of a device
    start    Start location simulation
    stop     Stop location simulation
```

Only latitude/longitude are supported — `simctl` has no altitude/speed/heading/accuracy fields, and the app reports that accurately rather than pretending otherwise.

---

## iOS Physical Device — ✅ implemented (discovery + best-effort set location)

**Prerequisites:**
- macOS (required)
- Homebrew
- `libimobiledevice` (for discovery: `idevice_id`, `ideviceinfo`)
- `idevicelocation` (for setting location — **not available via Homebrew**, must be built from source)

**Installation:**
```bash
# Discovery tools
brew install libimobiledevice

# idevicelocation has no Homebrew formula. Build it from source:
git clone https://github.com/JonGabilondo-morphmo/idevicelocation
cd idevicelocation
make
# Then move the built binary onto your PATH, e.g.:
#   cp idevicelocation /opt/homebrew/bin/   (Apple Silicon)
#   cp idevicelocation /usr/local/bin/      (Intel)
```

**Important limitation — read before relying on this:**
Setting location on a physical device works by running `idevicelocation`, which mounts the *developer disk image* matching the device's exact iOS version and talks to a debug service through it — the app doesn't do any disk-image mounting itself, `idevicelocation` handles that internally. On **iOS 17 and later**, Apple only issues *personalized* developer disk images through an active Xcode device-pairing session, so there's no static `.dmg` for a standalone CLI tool to mount. In practice this means:
- Older iOS versions: has a real chance of working.
- iOS 17+: `setLocation` will likely fail with a mount/connection error even with everything above installed correctly. This is an OS-level constraint, not a bug in this app or in `idevicelocation`.

**Verification:**
```bash
# List connected iOS devices
idevice_id -l
# Should output a UDID like: 00008110-001234567890001E

# Get device info
ideviceinfo -u <UDID>

# Check idevicelocation is available
idevicelocation --help
```

**Trust:** the first time you connect a device, unlock it and tap "Trust This Computer?" when prompted, then enter your passcode. Until that's confirmed, the app will still list the device (from `idevice_id -l`) but show it in an error state, since `ideviceinfo`/`idevicelocation` can't reach an untrusted device.

**Troubleshooting:**
- "Could not connect to lockdownd": unlock the device and tap "Trust" when prompted.
- "No device found": check the USB connection, try a different cable/port.
- Mount/developer-disk-image errors on iOS 17+: see the limitation above — there is currently no CLI-only fix for this.

---

## Android Emulator — ❌ not yet implemented

The `adb`/telnet commands below are real and useful for testing outside the app, but `androidEmulator.ts` is currently a stub — the app's discovery and location control don't do anything with an emulator yet.

**Prerequisites:**
- Android SDK (via Android Studio or standalone)
- Platform-tools (`adb`)
- At least one Android Virtual Device (AVD) created

**Installation:**

Option A — Android Studio (recommended): download from https://developer.android.com/studio, run the setup wizard; SDK and platform-tools install automatically.

Option B — command-line only:
```bash
brew install --cask android-platform-tools
# or download from https://developer.android.com/studio/releases/platform-tools
```

**Environment setup** — add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/emulator
```

**Verification:**
```bash
adb version
adb devices                 # shows emulator-5554 etc. once an emulator is running
emulator -list-avds
emulator -avd <avd_name> &
```

**Setting location manually (outside the app, for now):**
```bash
telnet localhost 5554       # emulator-5554 uses port 5554
# in the telnet session:
auth <auth_token>           # token is in ~/.emulator_console_auth_token
geo fix -122.4194 37.7749   # longitude first, then latitude
quit
```

---

## Android Physical Device — ❌ not yet implemented

Same caveat as the emulator: `androidDevice.ts` is a stub, so the app doesn't act on any of this yet.

**Prerequisites:**
- Android SDK platform-tools (`adb`)
- USB debugging enabled on the device

**Device setup:**
1. Settings → About Phone → tap "Build number" 7 times to enable Developer Options
2. Settings → Developer Options → enable "USB debugging"

**Verification:**
```bash
adb devices          # should show your device serial number; "unauthorized" means
                      # check the device screen for the authorization prompt
adb shell whoami
```

**Wireless ADB (optional):**
```bash
adb tcpip 5555
adb connect <device_ip>:5555   # can unplug USB after this
```

---

## Browser (Chromium-based) — ✅ implemented

No CLI tools required — this backend talks to browsers over the Chrome DevTools Protocol (CDP), not a command-line tool.

- **Embedded mode**: this app's own window is a CDP target. Works out of the box, nothing to install.
- **External mode**: the app can launch or adopt Google Chrome, Microsoft Edge, Brave, Arc, Chromium, Vivaldi, or Opera with remote debugging enabled, from the Browsers panel's Connect button. Just having the browser installed in `/Applications` is enough — the app manages the debug port itself.

**Verification (optional, only useful for manual debugging):**
```bash
ls "/Applications/Google Chrome.app"   # or Edge/Brave/Arc/Chromium/Vivaldi/Opera
```

---

## Verification Script

```bash
#!/bin/bash
echo "=== Signl Prerequisites Check ==="
echo ""

echo "iOS Simulator:"
if command -v xcrun &> /dev/null; then
    echo "  ✓ xcrun found"
    xcrun simctl list devices 2>/dev/null | head -5
else
    echo "  ✗ xcrun not found (install Xcode)"
fi
echo ""

echo "iOS Device (libimobiledevice):"
if command -v idevice_id &> /dev/null; then
    echo "  ✓ idevice_id found"
else
    echo "  ✗ idevice_id not found (brew install libimobiledevice)"
fi
if command -v idevicelocation &> /dev/null; then
    echo "  ✓ idevicelocation found"
else
    echo "  ✗ idevicelocation not found (must be built from source, see above)"
fi
echo ""

echo "Android (not yet used by the app — informational only):"
if command -v adb &> /dev/null; then
    echo "  ✓ adb found: $(adb version | head -1)"
else
    echo "  ✗ adb not found (install Android SDK platform-tools)"
fi
if [ -n "$ANDROID_HOME" ]; then
    echo "  ✓ ANDROID_HOME set: $ANDROID_HOME"
else
    echo "  ⚠ ANDROID_HOME not set"
fi
echo ""

echo "Node.js:"
echo "  $(node --version)"
echo ""

echo "npm:"
if command -v npm &> /dev/null; then
    echo "  ✓ $(npm --version)"
else
    echo "  ✗ npm not found"
fi
```

Save as `check-prereqs.sh` and run with `bash check-prereqs.sh`.

---

## Troubleshooting Common Issues

### "xcrun: error: unable to find utility"
Xcode command line tools not installed. Run: `xcode-select --install`

### "adb: command not found"
Android platform-tools not on PATH. Add to `~/.zshrc`:
```bash
export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
```

### iOS Simulator location not changing
- Make sure the simulator is booted.
- Try `xcrun simctl location <udid> clear` first.
- Some older Xcode versions have location simulation bugs.

### Physical iOS device shows "pair_record" errors
The device hasn't been trusted. Unlock the device, unplug and replug the USB cable, then tap "Trust" when prompted.

### Physical iOS device `setLocation` fails with a mount/developer-disk-image error
Expected on iOS 17+ — see the limitation under **iOS Physical Device** above. There is currently no CLI-only fix.

### Android emulator `geo fix` not working
- Make sure you're connected to the telnet console, not `adb shell`.
- The auth token is required in recent emulator versions — check `~/.emulator_console_auth_token`.
