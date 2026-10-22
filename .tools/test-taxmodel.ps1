# Etapa 7.3d - testes do modelo de taxa "empresa paga tudo" (MOCK; sem subcontas).
#
# O que este script faz:
#   1. Garante Postgres de dev rodando (portatil do .tools).
#   2. Sobe o mock do Asaas (porta 4016) - NENHUMA chamada real.
#   3. Fase OFF: dev server com TAX_MODEL_NEW=false -> ?1, ?4, ?5.
#   4. Fase ON:  dev server com TAX_MODEL_NEW=true  -> ?2, ?3, ?4, ?5.
#   5. Restaura o dev server normal.
#
# Uso (a partir da raiz do projeto Freelaz):
#   powershell -ExecutionPolicy Bypass -File .tools\test-taxmodel.ps1 `
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

$APP_PORT = 3000
$MOCK_PORT = 4016
$devLog = Join-Path $env:TEMP "freelaz-taxmodel-dev.out"
$devErr = Join-Path $env:TEMP "freelaz-taxmodel-dev.err"
$mockLog = Join-Path $env:TEMP "freelaz-taxmodel-mock.out"
$mockErr = Join-Path $env:TEMP "freelaz-taxmodel-mock.err"

$envFile = Join-Path $BackendDir ".env"
if (Test-Path $envFile) {
  $t = Select-String -Path $envFile -Pattern '^\s*ASAAS_WEBHOOK_TOKEN\s*=\s*(.+)$' | Select-Object -First 1
  if (-not $t) { Write-Host "ERRO: ASAAS_WEBHOOK_TOKEN ausente no .env" -ForegroundColor Red; exit 1 }
}

function Get-PortPid([int]$Port) {
  $line = netstat -ano | Select-String ":$Port\s.*LISTENING" | Select-Object -First 1
  if (-not $line) { return $null }
  return [int](($line.ToString() -split "\s+")[-1])
}
function Stop-Port([int]$Port) {
  $pid_ = Get-PortPid $Port
  if ($pid_) { cmd /c "taskkill /PID $pid_ /F /T >nul 2>&1" | Out-Null; Start-Sleep -Seconds 1 }
}
function Wait-Port([int]$Port, [int]$TimeoutSec) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (Get-PortPid $Port) { return $true }
    Start-Sleep -Seconds 2
  }
  return $false
}

function Start-DevServer {
  Remove-Item $devLog, $devErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $BackendDir "node_modules\next\dist\bin\next"), "dev", "--port", "$APP_PORT") `
    -WorkingDirectory $BackendDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
}

# ---- 0. Postgres de dev portatil -----------------------------------------
if (-not (Get-PortPid 5432)) {
  Write-Host "### 0. Subindo Postgres portatil #############"
  $pgctl = Join-Path $root ".tools\pg\package\native\bin\pg_ctl.exe"
  $pgdata = Join-Path $root ".tools\pgdata"
  & $pgctl -D $pgdata -l (Join-Path $env:TEMP "freelaz-pg.log") start | Out-Null
  if (-not (Wait-Port 5432 60)) { throw "Postgres nao subiu na porta 5432" }
}

# ---- 1. Salva ambiente e para o server atual -----------------------------
$savedKey = $env:ASAAS_API_KEY
$savedUrl = $env:ASAAS_API_URL
$savedSandbox = $env:PAYOUT_SANDBOX
$savedFlag = $env:TAX_MODEL_NEW
$savedMock = $env:MOCK_ASAAS
$savedPhase = $env:TAX_MODEL_PHASE
$savedDevLog = $env:DEV_LOG
Stop-Port $APP_PORT
Stop-Port $MOCK_PORT

$failed = $true
try {
  # ---- 2. Mock do provedor ----------------------------------------------
  Write-Host "### 1. Mock do Asaas em 127.0.0.1:$MOCK_PORT ####"
  $env:MOCK_ASAAS_PORT = "$MOCK_PORT"
  Remove-Item $mockLog, $mockErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node -ArgumentList @((Join-Path $tools "mock-asaas.mjs")) `
    -WorkingDirectory $root -WindowStyle Hidden `
    -RedirectStandardOutput $mockLog -RedirectStandardError $mockErr
  if (-not (Wait-Port $MOCK_PORT 30)) {
    Get-Content $mockErr -ErrorAction SilentlyContinue | Select-Object -Last 10
    throw "mock nao subiu na porta $MOCK_PORT"
  }
  Write-Host "  OK    mock ouvindo em 127.0.0.1:$MOCK_PORT"

  # Ambiente comum as duas fases (provedor MOCK, nenhum dinheiro real).
  $env:ASAAS_API_KEY = "aact_mock_etapa73d_sem_valor_real"
  $env:ASAAS_API_URL = "http://127.0.0.1:$MOCK_PORT/v3"
  $env:PAYOUT_SANDBOX = "1"
  $env:MOCK_ASAAS = "http://127.0.0.1:$MOCK_PORT"
  $env:DEV_LOG = $devLog

  $exitOff = 1
  $exitOn = 1

  # ---- 3. Fase OFF: modelo historico ------------------------------------
  Write-Host "`n### 2. Dev server com TAX_MODEL_NEW=false ####"
  $env:TAX_MODEL_NEW = "false"
  Start-DevServer
  if (-not (Wait-Port $APP_PORT 180)) {
    Get-Content $devErr -ErrorAction SilentlyContinue | Select-Object -Last 20
    throw "dev server (off) nao subiu na porta $APP_PORT"
  }
  Write-Host "`n### 3. test-taxmodel.mjs - fase OFF (?1/?4/?5) ########"
  $env:TAX_MODEL_PHASE = "off"
  & $node (Join-Path $tools "test-taxmodel.mjs")
  $exitOff = $LASTEXITCODE

  # ---- 4. Fase ON: modelo empresa-paga ----------------------------------
  Write-Host "`n### 4. Reiniciando dev server com TAX_MODEL_NEW=true ####"
  Stop-Port $APP_PORT
  $env:TAX_MODEL_NEW = "true"
  Start-DevServer
  if (-not (Wait-Port $APP_PORT 180)) {
    Get-Content $devErr -ErrorAction SilentlyContinue | Select-Object -Last 20
    throw "dev server (on) nao subiu na porta $APP_PORT"
  }
  Write-Host "`n### 5. test-taxmodel.mjs - fase ON (?2/?3/?4/?5) #########"
  $env:TAX_MODEL_PHASE = "on"
  & $node (Join-Path $tools "test-taxmodel.mjs")
  $exitOn = $LASTEXITCODE

  if ($exitOff -eq 0 -and $exitOn -eq 0) { $failed = $false }
  Write-Host "`nRESULTADO: fase OFF exit=$exitOff | fase ON exit=$exitOn"
} finally {
  Stop-Port $APP_PORT
  Stop-Port $MOCK_PORT
  Remove-Item Env:MOCK_ASAAS_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:MOCK_ASAAS -ErrorAction SilentlyContinue
  Remove-Item Env:TAX_MODEL_PHASE -ErrorAction SilentlyContinue
  Remove-Item Env:DEV_LOG -ErrorAction SilentlyContinue
  if ($null -eq $savedSandbox) { Remove-Item Env:PAYOUT_SANDBOX -ErrorAction SilentlyContinue }
  else { $env:PAYOUT_SANDBOX = $savedSandbox }
  if ($null -eq $savedFlag) { Remove-Item Env:TAX_MODEL_NEW -ErrorAction SilentlyContinue }
  else { $env:TAX_MODEL_NEW = $savedFlag }
  if ($null -eq $savedKey) { Remove-Item Env:ASAAS_API_KEY -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_KEY = $savedKey }
  if ($null -eq $savedUrl) { Remove-Item Env:ASAAS_API_URL -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_URL = $savedUrl }
  if ($null -eq $savedMock) { Remove-Item Env:MOCK_ASAAS -ErrorAction SilentlyContinue }
  else { $env:MOCK_ASAAS = $savedMock }
  if ($null -eq $savedPhase) { Remove-Item Env:TAX_MODEL_PHASE -ErrorAction SilentlyContinue }
  else { $env:TAX_MODEL_PHASE = $savedPhase }
  if ($null -eq $savedDevLog) { Remove-Item Env:DEV_LOG -ErrorAction SilentlyContinue }
  else { $env:DEV_LOG = $savedDevLog }

  Write-Host "`n### 6. Dev server normal restaurado ##########"
  Start-DevServer
  if (Wait-Port $APP_PORT 180) { Write-Host "  OK    dev server normal de volta em 127.0.0.1:$APP_PORT" }
  else { Write-Host "  AVISO dev server normal nao confirmou" -ForegroundColor Yellow }
}

if ($failed) { exit 1 }
Write-Host "`nEtapa 7.3d (modelo de taxa): todos os testes passaram."
exit 0
