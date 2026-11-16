# Instala Nebula como servicio de Windows con NSSM (https://nssm.cc), para que arranque con el equipo.
# Ejecutar en PowerShell como administrador, desde la carpeta del proyecto:
#   powershell -ExecutionPolicy Bypass -File deploy\windows\instalar-servicio.ps1
# Requisitos: Node 22+ y NSSM en el PATH (winget install NSSM.NSSM). Antes, `npm install` y `npm run build`.
$ErrorActionPreference = "Stop"
$root = (Resolve-Path "$PSScriptRoot\..\..").Path
$node = (Get-Command node).Source
if (-not (Get-Command nssm -ErrorAction SilentlyContinue)) { throw "No encuentro NSSM. Instálalo con: winget install NSSM.NSSM" }
if (-not (Test-Path "$root\frontend\dist")) { throw "Falta frontend\dist. Ejecuta antes: npm run build" }

# NSSM no arranca el servicio si no puede crear el archivo de registro
New-Item -ItemType Directory -Force "$root\data" | Out-Null

nssm install Nebula $node "--env-file-if-exists=$root\.env" "--import" "tsx" "src/server.ts"
nssm set Nebula AppDirectory "$root\backend"
nssm set Nebula DisplayName "Nebula (servidor multimedia)"
nssm set Nebula Start SERVICE_AUTO_START
nssm set Nebula AppStdout "$root\data\nebula.log"
nssm set Nebula AppStderr "$root\data\nebula.log"
nssm set Nebula AppRotateFiles 1
nssm set Nebula AppRotateBytes 10485760
nssm set Nebula AppStopMethodConsole 5000
nssm start Nebula
Write-Host "Listo. Nebula arranca con Windows. Registro: $root\data\nebula.log"
Write-Host "Quitarlo: nssm remove Nebula confirm"
