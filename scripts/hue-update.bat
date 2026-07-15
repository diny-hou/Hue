@echo off
cd /d "%~dp0.."

if "%~1"=="1" goto build_product
if "%~1"=="2" goto build_daily
if "%~1"=="3" goto serve_product
if "%~1"=="4" goto serve_daily

echo.
echo  Hue local updater
echo  =================
echo    1) Product build       - signed installer -^> dist-update\product  (port 8080)
echo    2) Daily build         - signed installer -^> dist-update\daily    (port 8081)
echo    3) Update installed app (product channel)
echo    4) Update installed app (daily channel)
echo.
set /p CHOICE=Select 1-4: 

if "%CHOICE%"=="1" goto build_product
if "%CHOICE%"=="2" goto build_daily
if "%CHOICE%"=="3" goto serve_product
if "%CHOICE%"=="4" goto serve_daily
echo Invalid choice.
exit /b 1

:build_product
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\stage-update.ps1" -Channel product
exit /b %ERRORLEVEL%

:build_daily
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\stage-update.ps1" -Channel daily
exit /b %ERRORLEVEL%

:serve_product
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\serve-and-launch.ps1" -Channel product
exit /b %ERRORLEVEL%

:serve_daily
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lib\serve-and-launch.ps1" -Channel daily
exit /b %ERRORLEVEL%
