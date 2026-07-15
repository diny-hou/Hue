param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("product", "daily")]
    [string]$Channel
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$StageDir = Join-Path $Root "dist-update\$Channel"
$Port = if ($Channel -eq "product") { 8080 } else { 8081 }

if (-not (Test-Path (Join-Path $StageDir "update.json"))) {
    Write-Error "No update.json in $StageDir`nBuild first: scripts\build-update-installer.bat"
}

$setup = Get-ChildItem -Path $StageDir -Filter "*_x64-setup.exe" | Select-Object -First 1
if (-not $setup) {
    Write-Error "No setup.exe in $StageDir"
}

Write-Host "Serving $Channel update from $StageDir on http://127.0.0.1:$Port/"
Write-Host "  $($setup.Name)"

# Stop existing server on this port (if any)
Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }

$serverCmd = "cd /d `"$StageDir`" && npx --yes serve -l $Port"
Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $serverCmd -WindowStyle Minimized

Start-Sleep -Seconds 2

$tryPaths = @(
    (Join-Path $env:LOCALAPPDATA "Hue\hue.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Hue\hue.exe"),
    (Join-Path ${env:ProgramFiles} "Hue\hue.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Hue\hue.exe")
)

$hueExe = $null
foreach ($p in $tryPaths) {
    if (Test-Path $p) { $hueExe = $p; break }
}

if (-not $hueExe) {
    $cmd = Get-Command hue.exe -ErrorAction SilentlyContinue
    if ($cmd) { $hueExe = $cmd.Source }
}

if (-not $hueExe) {
    Write-Host ""
    Write-Host "Update server is running. Hue is not installed in the usual paths."
    Write-Host "Start your installed Hue manually — it should show the update prompt."
    Write-Host "Server: http://127.0.0.1:$Port/update.json"
    exit 0
}

Write-Host "Launching: $hueExe"
Stop-Process -Name hue -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500
Start-Process -FilePath $hueExe

Write-Host ""
Write-Host "Hue launched. Accept 'Install and restart' in the update dialog."
Write-Host "Leave the minimized serve window running until the update finishes."
