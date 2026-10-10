# Monu

A tiny companion for your AI coding agents. It slides out of the top edge of your screen, shows what
Claude Code (and other agents) are doing, lets you **Allow / Deny** permission requests, answers
questions, chats with any AI and keeps you company. Windows 10/11.

Monu is an original character; the code is yours to change.

## Build

Prerequisites: [Rust](https://rustup.rs) (MSVC toolchain), Node 20+, Visual Studio Build Tools
(C++ workload), WebView2 (already on Windows 11).

```
npm install
npm run dev      # builds monu-hook, then starts the app with hot reload
npm run pack     # MSI + NSIS installer in src-tauri/target/release/bundle/
```

The installer is unsigned: Windows SmartScreen shows *Unknown publisher*. Click **More info → Run anyway**.
Add a code-signing certificate in `tauri.conf.json` (`bundle.windows`) to remove the warning.

### Portable build (no admin, no installer)

If you don't have admin rights on the machine (e.g. a school-managed laptop), skip the installer
and run the raw `.exe` directly — Tauri apps are a single executable plus a resources folder,
nothing is installed into Program Files or the registry:

```
npm install
npm run hook                 # builds hook\target\release\monu-hook.exe and copies the sidecar
npx tauri build --no-bundle  # builds the app only, skips MSI/NSIS packaging
```

The app binary lands at `src-tauri/target/release/monu.exe`. Copy that file together with
`src-tauri/target/release/monu-hook-x86_64-pc-windows-msvc.exe` into the same folder (e.g. a USB
stick or a folder under `%LOCALAPPDATA%`), then just double-click `monu.exe` to run it — no admin
prompt, no install step. Settings, keys and the hook install (into your own `~/.claude/settings.json`)
all live under your user profile, which a standard (non-admin) account can already write to.

To build the whole thing without even opening a terminal each time, add a short `.bat` next to the
exe:

```bat
@echo off
start "" "%~dp0monu.exe"
```

Note: `npm run hook` calls `cargo build`, which itself needs no admin rights either — it only writes
inside the project folder (`hook/target/`).

## Connect Claude Code

Settings → **Install Claude Code hooks**. Monu shows you the new `~/.claude/settings.json`,
saves a backup next to it and merges its hooks. If Monu isn't running, the hook exits instantly,
so Claude Code is never blocked.

Other agents: call `monu-hook.exe --agent <name>` from their hook config and pipe the event JSON on
stdin. Add `--wait` for events that need an answer. `<name>` can be claude, codex, cursor, gemini,
copilot, muse, opencode, amp, hermes or anything else (it gets its own pill).

## Features

| Area | What you get |
| --- | --- |
| Island | hidden → peek → open; click-through except the island; never takes focus; hides over fullscreen apps; multi-monitor (pick a screen or follow the mouse) |
| Monu | breathing, blinking, eyes follow your cursor, squish, annoyed, dizzy, jump, dance, wardrobe, seasonal outfits, colour |
| Agents | live sessions, steps, diffs, Allow / Deny / Always, AskUserQuestion, open terminal |
| Chat | Claude, OpenAI, Gemini, Ollama, LM Studio; drop a file on the island to ask about it |
| Pills | GitHub, Vercel, Stripe, now playing (Spotify and others, via Windows media controls) |
| Desktop | send Monu to the desktop; double-click him to bring him home |
| Extras | global shortcuts, 28 sounds (drop `finish.wav` etc. in the sounds folder), weekly recap image, demo mode, EN / BN / FR / ES / HI |

Keys are stored in Windows Credential Manager. No telemetry, no account.

## Layout

```
src/            TypeScript UI (character, island, sessions, chat, services, stats, i18n)
src-tauri/      Rust: window + click-through, tray, named-pipe server, keyring, hook installer, media
hook/           monu-hook.exe (tiny CLI, no heavy dependencies)
scripts/        build-hook.mjs copies the CLI into src-tauri/binaries as the Tauri sidecar
```

## Known limits

- Automatic hook install is Claude Code only; other agents need a one-line hook config (above).
- "Always" remembers the tool (for Bash: the command's first word) inside Monu, not in Claude's own rules.
- AskUserQuestion answers are sent back as `updatedInput.answers`; if your Claude Code version
  ignores that, use **Reply in terminal**.
- Plan-usage gauges, iPhone app and Mac-only features are not part of this Windows build.
