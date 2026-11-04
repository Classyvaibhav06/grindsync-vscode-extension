# ⚡ GrindSync Activity Tracker (VS Code Extension)

> **Official Visual Studio Code extension for [GrindSync](https://grindsync.vercel.app)** — The Proof of Progress platform for software builders.

Intelligently measure actual, active coding time inside VS Code and synchronize verified telemetry, programming languages, and proof of work straight to your GrindSync profile, streaks, and global leaderboards.

![GrindSync Extension Banner](https://grindsync.vercel.app/project1.png)

---

## 🌟 Why GrindSync Activity Tracker?

Unlike naive timers or window-focus trackers that log idle hours simply because VS Code was left open, **GrindSync Activity Tracker** implements an intelligent event-driven **Activity State Machine**:

- **Real Coding Detection:** Accumulates time **only** when meaningful editor interactions occur (typing, editing, pasting, deleting).
- **Zero AI / Formatter Inflation:** Filters massive burst edits (>1,500 characters in a single tick) from bloating manual typing metrics.
- **Strict Inactivity Bounding:** Detects idle pauses after 60 seconds of inactivity and bounds the active interval to the exact millisecond of your last edit.
- **Privacy-First:** **Never** reads, stores, or transmits file contents, code snippets, project paths, or keystrokes. Only language identifiers, line count deltas, and duration intervals are recorded.
- **Zero-Password Pairing:** Connect securely in seconds with single-use, 5-minute expiring pairing codes.
- **Resilient Offline Sync:** Buffers intervals locally if your connection drops, automatically syncing with idempotent batch IDs upon reconnection.

---

## 🚀 Quick Setup & Pairing

### 1. Generate Pairing Code
1. Log into your **[GrindSync](https://grindsync.vercel.app)** account.
2. Navigate to **Connected IDEs** (`/settings/connected-ides`).
3. Click **"Generate Pairing Code"** to receive a 6-digit code (valid for 5 minutes).

### 2. Connect in VS Code
1. Open Visual Studio Code.
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) and run:
   ```
   GrindSync: Connect Account (Enter Pairing Code)
   ```
   *(Or click the `$(plug) GrindSync: Pair IDE` item in your status bar).*
3. Paste your 6-digit code and hit `Enter`.
4. Your machine is paired, and telemetry starts syncing automatically!

---

## 📊 Status Bar Indicators

The extension lives quietly in the bottom right of your status bar:

| Indicator | Meaning |
|---|---|
| `$(pulse) GrindSync: 02h 45m` | **ACTIVE** — Currently typing / coding. Time is accumulating. |
| `$(clock) GrindSync: 02h 45m` | **IDLE** — Inactive for >60s. Tracking paused. |
| `$(debug-pause) GrindSync: Paused` | **MANUALLY PAUSED** — Tracking is temporarily suspended. |
| `$(plug) GrindSync: Pair IDE` | **NOT PAIRED** — Click to enter pairing code. |

Clicking the status bar opens a menu to view stats, pause/resume, force sync, open your dashboard, or disconnect the device.

---

## ⚙️ Extension Settings

Customize tracking rules in VS Code Settings (`Ctrl+,` → search `GrindSync`):

```json
{
  "grindsync.apiUrl": "https://grindsync.vercel.app",
  "grindsync.idleTimeoutSeconds": 60,
  "grindsync.sessionTimeoutMinutes": 15,
  "grindsync.heartbeatIntervalSeconds": 30,
  "grindsync.syncIntervalSeconds": 60,
  "grindsync.filterAiFormatterBursts": true
}
```

- `grindsync.apiUrl`: Base URL of your GrindSync instance.
- `grindsync.idleTimeoutSeconds`: Seconds of inactivity before pausing active timer (default: `60`).
- `grindsync.sessionTimeoutMinutes`: Inactivity threshold before auto-finalizing an abandoned coding session (default: `15`).
- `grindsync.heartbeatIntervalSeconds`: Frequency of presence pings (default: `30`).
- `grindsync.syncIntervalSeconds`: Frequency of activity batch flushes (default: `60`).
- `grindsync.filterAiFormatterBursts`: Prevent formatter runs and code-gen dumps from counting as typing (default: `true`).

---

## 🔒 Security & Privacy Guarantees

GrindSync adheres to strict security and privacy standards:
- **No Source Code Access:** Extension never inspects buffer text or file contents.
- **No Path Logging:** Full directory trees and private repository names are never transmitted.
- **SecretStorage Storage:** Device tokens are stored inside OS-level secure keystores (macOS Keychain, Windows Credential Manager, Linux Secret Service).
- **Instant Revocation:** Disconnect any device immediately from the GrindSync web dashboard.

---

## 🛠️ Development & Building from Source

### Prerequisites
- Node.js 18+
- npm or yarn

### Build Steps
```bash
# Clone the repository
git clone https://github.com/Classyvaibhav06/grindsync-vscode-extension.git
cd grindsync-vscode-extension

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Package .vsix extension file
npx @vscode/vsce package
```

To test locally in VS Code:
```bash
code --install-extension grindsync-tracker-1.0.0.vsix
```

---

## 📜 License

MIT © [Vaibhav Ghoshi](https://github.com/Classyvaibhav06) • Built for [GrindSync](https://grindsync.vercel.app)
