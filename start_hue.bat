@echo off
:: Navigate to the directory where the batch file is located
cd /d "%~dp0"

:: Check if node is installed to provide a helpful error if it fails
where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Error: npm is not installed or not in your PATH.
    echo Please install Node.js to run this development server.
    pause
    exit /b 1
)

:: Kill any existing Hue instances to avoid hotkey conflicts
taskkill /F /IM hue.exe >nul 2>&1

echo Starting Hue Development Server...
npm run tauri dev
