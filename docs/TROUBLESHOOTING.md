# Troubleshooting

## Notifications don't appear (most common on Intel Macs)

Atelier is distributed without an Apple Developer certificate (ad-hoc signed).
macOS ties notification permission to the app's code signature, which makes
the registration more fragile than for App Store apps. Work through these
steps in order; after each one, use **Settings → Send test notification**
inside Atelier to check.

### 1. Check System Settings

Open **System Settings → Notifications** and look for **Atelier**:

- **Listed but turned off** → turn "Allow notifications" on. Done.
- **Listed and on, still nothing** → check the _style_ is "Banners" or
  "Alerts" (not "None"), and that Focus/Do Not Disturb is off.
- **Not listed at all** → the app never managed to register; continue below.

### 2. Launch from /Applications, not from the DMG

If the app was ever run directly from the mounted DMG image, macOS may have
bound its notification registration to that temporary path. Make sure the app
is copied to `/Applications`, eject the DMG, and launch it from there.

### 3. Reset the notification registration

Quit Atelier (tray icon → Quit), then in Terminal:

```bash
killall usernoted 2>/dev/null; killall NotificationCenter 2>/dev/null
```

Relaunch Atelier from `/Applications` and send a test notification. macOS may
show a fresh permission prompt — accept it.

### 4. Reset the Launch Services registration (stale duplicate entries)

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -f /Applications/Atelier.app
```

Then repeat step 3.

### 5. Watch the logs

Run the app from a terminal — since v0.5.3 it warns when macOS silently
swallows a notification:

```bash
/Applications/Atelier.app/Contents/MacOS/Atelier
```

Look for `[notifications] 'show' never fired`. For the system side, in a
second terminal:

```bash
log stream --predicate 'process == "usernoted" OR subsystem CONTAINS "usernotifications"' --info
```

then trigger the test notification and look for lines mentioning
`com.atelier.inditex-tracker`, "code signature" or "bundle".

### 6. Reinstall clean

Delete `/Applications/Atelier.app`, empty the Trash, install the latest DMG
from [Releases](https://github.com/asilfndk/inditex-tracker/releases/latest),
launch from `/Applications`, accept the permission prompt.

> **Note on updates:** before v0.5.3 every update changed the app's ad-hoc
> code-signature hash, which made macOS treat Atelier as a brand-new app and
> silently drop its notification permission — the usual reason notifications
> "stopped working" on machines that update often. Since v0.5.3 the signature
> carries a stable designated requirement, so the permission survives updates.
> One last manual re-grant (steps 1–3) may be needed when coming from an older
> version.
