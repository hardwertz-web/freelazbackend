# Etapa 1 - testes de idempotencia de cobranca com provedor MOCK controlado.
#
# O que este script faz:
#   1. Garante Postgres de dev rodando (portatil do .tools) e para o dev server
#      atual e um mock do Asaas em 127.0.0.1:4010.
#   2. Sobe o dev server COM ASAAS_API_KEY de mock + ASAAS_API_URL apontando
#      para o mock (nenhuma credencial real, nenhum dinheiro real).
#   3. Roda .tools\test-idempotencia.mjs (as 11 baterias de cenarios).
#   4. Encerra mock e server, restaura o ambiente e sobe o dev server NORMAL
#      (sem credencial), deixando o ambiente como encontrou.
#
# Uso (a partir da raiz do projeto Freelaz):
#   powershell -ExecutionPolicy Bypass -File .tools\test-idempotencia.ps1 `
#     -BackendDir .\freelaz-backend
param(
  [Parameter(Mandatory = $true)][string]$BackendDir
)

$ErrorActionPreference = "Stop"
$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$BackendDir = (Resolve-Path $BackendDir).Path
$node = Join-Path $root ".tools\node-v20.20.2-win-x64\node.exe"
$env:PATH = "$(Join-Path $root '.tools\node-v20.20.2-win-x64');$env:PATH"

$MOCK_PORT = 4010
$APP_PORT = 3000
$devLog = Join-Path $env:TEMP "freelaz-idem-dev.out"
$devErr = Join-Path $env:TEMP "freelaz-idem-dev.err"
$mockLog = Join-Path $env:TEMP "freelaz-idem-mock.out"
$mockErr = Join-Path $env:TEMP "freelaz-idem-mock.err"

function Get-PortPid([int]$Port) {
  $line = netstat -ano | Select-String ":$Port\s.*LISTENING" | Select-Object -First 1
  if (-not $line) { return $null }
  return [int](($line.ToString() -split "\s+")[-1])
}

function Stop-Port([int]$Port) {
  $pid_ = Get-PortPid $Port
  if ($pid_) {
    cmd /c "taskkill /PID $pid_ /F /T >nul 2>&1" | Out-Null
    Start-Sleep -Seconds 1
  }
}

function Wait-Port([int]$Port, [int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Get-PortPid $Port) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

# ---- 0. Postgres de dev portatil -----------------------------------------
if (-not (Get-PortPid 5432)) {
  Write-Host "### 0. Subindo Postgres portatil #############"
  $pgctl = Join-Path $root ".tools\pg\package\native\bin\pg_ctl.exe"
  $pgdata = Join-Path $root ".tools\pgdata"
  & $pgctl -D $pgdata -l (Join-Path $env:TEMP "freelaz-pg.log") start | Out-Null
  if (-not (Wait-Port 5432 60)) { throw "Postgres nao subiu na porta 5432" }
}

# ---- 1. Salva ambiente e para processos atuais ---------------------------
$savedKey = $env:ASAAS_API_KEY
$savedUrl = $env:ASAAS_API_URL
Stop-Port $APP_PORT
Stop-Port $MOCK_PORT

$failed = $true
try {
  # ---- 2. Mock do provedor ----------------------------------------------
  Write-Host "### 1. Mock do Asaas em 127.0.0.1:$MOCK_PORT ####"
  Remove-Item $mockLog, $mockErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node -ArgumentList @((Join-Path $tools "mock-asaas.mjs")) `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $mockLog -RedirectStandardError $mockErr
  if (-not (Wait-Port $MOCK_PORT 30)) {
    Get-Content $mockErr -ErrorAction SilentlyContinue | Select-Object -Last 10
    throw "mock nao subiu na porta $MOCK_PORT"
  }
  Write-Host "  OK    mock ouvindo em 127.0.0.1:$MOCK_PORT"

  # ---- 3. Dev server apontando para o mock -------------------------------
  Write-Host "### 2. Dev server com ASAAS_API_URL = mock ###"
  $env:ASAAS_API_KEY = "aact_mock_etapa1_sem_valor_real"
  $env:ASAAS_API_URL = "http://127.0.0.1:$MOCK_PORT/v3"
  Remove-Item $devLog, $devErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $BackendDir "node_modules\next\dist\bin\next"), "dev", "--port", "$APP_PORT") `
    -WorkingDirectory $BackendDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
  if (-not (Wait-Port $APP_PORT 120)) {
    Get-Content $devErr -ErrorAction SilentlyContinue | Select-Object -Last 15
    throw "dev server nao subiu na porta $APP_PORT"
  }
  Write-Host "  OK    dev server ouvindo em 127.0.0.1:$APP_PORT (provedor = mock)"

  # ---- 4. Bateria da Etapa 1 --------------------------------------------
  Write-Host "`n### 3. test-idempotencia.mjs #################"
  & $node (Join-Path $tools "test-idempotencia.mjs")
  if ($LASTEXITCODE -eq 0) { $failed = $false }
} finally {
  # ---- 5. Restaura o ambiente sempre ------------------------------------
  Stop-Port $APP_PORT
  Stop-Port $MOCK_PORT
  if ($null -eq $savedKey) { Remove-Item Env:ASAAS_API_KEY -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_KEY = $savedKey }
  if ($null -eq $savedUrl) { Remove-Item Env:ASAAS_API_URL -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_URL = $savedUrl }

  Write-Host "`n### 4. Dev server normal restaurado ##########"
  Remove-Item $devLog, $devErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $BackendDir "node_modules\next\dist\bin\next"), "dev", "--port", "$APP_PORT") `
    -WorkingDirectory $BackendDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
  if (Wait-Port $APP_PORT 120) { Write-Host "  OK    dev server normal de volta em 127.0.0.1:$APP_PORT" }
  else { Write-Host "  AVISO dev server normal nao confirmou apos 120s" -ForegroundColor Yellow }
}

if ($failed) { exit 1 }
Write-Host "`nEtapa 1+2 (mock): todos os testes passaram."
exit 0
