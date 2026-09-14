Var NexaLegacyDir
Var NexaMigrated

!macro NSIS_HOOK_PREINSTALL
  ; Harbor -> Nexa rename (0.9.26): adopt the legacy "Harbor" install folder and registry
  ; identity so an in-place update never leaves a second install behind. Keep this for good --
  ; a user updating from any pre-rename Harbor release must still be migrated correctly.
  StrCpy $NexaMigrated 0
  ReadRegStr $NexaLegacyDir HKCU "Software\harbor\Harbor" ""
  ReadRegStr $0 HKCU "Software\harbor\${PRODUCTNAME}" ""
  ${If} $NexaLegacyDir != ""
  ${AndIf} $0 == ""
  ${AndIf} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
  ${AndIf} ${FileExists} "$NexaLegacyDir\${MAINBINARYNAME}.exe"
    ; Re-point the install at the existing Harbor folder instead of creating a fresh
    ; "%LOCALAPPDATA%\Nexa" next to it. This keeps the exe path stable, so firewall rules,
    ; taskbar pins, antivirus exclusions and file/protocol associations all keep working.
    SetOutPath $NexaLegacyDir
    RMDir "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR $NexaLegacyDir
    StrCpy $NexaMigrated 1
  ${EndIf}

  ; (#419): force-close any running sidecars (mpv, ffmpeg, ffprobe, yt-dlp, stremio-server) so their
  ; .exe files aren't locked when we overwrite them during an install / update / reinstall.
  ; Path-scoped to $INSTDIR so a user's OWN mpv/ffmpeg/yt-dlp running elsewhere is never touched (no regressions),
  ; and the main exe itself is left out so Tauri's own running-app close handling stays in charge of the main window.
  nsExec::Exec `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-CimInstance Win32_Process | Where-Object { $$_.ExecutablePath -like '$INSTDIR\*' -and $$_.Name -ne '${MAINBINARYNAME}.exe' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`
  Pop $0
  ; Fallback for the uniquely-named server sidecar in case PowerShell is unavailable on the machine.
  ; Wildcard matches both stremio-server.exe and the triple-suffixed stremio-server-<triple>.exe; /T kills children.
  nsExec::Exec 'taskkill /F /T /FI "IMAGENAME eq stremio-server*"'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM stremio-server.exe'
  Pop $0
  Sleep 1000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $NexaMigrated = 1
    ; Tauri's own installer template skips creating shortcuts in /UPDATE mode, so the old
    ; "Harbor" shortcuts would otherwise keep pointing at this exe forever. Rename them ourselves.
    !insertmacro IsShortcutTarget "$SMPROGRAMS\Harbor.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$SMPROGRAMS\Harbor.lnk"
    ${EndIf}
    ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    !insertmacro IsShortcutTarget "$DESKTOP\Harbor.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$DESKTOP\Harbor.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}

    ; Remove the legacy uninstall/registry identity so the old "Harbor" Apps & Features entry
    ; (whose uninstaller can delete app data) can never be run again. App data itself is never
    ; touched here -- it lives under the "app.harbor" identifier, untouched by this migration.
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Harbor"
    DeleteRegKey HKCU "Software\harbor\Harbor"
  ${EndIf}
!macroend
