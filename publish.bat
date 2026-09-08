@echo off
cd /d "%~dp0"
title WordPower publish
if "%~1"=="" (
  for /f "tokens=2 delims==" %%a in ('wmic os get localdatetime /value ^| find "="') do set TS=%%a
  set MSG=update %TS:~0,14%
) else (
  set MSG=%~1
)
git add -A
git commit -m "%MSG%"
git push
echo.
echo Pushed. Cloudflare Pages should start building now.
pause
