@echo off
cd /d "%~dp0"
call scripts\hue-update.bat %*
set RC=%ERRORLEVEL%
if "%~1"=="" pause
exit /b %RC%
