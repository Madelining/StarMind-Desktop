@echo off
setlocal
cd /d "%~dp0"
call corepack yarn starmind:dev
if errorlevel 1 pause
