param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("product", "daily")]
    [string]$Channel
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $Root

$KeyPath = Join-Path $Root "src-tauri\.keys\hue.key"
if (-not (Test-Path $KeyPath)) {
    Write-Error "Missing signing key: $KeyPath`nGenerate: npx tauri signer generate -w src-tauri/.keys/hue.key -p hue -f"
}

$Port = if ($Channel -eq "product") { 8080 } else { 8081 }
$UpdaterConfig = "src-tauri/tauri.updater-local-$Channel.json"
$StageDir = Join-Path $Root "dist-update\$Channel"
$OverlayDir = Join-Path $Root "src-tauri\.build"
$OverlayPath = Join-Path $OverlayDir "daily-version.json"

New-Item -ItemType Directory -Force -Path $StageDir, $OverlayDir | Out-Null

$baseVersion = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$buildVersion = $baseVersion

if ($Channel -eq "daily") {
    $date = Get-Date -Format "yyyyMMdd"
    $counterFile = Join-Path $StageDir ".build-counter"
    $seq = 1
    if (Test-Path $counterFile) {
        $seq = [int](Get-Content $counterFile -Raw).Trim() + 1
    }
    Set-Content -Path $counterFile -Value $seq -NoNewline
    $buildVersion = "$baseVersion-daily.$date.$seq"
    @{ version = $buildVersion } | ConvertTo-Json | Set-Content -Path $OverlayPath -Encoding UTF8
    Write-Host "Daily version: $buildVersion"
}

$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "hue"

Write-Host "Building signed $Channel update (v$buildVersion, port $Port)..."
$buildArgs = @("tauri", "build", "--config", $UpdaterConfig)
if ($Channel -eq "daily") {
    $buildArgs += @("--config", $OverlayPath)
}

& npx @buildArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$bundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem -Path $bundleDir -Filter "*_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
    Write-Error "No setup.exe found in $bundleDir"
}

$sig = Get-Item "$($setup.FullName).sig" -ErrorAction SilentlyContinue
if (-not $sig) {
    Write-Error "Missing signature file: $($setup.FullName).sig"
}

Copy-Item -Force $setup.FullName (Join-Path $StageDir $setup.Name)
Copy-Item -Force $sig.FullName (Join-Path $StageDir $sig.Name)

$signature = (Get-Content -Raw $sig.FullName).Trim()
$manifest = [ordered]@{
    version  = $buildVersion
    notes    = "Hue $Channel update v$buildVersion"
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            url         = "http://127.0.0.1:$Port/$($setup.Name)"
            signature   = $signature
        }
    }
}

$updateJson = Join-Path $StageDir "update.json"
$json = $manifest | ConvertTo-Json -Depth 6
[System.IO.File]::WriteAllText($updateJson, $json, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Staged $Channel update:"
Write-Host "  Version : $buildVersion"
Write-Host "  Folder  : $StageDir"
Write-Host "  Setup   : $($setup.Name)"
Write-Host "  Manifest: update.json"
Write-Host ""
Write-Host "Next: npm run update -- 3   (product) or npm run update -- 4   (daily)"
