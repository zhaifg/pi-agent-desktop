use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// Environment override for the data root. Only absolute paths are honoured: a
/// relative value would resolve against whatever working directory the process
/// happened to start in, which is not a location anyone can reason about.
pub const DATA_DIR_ENV: &str = "PI_DESKTOP_DATA_DIR";

/// All of the app's own read/write paths, resolved under one data root.
///
/// The data root sits next to the installed program — `<install dir>/data` — rather
/// than in the user profile. Everything the app writes at runtime (pi's agent
/// directory with sessions and credentials, the logs, the UI preferences, the
/// webview caches) lands inside it, so an install is self-contained and removing
/// the folder resets the app to a fresh state.
///
/// On Windows `resource_dir()` is the directory the installer wrote to (`$INSTDIR`,
/// where the bundle's `resources/...` entries already live), so this is
/// `<install dir>\data` for a packaged build. The NSIS post-install hook creates it
/// and grants BUILTIN\Users write access, because Program Files itself is
/// administrator-only and the app must write here without elevating.
///
/// `PI_DESKTOP_DATA_DIR` overrides the location; `scripts/desktop-dev.mjs` can set
/// it when a development run should not share the checkout's own `data/`.
pub fn data_root(app: &AppHandle) -> PathBuf {
    if let Some(configured) = absolute_env_path(DATA_DIR_ENV) {
        return configured;
    }
    // The installer's directory. Falling back to the executable's own directory
    // keeps a relocated or portable copy working when the resource lookup fails.
    if let Ok(resource_dir) = app.path().resource_dir() {
        return resource_dir.join("data");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            return parent.join("data");
        }
    }
    // Last resort: the process working directory. Better than returning nothing,
    // and `ensure_data_dirs` reports it so the chosen location is never a mystery.
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("data")
}

fn absolute_env_path(name: &str) -> Option<PathBuf> {
    let value = std::env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let path = PathBuf::from(trimmed);
    path.is_absolute().then_some(path)
}

/// pi's agent directory: sessions, `auth.json`, `models.json`, `settings.json`,
/// `mcp.json`, skills, extensions, prompts. Handed to the server as
/// `PI_CODING_AGENT_DIR`, which is the SDK's own override for `getAgentDir()`.
pub fn agent_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("agent")
}

/// `desktop.log` and the packaged server's `server.log`.
pub fn logs_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("logs")
}

/// `ui-prefs.json` and `last-version.json`.
pub fn config_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("config")
}

/// WebView2 / WebKit profile data, and the caches `clear_runtime_caches` empties.
pub fn cache_dir(app: &AppHandle) -> PathBuf {
    data_root(app).join("cache")
}

/// Creates the data root and every subdirectory above, returning the root.
///
/// Called before the server is spawned and before the window is built, so both the
/// server process and the webview find their directories already present. Existing
/// directories are fine; anything else is reported to the caller, which logs it.
pub fn ensure_data_dirs(app: &AppHandle) -> std::io::Result<PathBuf> {
    let root = data_root(app);
    for dir in [
        root.clone(),
        agent_dir(app),
        logs_dir(app),
        config_dir(app),
        cache_dir(app),
    ] {
        ensure_dir(&dir)?;
    }
    Ok(root)
}

/// `create_dir_all`, except that an already-existing directory is success rather
/// than an `AlreadyExists` error — the common case on every launch but the first.
fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    match std::fs::create_dir_all(dir) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Ok(()),
        Err(error) => Err(error),
    }
}
