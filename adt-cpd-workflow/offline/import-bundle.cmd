@echo off
rem ============================================================
rem  StarMind 团队插件基线 —— 一键导入
rem
rem  用法：双击本文件，或把 starmind-plugin-baseline-*.zip 拖到本文件上
rem  不需要懂命令行；装完重启 StarMind 即可
rem ============================================================
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
title StarMind 插件基线导入

set "BUNDLE=%~1"

if not defined BUNDLE (
  for %%f in ("%~dp0starmind-plugin-baseline-*.zip") do set "BUNDLE=%%~ff"
)

if defined BUNDLE (
  echo 基线包：!BUNDLE!
) else (
  echo 没找到 starmind-plugin-baseline-*.zip
  echo.
  echo 请把基线包放在本文件同一目录下，或把 zip 拖到本文件图标上。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在导入，请勿关闭窗口……
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0import-bundle.ps1" -Bundle "!BUNDLE!"
set "CODE=%ERRORLEVEL%"

echo.
if "%CODE%"=="0" (
  echo 导入完成。
) else (
  echo 导入结束，退出码 %CODE% —— 请把上面的报错截图给管理员。
)
echo.
pause
endlocal
exit /b %CODE%
