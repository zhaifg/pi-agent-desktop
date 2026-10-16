; Tauri's NSIS installer only adds files: an overwrite install never clears
; the previous payload, so a stale resources/server/node_modules keeps
; shadowing the freshly installed one through Node's nearest-module
; resolution and crashes the server at import time (issue #72).
;
; NSIS_HOOK_PREINSTALL runs before the installer writes any file, after it
; has confirmed the app is not running. node_modules is pure payload —
; nothing writes into it at runtime — so dropping it here is always safe:
; the installer immediately writes a complete fresh tree over it.
!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\resources\server\node_modules"
!macroend

; The app keeps everything it reads and writes under "$INSTDIR\data" — pi's
; agent directory (sessions, credentials, models, MCP config), the logs, the UI
; preferences and the webview profile — rather than in the user profile. The
; installer runs per machine, so $INSTDIR is under Program Files, which is
; administrator-only: a non-elevated app could not write there. Grant
; BUILTIN\Users modify on the data tree only, never on the program files
; themselves.
;
; The SID *S-1-5-32-545 is used instead of the localized name "Users", which
; would not resolve on a Chinese, German or any other non-English install.
; /T applies the grant to the whole tree, /C continues past per-file errors.
!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\data"
  CreateDirectory "$INSTDIR\data\agent"
  CreateDirectory "$INSTDIR\data\logs"
  CreateDirectory "$INSTDIR\data\config"
  CreateDirectory "$INSTDIR\data\cache"
  nsExec::ExecToLog 'icacls "$INSTDIR\data" /grant *S-1-5-32-545:(OI)(CI)M /T /C'
!macroend

; The data directory is deliberately NOT removed on uninstall. It holds the
; user's sessions, credentials and settings — losing them to an uninstall that
; is often followed by a reinstall would be destructive, and NSIS gives no way
; to ask a question here that a silent/unattended uninstall could answer.
; Deleting "$INSTDIR" by hand afterwards takes the data with it, which is the
; documented way to wipe the app's state completely.
