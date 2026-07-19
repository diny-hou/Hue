# One-shot product release: bump patch → incremental build → sign → git tag → GitHub Release
# Usage (from repo root):
#   npm run release
#   npm run release -- 1.2.5          # explicit version
#   powershell -File scripts/release-product.ps1 -SkipCommit   # build+upload only
param(
    [string]$Version = "",
    [switch]$SkipCommit,
    [switch]$SkipPush
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$KeyPath = Join-Path $Root "src-tauri\.keys\hue.key"
if (-not (Test-Path $KeyPath)) {
    throw "Missing $KeyPath — generate with: npx tauri signer generate -w src-tauri/.keys/hue.key -p hue -f"
}

function Get-PackageVersion {
    (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
}

function Set-AllVersions([string]$ver) {
    foreach ($rel in @("package.json", "src-tauri\tauri.conf.json")) {
        $path = Join-Path $Root $rel
        $text = Get-Content $path -Raw
        $text = $text -replace '("version"\s*:\s*")[^"]+', "`${1}$ver"
        [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
    }

    $cargoPath = Join-Path $Root "src-tauri\Cargo.toml"
    $cargo = Get-Content $cargoPath -Raw
    $cargo = [regex]::Replace($cargo, '(?m)^version = "[^"]+"', "version = `"$ver`"", 1)
    [System.IO.File]::WriteAllText($cargoPath, $cargo, (New-Object System.Text.UTF8Encoding $false))

    $lockPath = Join-Path $Root "src-tauri\Cargo.lock"
    if (Test-Path $lockPath) {
        $lock = Get-Content $lockPath -Raw
        $lock = $lock -replace '(?s)(name = "hue"\r?\nversion = ")[^"]+', "`${1}$ver"
        [System.IO.File]::WriteAllText($lockPath, $lock, (New-Object System.Text.UTF8Encoding $false))
    }
}

function Bump-Patch([string]$ver) {
    $parts = $ver.Split('.')
    if ($parts.Count -lt 3) { throw "Expected semver x.y.z, got $ver" }
    $parts[2] = [string]([int]$parts[2] + 1)
    return ($parts -join '.')
}

$current = Get-PackageVersion
if (-not $Version) {
    $Version = Bump-Patch $current
}
Write-Host "Release $current → $Version"
Set-AllVersions $Version

# Incremental: do NOT cargo clean — Rust rebuilds only what changed
Write-Host "Building installer (incremental Cargo)..."
npm run build:exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$nsisDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem $nsisDir -Filter "Hue_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) {
    $setup = Get-ChildItem $nsisDir -Filter "*_x64-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if (-not $setup) { throw "No setup.exe in $nsisDir" }

Write-Host "Signing $($setup.Name)..."
Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "hue"
$env:TAURI_SIGNING_PRIVATE_KEY_PATH = $KeyPath
node (Join-Path $Root "node_modules\@tauri-apps\cli\tauri.js") signer sign --private-key-path $KeyPath $setup.FullName
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) { throw "Missing $sigPath" }

$signature = (Get-Content -Raw $sigPath).Trim()
$tag = "v$Version"
$updatePath = Join-Path $Root "update.json"
$manifest = [ordered]@{
    version  = $Version
    notes    = "Release $tag"
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            url       = "https://github.com/diny-hou/Hue/releases/download/$tag/$($setup.Name)"
            signature = $signature
        }
    }
}
[System.IO.File]::WriteAllText(
    $updatePath,
    ($manifest | ConvertTo-Json -Depth 6),
    (New-Object System.Text.UTF8Encoding $false)
)

if (-not $SkipCommit) {
    git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock src
    git status --short
    $pending = git status --porcelain
    if ($pending) {
        git commit -m "Release $Version."
    } else {
        Write-Host "Nothing new to commit (version files may already be staged)."
    }
}

if (-not $SkipPush) {
    git push origin HEAD
    # Recreate tag if it already exists locally
    git tag -f $tag
    git push -f origin $tag
}

$releaseExists = $false
gh release view $tag -R diny-hou/Hue 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $releaseExists = $true }

if ($releaseExists) {
    Write-Host "Updating existing release $tag ..."
    gh release upload $tag $setup.FullName $sigPath $updatePath -R diny-hou/Hue --clobber
    gh release edit $tag -R diny-hou/Hue --latest
} else {
    gh release create $tag $setup.FullName $sigPath $updatePath -R diny-hou/Hue `
        --title $tag `
        --notes "Release $tag" `
        --latest
}

Remove-Item $updatePath -Force -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Done: https://github.com/diny-hou/Hue/releases/tag/$tag"
Write-Host "Installed apps can Check for updates → $Version"
Write-Host "(Cargo stays incremental — avoid 'cargo clean' for faster next releases.)"
