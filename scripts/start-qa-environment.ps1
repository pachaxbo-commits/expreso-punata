param(
  [ValidateSet('automated','simulation')][string]$Environment = 'simulation',
  [switch]$Clean
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$profileRoot = Join-Path $repoRoot ".qa-$Environment"
$tempRoot = Join-Path $profileRoot 'temp'
$cacheRoot = Join-Path $profileRoot 'firebase-cache'
$cliHome = Join-Path $profileRoot 'cli-home'
$config = if ($Environment -eq 'automated') { Join-Path $repoRoot 'firebase.automated.emulator.json' } else { Join-Path $repoRoot 'firebase.simulation.emulator.json' }
if ($Clean -and (Test-Path -LiteralPath $profileRoot)) { Remove-Item -LiteralPath $profileRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $profileRoot,$tempRoot,$cacheRoot,$cliHome | Out-Null
$env:TEMP = $tempRoot
$env:TMP = $tempRoot
$env:USERPROFILE = $cliHome
$env:APPDATA = Join-Path $cliHome 'AppData'
$env:LOCALAPPDATA = Join-Path $cliHome 'LocalAppData'
$env:XDG_CONFIG_HOME = Join-Path $cliHome '.config'
$env:FIREBASE_CLI_HOME = $cliHome
$env:FIREBASE_EMULATORS_PATH = Join-Path $cacheRoot 'emulators'
$env:FIREBASE_EMULATOR_HUB = if ($Environment -eq 'automated') { '127.0.0.1:17040' } else { '127.0.0.1:18040' }
$env:FIREBASE_PROJECT_ID = 'demo-expreso-punata-101'
$env:GCLOUD_PROJECT = 'demo-expreso-punata-101'
$env:NPM_CONFIG_UPDATE_NOTIFIER = 'false'
$env:CI = '1'
$node = 'C:\Users\Pc\Documents\ChatGPT\expreso-punata-101-worktree\.runtime\node22\node.exe'
$firebase = 'C:\Users\Pc\AppData\Local\npm-cache\_npx\112a9764e56265fb\node_modules\firebase-tools\lib\bin\firebase.js'
& $node $firebase emulators:start --project demo-expreso-punata-101 --config $config --only auth,firestore,storage,functions
