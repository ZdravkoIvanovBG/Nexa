#!/usr/bin/env pwsh
# Fetches the pinned official mpv 0.42.0 libmpv-2.dll into src-tauri/libmpv/.
# Kept for people used to running it; the real work (archive and file SHA-256
# checks, export checks) is in scripts/fetch-libmpv.mjs, the same path CI uses.
# It never downloads a "latest" build. See docs/mpv-binaries.md.
#
#   pwsh ./setup-libmpv.ps1        (from src-tauri)

$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "..\scripts\fetch-libmpv.mjs")
exit $LASTEXITCODE
