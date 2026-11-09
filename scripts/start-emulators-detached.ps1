$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$profile = Join-Path $repoRoot '.firebase-local-profile'
$logDir = Join-Path $profile 'session-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$env:FIREBASE_CLI_BIN = Join-Path $repoRoot '.firebase-cli-local-1535\node_modules\firebase-tools\lib\bin\firebase.js'
$env:FIREBASE_EMULATOR_CONFIG = Join-Path $repoRoot 'firebase.local.emulator.json'
$env:USERPROFILE = $profile
$env:APPDATA = Join-Path $profile 'AppData'
$env:LOCALAPPDATA = Join-Path $profile 'LocalAppData'
$env:FIREBASE_CLI_HOME = $profile
$env:FIREBASE_EMULATORS_PATH = Join-Path $profile '.cache\firebase\emulators'
$env:FIREBASE_PROJECT_ID = 'demo-uncollected-phase1'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'

$logFile = Join-Path $logDir 'emulators-session.log'
$errorLogFile = Join-Path $logDir 'emulators-session.error.log'
$launcher = Join-Path $repoRoot 'scripts\start-emulators.ps1'
$proc = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -PassThru -RedirectStandardOutput $logFile -RedirectStandardError $errorLogFile -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$launcher)
Set-Content -LiteralPath (Join-Path $logDir 'supervisor.pid') -Value $proc.Id
Write-Output "Emulator supervisor started. PID=$($proc.Id) Log=$logFile"
