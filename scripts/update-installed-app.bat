@echo off
if "%~1"=="" (
    echo Usage: update-installed-app.bat 3^|4
    echo   3 = product channel
    echo   4 = daily channel
    echo Or run: npm run update
    exit /b 1
)
call "%~dp0hue-update.bat" %*
exit /b %ERRORLEVEL%
