@echo off
setlocal
cd /d "%~dp0"
if not exist "runtime\node.exe" (
  echo Missing bundled Node runtime. Download the Windows server delivery archive.
  pause
  exit /b 1
)
if not exist "market.config.json" copy /y "market.config.example.json" "market.config.json" >nul
"runtime\node.exe" "src\cli.mjs" serve --config "market.config.json"
pause
