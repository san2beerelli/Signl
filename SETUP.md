# Setup Guide

This document lists all external prerequisites required for each device backend, and how to verify they're installed correctly.

## Quick Start (macOS)

If you only need iOS Simulator support (most common dev use case):

```bash
# 1. Ensure Xcode is installed with command line tools
xcode-select --install

# 2. Install dependencies
pnpm install

# 3. Run the app
pnpm dev
```

---

## iOS Simulator (Step 4)

**Prerequisites:**
- macOS (required)
- Xcode installed from App Store
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

---

## iOS Physical Device (Step 10)

**Prerequisites:**
- macOS (required)
- Homebrew
- libimobiledevice tools
- Developer disk image for target iOS version

**Installation:**
```bash
# Install libimobiledevice suite
brew install libimobiledevice

# This installs:
# - idevice_id: list connected devices
# - ideviceinfo: get device info
# - ideviceimagemounter: mount developer disk images
# - idevicelocation: set device location (may need separate install)

# If idevicelocation is not included, install separately:
brew install idevicelocation
# Or build from source: https://github.com/libimobiledevice/libimobiledevice
```

**Developer Disk Image:**
To simulate location on physical iOS devices, the Developer Disk Image must be mounted. This image ships with Xcode and must match the iOS version on the device.

Location of disk images:
```
/Applications/Xcode.app/Contents/Developer/Platforms/iPhoneOS.platform/DeviceSupport/<iOS Version>/
```

The app will attempt to mount this automatically, but you may need to unlock your device and trust the computer first.

**Verification:**
```bash
# List connected iOS devices
idevice_id -l

# Should output UDIDs like:
# 00008110-001234567890001E

# Get device info
ideviceinfo -u <UDID>

# Check idevicelocation is available
idevicelocation --help
```

**Troubleshooting:**
- "Could not connect to lockdownd": Unlock the device and tap "Trust" when prompted
- "No device found": Check USB connection, try different cable/port
- iOS 17+ may require additional configuration due to new security model

---

## Android Emulator (Step 9)

**Prerequisites:**
- Android SDK (via Android Studio or standalone)
- Platform-tools (`adb`)
- At least one Android Virtual Device (AVD) created

**Installation:**

Option A: Android Studio (recommended):
1. Download from https://developer.android.com/studio
2. Install and run Android Studio Setup Wizard
3. SDK and platform-tools are installed automatically

Option B: Command-line only:
```bash
# macOS with Homebrew
brew install --cask android-platform-tools

# Or download from Google:
# https://developer.android.com/studio/releases/platform-tools
```

**Environment Setup:**
Add to your shell profile (`~/.zshrc` or `~/.bashrc`):
```bash
export ANDROID_HOME=$HOME/Library/Android/sdk
export PATH=$PATH:$ANDROID_HOME/platform-tools
export PATH=$PATH:$ANDROID_HOME/emulator
```

**Verification:**
```bash
# Check adb is available
adb version
# Expected: Android Debug Bridge version 1.0.41 (or similar)

# List devices (will show emulator-5554 etc. when emulator running)
adb devices

# Check emulator is available
emulator -list-avds
# Should list your AVDs

# Start an emulator
emulator -avd <avd_name> &
```

**Testing location simulation manually:**
```bash
# Connect to emulator telnet console
# (emulator-5554 uses port 5554)
telnet localhost 5554

# In telnet session:
auth <auth_token>  # Token is in ~/.emulator_console_auth_token
geo fix -122.4194 37.7749  # lng lat (note: longitude first!)
quit
```

---

## Android Physical Device (Step 10)

**Prerequisites:**
- Android SDK platform-tools (`adb`)
- USB debugging enabled on device
- "Allow mock locations" enabled in developer options (for some methods)

**Device Setup:**
1. Go to Settings → About Phone
2. Tap "Build number" 7 times to enable Developer Options
3. Go to Settings → Developer Options
4. Enable "USB debugging"
5. (Optional) Enable "Allow mock locations"

**Verification:**
```bash
# Connect device via USB
adb devices
# Should show your device serial number

# Check device is authorized
# If it shows "unauthorized", check device screen for authorization prompt

# Test shell access
adb shell whoami
```

**Wireless ADB (optional):**
```bash
# Connect via USB first, then:
adb tcpip 5555
adb connect <device_ip>:5555

# Now you can unplug USB
```

---

## Browser / CDP (Step 11)

**Prerequisites:**
- None for embedded mode (uses Electron's built-in Chromium)
- Google Chrome for external mode (optional, future feature)

**Verification:**
The embedded browser backend works out of the box since Electron includes Chromium. No external setup required.

For external Chrome control (future):
```bash
# Check Chrome is installed
ls "/Applications/Google Chrome.app"

# Or on Linux:
which google-chrome
```

---

## Verification Script

Run this to check all prerequisites at once:

```bash
#!/bin/bash
echo "=== LocationSimulator Prerequisites Check ==="
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
    echo "  ✗ idevicelocation not found"
fi
echo ""

echo "Android:"
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

echo "pnpm:"
if command -v pnpm &> /dev/null; then
    echo "  ✓ $(pnpm --version)"
else
    echo "  ✗ pnpm not found (corepack enable && corepack prepare pnpm@latest --activate)"
fi
```

Save as `check-prereqs.sh` and run with `bash check-prereqs.sh`.

---

## Troubleshooting Common Issues

### "xcrun: error: unable to find utility"
Xcode command line tools not installed. Run: `xcode-select --install`

### "adb: command not found"
Android platform-tools not in PATH. Add to `~/.zshrc`:
```bash
export PATH=$PATH:$HOME/Library/Android/sdk/platform-tools
```

### iOS Simulator location not changing
- Make sure the simulator is booted
- Try `xcrun simctl location <udid> clear` first
- Some older Xcode versions have location simulation bugs

### Android emulator geo fix not working
- Make sure you're connected to the telnet console, not ADB shell
- The auth token is required in recent Android emulator versions
- Check `~/.emulator_console_auth_token` for the token

### Physical iOS device shows "pair_record" errors
The device hasn't been trusted. Unlock the device, unplug and replug the USB cable, then tap "Trust" when prompted.
