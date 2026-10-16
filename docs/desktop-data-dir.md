# Data directory

Pi Agent Desktop reads and writes everything under **one data root that sits next
to the installed program**, not in the user profile. Nothing the app owns lands in
`%USERPROFILE%` (Windows), `~` (macOS/Linux) or `%LOCALAPPDATA%` any more.

## Layout

| Path under the data root | Contents | Env var that points at it |
|---|---|---|
| `agent/` | pi's own directory: `sessions/`, `auth.json`, `models.json`, `settings.json`, `mcp.json`, `skills/`, `extensions/`, `prompts/`, `themes/`, `bin/` | `PI_CODING_AGENT_DIR` |
| `logs/` | `desktop.log` (Tauri) and `server.log` (the bundled Next server) | — |
| `config/` | `ui-prefs.json` (window/tray/theme) and `last-version.json` | — |
| `cache/` | WebView2 / WebKit profile and disk caches | — |
| `pi-cwd/<YYYYMMDD>/` | the "use default directory" scratch folder | `PI_AGENT_HOME` points at the **data root**, and `userHome()` resolves to it |

The data root itself is passed to the server as `PI_AGENT_HOME` (the fork's
`lib/user-home.ts` override, which drives the default cwd and the file-access
allow-list) and `agent/` is passed as `PI_CODING_AGENT_DIR` (the pi SDK's own
override for `getAgentDir()`).

## Where the data root is

| Run | Data root |
|---|---|
| Installed app (Windows NSIS, `perMachine`) | `<install dir>\data`, i.e. `C:\Program Files\Pi Agent\data` by default |
| Installed app (macOS `.app` / Linux bundle) | `<install dir>/data`, resolved from Tauri's `resource_dir()` |
| `npm run dev`, `npm run web`, `npm start`, `npm run test:e2e` | `<repo>/data` (gitignored) |

Precedence, highest first:

1. `PI_DESKTOP_DATA_DIR` — the Tauri launcher's override. Absolute paths only; a
   relative value is ignored, because it would resolve against an unpredictable
   working directory.
2. `PI_WEB_DATA_DIR` — the Node-side override used by the dev/self-hosted server.
   Also absolute-paths-only.
3. The default for the run, from the table above.

`PI_AGENT_HOME` and `PI_CODING_AGENT_DIR` can be set directly to bypass the data
root entirely — that is what the e2e harness does to get a throwaway agent
directory per run. If either is already set, the app does not overwrite it.

## Why next to the program

An install is self-contained: everything the app accumulates lives in one folder
that moves with it, is obvious to back up, and can be deleted to reset the app to a
fresh state. It also keeps a machine-wide install from leaving per-user state
scattered through every account's profile.

## The installer's part (Windows)

The NSIS installer runs `perMachine`, so `$INSTDIR` is under `Program Files`, which
is administrator-only. A non-elevated app cannot write there, so
`src-tauri/installer-hooks.nsh` creates `$INSTDIR\data` and its subdirectories in
`NSIS_HOOK_POSTINSTALL` and grants `BUILTIN\Users` modify on that tree only:

```
icacls "$INSTDIR\data" /grant *S-1-5-32-545:(OI)(CI)M /T /C
```

The SID `*S-1-5-32-545` is used instead of the localized name `Users`, which would
not resolve on a Chinese, German or any other non-English Windows. The program files
themselves stay administrator-only.

An administrator installing the app needs to do nothing extra — the hook runs as
part of the install.

## Uninstalling

The uninstaller deliberately **leaves `data/` in place**. It holds sessions,
credentials and settings, and an uninstall is often followed by a reinstall. To wipe
the app's state completely, delete the install directory after uninstalling.

## Resetting a development checkout

Delete `<repo>/data`. The next `npm run dev` recreates it empty, which is exactly
what a fresh install looks like.
