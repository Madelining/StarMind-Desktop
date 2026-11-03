@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Missing bundled Node runtime. Download the Windows server delivery archive.
  pause
  exit /b 1
)
"runtime\node.exe" "tools\create-publisher.mjs"
pause
