$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$localProfile = Join-Path $repoRoot '.firebase-local-profile'
$dataDir = Join-Path $localProfile 'data'
$fallbackDataDir = Join-Path $localProfile 'data-test'

# Si el directorio principal fue exportado sin usuarios, reutilizar el respaldo
# local de pruebas que contiene el usuario admin@expresopunata.com.
$importDir = $dataDir
$accountsFile = Join-Path $dataDir 'auth_export\accounts.json'
if (!(Test-Path -LiteralPath $accountsFile) -or ((Get-Content -LiteralPath $accountsFile -Raw) -notmatch '"users"\s*:\s*\[\s*\{')) {
  if (Test-Path -LiteralPath (Join-Path $fallbackDataDir 'firebase-export-metadata.json')) {
    $importDir = $fallbackDataDir
  }
}

New-Item -ItemType Directory -Force -Path $localProfile | Out-Null
# Firebase CLI intenta usar carpetas protegidas del perfil de Windows en este entorno.
$env:USERPROFILE = $localProfile
$env:CI = '1'

Push-Location $repoRoot
try {
  npx --yes firebase-tools emulators:start `
    --only auth,firestore,storage,functions `
    --import $importDir `
    --export-on-exit $dataDir
  $firebaseExitCode = $LASTEXITCODE

  # Algunas versiones de Firebase CLI fallan al renombrar el export temporal en Windows.
  # Recuperar el último directorio generado evita perder los datos locales.
  $exportCandidate = Get-ChildItem -LiteralPath $repoRoot -Directory -Filter 'firebase-export-*' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if ($exportCandidate) {
    for ($attempt = 1; $attempt -le 10; $attempt++) {
      try {
        if (Test-Path -LiteralPath $dataDir) {
          Remove-Item -LiteralPath $dataDir -Recurse -Force
        }
        Move-Item -LiteralPath $exportCandidate.FullName -Destination $dataDir
        break
      } catch {
        if ($attempt -eq 10) { throw }
        Start-Sleep -Milliseconds 500
      }
    }
  }

  exit $firebaseExitCode
} finally {
  Pop-Location
}
