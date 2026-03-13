$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$pwDir = Join-Path $env:TEMP 'fh-playwright'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$serverLogName = "tmp-live-server-$stamp.log"
$clientLogName = "tmp-live-client-$stamp.log"
$browserLogName = "tmp-live-browser-$stamp.log"
$serverLog = Join-Path $root $serverLogName
$clientLog = Join-Path $root $clientLogName
$browserLog = Join-Path $root $browserLogName
$browserScript = Join-Path $root 'scripts/live_browser_session.js'

function Stop-ListeningProcesses {
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 8080, 5173 } |
    Select-Object -ExpandProperty OwningProcess -Unique |
    ForEach-Object {
      if (Get-Process -Id $_ -ErrorAction SilentlyContinue) {
        Stop-Process -Id $_ -Force
      }
    }
}

function Wait-ForPorts {
  param([int[]]$Ports, [int]$TimeoutSec = 20)

  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $listening = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $Ports }
    $allReady = $true
    foreach ($port in $Ports) {
      if (!($listening.LocalPort -contains $port)) {
        $allReady = $false
        break
      }
    }
    if ($allReady) {
      return $true
    }
    Start-Sleep -Milliseconds 500
  }

  return $false
}

Stop-ListeningProcesses
Start-Sleep -Seconds 1

$server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',"npm run start -w server > $serverLogName 2>&1" -WorkingDirectory $root -PassThru
$client = Start-Process -FilePath 'cmd.exe' -ArgumentList '/d','/s','/c',"npm run dev -w client -- --host 127.0.0.1 > $clientLogName 2>&1" -WorkingDirectory $root -PassThru

try {
  if (!(Test-Path (Join-Path $pwDir 'node_modules/playwright'))) {
    if (!(Test-Path $pwDir)) {
      New-Item -ItemType Directory -Path $pwDir | Out-Null
    }
    Push-Location $pwDir
    try {
      if (!(Test-Path 'package.json')) {
        npm init -y | Out-Null
      }
      npm install playwright --no-fund --no-audit | Out-Null
    } finally {
      Pop-Location
    }
  }

  if (!(Wait-ForPorts -Ports @(8080, 5173))) {
    Write-Output 'STARTUP_FAILED'
    Write-Output 'SERVER_LOG_BEGIN'
    if (Test-Path $serverLog) { Get-Content $serverLog }
    Write-Output 'SERVER_LOG_END'
    Write-Output 'CLIENT_LOG_BEGIN'
    if (Test-Path $clientLog) { Get-Content $clientLog }
    Write-Output 'CLIENT_LOG_END'
    throw 'Server/client did not both come up'
  }

  Push-Location $pwDir
  try {
    node $browserScript 2>&1 | Tee-Object -FilePath $browserLog
  } finally {
    Pop-Location
  }
} finally {
  Write-Output 'SERVER_TAIL_BEGIN'
  if (Test-Path $serverLog) { Get-Content $serverLog -Tail 120 }
  Write-Output 'SERVER_TAIL_END'
  Write-Output 'CLIENT_TAIL_BEGIN'
  if (Test-Path $clientLog) { Get-Content $clientLog -Tail 80 }
  Write-Output 'CLIENT_TAIL_END'

  if (Get-Process -Id $server.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $server.Id -Force }
  if (Get-Process -Id $client.Id -ErrorAction SilentlyContinue) { Stop-Process -Id $client.Id -Force }
}
