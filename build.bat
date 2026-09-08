@echo off
cd /d "%~dp0"
echo Building WordPower (dist folder)...
call npm run build
echo.
echo Done. Output is in dist\
pause
