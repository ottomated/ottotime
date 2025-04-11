# Ottotime

Automatic time tracking powered by git.

![Graph example](https://raw.githubusercontent.com/ottomated/ottotime/refs/heads/main/demo.png)

## Features

- Tracks the time you spend on each workspace, and stores it in a `.ottotime` file.
- `.ottotime` files can be tracked in git and merged automatically.
- Shows a nice chart of time spend daily.
- Use the `Ottotime: Show all logs` command to see data from all recent workspaces.
- No data is sent to any remote server.

## Release Notes

### 1.0.6

- Clean up unused files in the extension bundle.

### 1.0.5

- Update vulnerable npm packages.

### 1.0.4

- When disabling for the workspace, delete `.ottotime` file if it has less than 5 minutes logged.

### 1.0.3

- Display hours in the bottom left status bar.
- Don't live-update files that aren't on the file system (i.e. git diffs).

### 1.0.2

- Added license.

### 1.0.1

- Save time data on vscode shutdown.

### 1.0.0

- Initial release.

---
