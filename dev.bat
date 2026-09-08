@echo off
cd /d "%~dp0"
title WordPower dev
echo ============================================
echo  WordPower dev server starting...
echo  Keep this window open.
echo  Stop: press Ctrl+C here, or close window.
echo ============================================
echo.
start "WordPower dev" cmd /k npm run dev
timeout /t 3 /nobreak >nul
start "" http://localhost:5173
