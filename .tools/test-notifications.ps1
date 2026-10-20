# Etapa 7 - Fase B - testes de NOTIFICACOES (in-app + email) e readAt de chat.
#
# O que este script faz:
#   1. Garante Postgres de dev rodando (portatil do .tools).
#   2. Para o dev server atual e sobe um dev server com:
#      - JOBS_RUN_TOKEN de TESTE (para exercitar /api/jobs/*/run);
#      - ASAAS_API_URL apontando para o mock do Asaas (PAYOUT_SANDBOX=1);
#      - EMAIL_TRANSPORT=json + EMAIL_CAPTURE_FILE (NENHUM e-mail real sai);
#      - SEM ASAAS_API_KEY.
#   3. Roda .tools\test-notifications.mjs.
#   4. Restaura o dev server normal.
#
# Uso (a partir da raiz do projeto Freelaz):
#   powershell -ExecutionPolicy Bypass -File .tools\test-notifications.ps1 `
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
$MOCK_PORT = 4013
$devLog = Join-Path $env:TEMP "freelaz-notif-dev.out"
$devErr = Join-Path $env:TEMP "freelaz-notif-dev.err"
$mockLog = Join-Path $env:TEMP "freelaz-notif-mock.out"
$mockErr = Join-Path $env:TEMP "freelaz-notif-mock.err"

# Captura de e-mails (JSONL) — fora do git (ver .gitignore: .tools/tmp/).
$tmpDir = Join-Path $tools "tmp"
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$captureFile = Join-Path $tmpDir "emails.jsonl"

# Token de teste DESTA bateria (nunca o de producao; nunca e o .env real).
$TEST_JOBS_TOKEN = "jobs-token-de-teste-etapa7-nao-usar-em-producao-000"

# A bateria precisa de ASAAS_WEBHOOK_TOKEN no .env.
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
  # `cmd /c` isola o stderr do taskkill: sob $ErrorActionPreference=Stop o
  # stderr nativo (ex.: PID ja morto) abortaria este script sem necessidade.
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
$savedJobs = $env:JOBS_RUN_TOKEN
$savedTransport = $env:EMAIL_TRANSPORT
$savedCapture = $env:EMAIL_CAPTURE_FILE
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

  Write-Host "### 2. Dev server (mock + JOBS token + EMAIL json) #####"
  $env:ASAAS_API_KEY = "aact_mock_etapa7_sem_valor_real"
  $env:ASAAS_API_URL = "http://127.0.0.1:$MOCK_PORT/v3"
  $env:PAYOUT_SANDBOX = "1"
  $env:JOBS_RUN_TOKEN = $TEST_JOBS_TOKEN
  $env:EMAIL_TRANSPORT = "json"
  $env:EMAIL_CAPTURE_FILE = $captureFile
  # Zera a captura para o §5 assertar o e-mail DESTA execucao.
  Remove-Item $captureFile -Force -ErrorAction SilentlyContinue
  Start-DevServer
  if (-not (Wait-Port $APP_PORT 180)) {
    Get-Content $devErr -ErrorAction SilentlyContinue | Select-Object -Last 20
    throw "dev server nao subiu na porta $APP_PORT"
  }
  Write-Host "  OK    dev server ouvindo em 127.0.0.1:$APP_PORT (provedor = mock)"

  Write-Host "`n### 3. test-notifications.mjs ################"
  $env:MOCK_ASAAS = "http://127.0.0.1:$MOCK_PORT"
  $env:JOBS_RUN_TOKEN = $TEST_JOBS_TOKEN
  $env:EMAIL_CAPTURE_FILE = $captureFile
  & $node (Join-Path $tools "test-notifications.mjs")
  if ($LASTEXITCODE -eq 0) { $failed = $false }
} finally {
  Stop-Port $APP_PORT
  Stop-Port $MOCK_PORT
  Remove-Item Env:PAYOUT_SANDBOX -ErrorAction SilentlyContinue
  Remove-Item Env:MOCK_ASAAS -ErrorAction SilentlyContinue
  Remove-Item Env:MOCK_ASAAS_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:EMAIL_TRANSPORT -ErrorAction SilentlyContinue
  Remove-Item Env:EMAIL_CAPTURE_FILE -ErrorAction SilentlyContinue
  if ($null -eq $savedKey) { Remove-Item Env:ASAAS_API_KEY -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_KEY = $savedKey }
  if ($null -eq $savedUrl) { Remove-Item Env:ASAAS_API_URL -ErrorAction SilentlyContinue }
  else { $env:ASAAS_API_URL = $savedUrl }
  if ($null -eq $savedJobs) { Remove-Item Env:JOBS_RUN_TOKEN -ErrorAction SilentlyContinue }
  else { $env:JOBS_RUN_TOKEN = $savedJobs }
  if ($null -eq $savedTransport) { Remove-Item Env:EMAIL_TRANSPORT -ErrorAction SilentlyContinue }
  else { $env:EMAIL_TRANSPORT = $savedTransport }
  if ($null -eq $savedCapture) { Remove-Item Env:EMAIL_CAPTURE_FILE -ErrorAction SilentlyContinue }
  else { $env:EMAIL_CAPTURE_FILE = $savedCapture }

  Write-Host "`n### 4. Dev server normal restaurado ##########"
  Start-DevServer
  if (Wait-Port $APP_PORT 180) { Write-Host "  OK    dev server normal de volta em 127.0.0.1:$APP_PORT" }
  else { Write-Host "  AVISO dev server normal nao confirmou" -ForegroundColor Yellow }
}

if ($failed) { exit 1 }
Write-Host "`nEtapa 7 (notificacoes): todos os testes passaram."
exit 0
