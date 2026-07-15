@echo off
call "%~dp0hue-update.bat" 1 %*
exit /b %ERRORLEVEL%
