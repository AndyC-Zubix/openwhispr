<#
.SYNOPSIS
    OpenWhispr + Javas Plugin - Build Setup
.DESCRIPTION
    Switches to Node 22 LTS, installs deps (no C++ compiler needed),
    rebuilds only better-sqlite3 for Electron (prebuilt), type-checks,
    and builds the renderer. Does NOT require Administrator.
#>

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Fail($msg) { Write-Host "    [FAIL] $msg" -ForegroundColor Red }

# ── 1. Node 22 LTS via fnm ──────────────────────────────────────────────────
Write-Step "Switching to Node 22 LTS"

$fnm = Get-Command fnm -ErrorAction SilentlyContinue
if (-not $fnm) {
    Write-Host "    fnm not found. Installing via winget..."
    winget install --id Schniz.fnm --accept-source-agreements --accept-package-agreements
    $env:PATH = "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\Schniz.fnm_Microsoft.Winget.Source_8wekyb3d8bbwe;$env:PATH"
}

# fnm env setup for this session
$fnmEnv = fnm env --shell power-shell | Out-String
Invoke-Expression $fnmEnv

fnm install 22
fnm use 22

$nodeVer = node --version
if ($nodeVer -match "^v22\.") {
    Write-Ok "Node $nodeVer"
} else {
    Write-Fail "Expected Node 22.x but got $nodeVer"
    exit 1
}

# ── 2. Clean install (skip postinstall to avoid sentry compile) ──────────────
Write-Step "Installing dependencies (--ignore-scripts)"

Push-Location $ProjectRoot

if (Test-Path "node_modules") {
    Write-Host "    Cleaning node_modules..."
    Remove-Item -Recurse -Force "node_modules" -ErrorAction SilentlyContinue
}
if (Test-Path "package-lock.json") {
    Remove-Item -Force "package-lock.json" -ErrorAction SilentlyContinue
}

npm install --ignore-scripts 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "npm install failed"; Pop-Location; exit 1
}
Write-Ok "Dependencies installed"

# ── 3. Install Electron binary (skipped by --ignore-scripts) ──────────────────
Write-Step "Installing Electron binary"

node node_modules/electron/install.js 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Electron binary install failed"
} else {
    Write-Ok "Electron binary installed"
}

# ── 4. Rebuild only better-sqlite3 for Electron (prebuilt, no compiler) ──────
Write-Step "Rebuilding better-sqlite3 for Electron"

npx @electron/rebuild --only better-sqlite3 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "better-sqlite3 rebuild failed"
} else {
    Write-Ok "better-sqlite3 rebuilt"
}

# ── 5. Javas plugin deps ────────────────────────────────────────────────────
Write-Step "Installing Javas plugin dependencies"

$javasDir = Join-Path $ProjectRoot "plugins\javas"
if (Test-Path $javasDir) {
    Push-Location $javasDir
    npm install 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) { Write-Fail "Javas plugin install failed" }
    else { Write-Ok "Javas plugin ready" }
    Pop-Location
}

# ── 6. Type check ───────────────────────────────────────────────────────────
Write-Step "TypeScript check"

npm run typecheck 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) { Write-Fail "TypeScript errors" }
else { Write-Ok "Types clean" }

# ── 7. Build renderer ───────────────────────────────────────────────────────
Write-Step "Building renderer"

npm run build:renderer 2>&1 | ForEach-Object { Write-Host "    $_" }
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Renderer build failed"; Pop-Location; exit 1
}
Write-Ok "Renderer built"

Pop-Location

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host "`n============================================" -ForegroundColor Green
Write-Host "  READY" -ForegroundColor Green
Write-Host "============================================`n" -ForegroundColor Green
Write-Host "  Dev:   fnm use 22 && npm run dev" -ForegroundColor Gray
Write-Host "  Build: fnm use 22 && npm run build:win" -ForegroundColor Gray
Write-Host ""
Write-Host "  NOTE: If running from Claude Code or similar tools, unset" -ForegroundColor Yellow
Write-Host "  ELECTRON_RUN_AS_NODE before launching Electron:" -ForegroundColor Yellow
Write-Host "    set ELECTRON_RUN_AS_NODE=" -ForegroundColor Yellow
Write-Host ""
