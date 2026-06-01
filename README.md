# ExtManager

ExtManager is a Manifest V3 Chromium extension for managing installed extensions from one place. It lets you quickly turn extensions on or off, save extension profiles, run bulk actions, and see how many extensions are currently enabled.

## Features

* Toggle installed extensions from the toolbar popup
* Save and apply extension profiles
* Enable all, disable all, or invert extension states
* Undo recent bulk actions for a short time
* Pin important extensions to the top
* Lock extensions so bulk actions skip them
* Search and sort extensions
* Restore the previous enabled state when using smart toggle all
* View an active extension count in the toolbar badge
* Import and export profiles as JSON
* Use light or dark mode based on your system theme

## Keyboard shortcuts

Shortcuts can be changed at `chrome://extensions/shortcuts`.

| Shortcut       | Action                   |
| -------------- | ------------------------ |
| `Ctrl+Shift+M` | Open ExtManager          |
| `Ctrl+Shift+E` | Toggle all extensions    |
| `Shift+Esc`    | Open Chrome Task Manager |

Chrome does not provide a normal extension API for opening the native Task Manager directly or reading per extension CPU and memory usage. ExtManager includes the Task Manager shortcut as a reminder so you can check extension resource usage with Chrome’s built in tool.

## Install

1. Open `chrome://extensions`
2. Turn on Developer mode
3. Select Load unpacked
4. Choose the ExtManager folder
5. Pin ExtManager to the toolbar

## Project files

| File                                        | Purpose                                        |
| ------------------------------------------- | ---------------------------------------------- |
| `manifest.json`                             | Extension manifest                             |
| `popup.html`, `popup.css`, `popup.js`       | Toolbar popup                                  |
| `options.html`, `options.css`, `options.js` | Full manager page                              |
| `background.js`                             | Service worker for shortcuts and badge updates |
| `icons/`                                    | Extension icons                                |

## Permissions

ExtManager requests only the permissions it needs.

| Permission      | Reason                                                             |
| --------------- | ------------------------------------------------------------------ |
| `management`    | Lists extensions and changes their enabled state                   |
| `storage`       | Saves profiles, settings, pinned extensions, and locked extensions |
| `notifications` | Shows small confirmations for shortcut actions                     |

ExtManager does not request host permissions, does not inject content scripts, and does not read page content.

## Notes

Profiles are treated as explicit saved states. Applying a profile can change locked extensions because the profile is considered an intentional user action.

Bulk actions skip locked extensions. This includes enable all, disable all, invert, smart toggle all, and undo.
