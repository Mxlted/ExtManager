# ExtManager

A Chromium extension for quickly managing other extensions — toggle them on/off, group them into profiles, and bulk-enable/disable without ever leaving the toolbar.

## Features

- **One-click toggles** for every installed extension from a popup
- **Profiles** — save sets of enabled extensions (e.g., "Work", "Dev", "Gaming") and apply one with a click
- **Bulk actions** — enable all, disable all, or invert, with an inline **Undo** for 8 seconds after the action
- **Pin** favorites to the top of the list
- **Lock** an extension to exempt it from bulk Enable All / Disable All / Toggle-all (profiles still override the lock, since a profile is an explicit per-extension decision)
- **Search & sort** (name, enabled first, disabled first, recently toggled)
- **Smart toggle-all** — when re-enabling, restores the snapshot of what was on before, so you don't accidentally turn on extensions you'd already disabled manually
- **Keyboard shortcuts** (configurable at `chrome://extensions/shortcuts`):
  - `Ctrl+Shift+M` — open popup
  - `Ctrl+Shift+E` — toggle all on/off
- **Badge counter** showing how many extensions are currently active
- **Import / export** profiles as JSON
- **Light / dark theme** following system preference

## Install (unpacked)

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Pin the ExtManager icon to your toolbar

## Files

- `manifest.json` — MV3 manifest
- `popup.html/css/js` — toolbar popup
- `options.html/css/js` — full-page manager (right-click icon → Options)
- `background.js` — service worker handling shortcuts & badge
- `icons/` — toolbar icons

## Permissions

- `management` — required to enumerate and toggle other extensions
- `storage` — for profiles and settings
- `notifications` — small popup confirmations for keyboard shortcut actions

No host permissions are requested. ExtManager never touches page contents.
