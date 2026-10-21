# Etapa 3.2 - testes do AGENDADOR DE JOBS com o servidor REAL.
#
# O que este script faz:
#   1. Garante Postgres de dev rodando (portatil do .tools).
#   2. Para o dev server atual e sobe um dev server com JOBS_RUN_TOKEN de teste
#      e PAYOUT_SANDBOX=1 (repasse semanal simulado - nenhum dinheiro real).
#   3. Roda .tools\test-jobs.mjs.
#   4. Restaura o dev server normal.
#
# Uso (a partir da raiz do projeto Freelaz):
#   powershell -ExecutionPolicy Bypass -File .tools\test-jobs.ps1 `
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
$devLog = Join-Path $env:TEMP "freelaz-jobs-dev.out"
$devErr = Join-Path $env:TEMP "freelaz-jobs-dev.err"
$startupHelperDir = Join-Path $env:TEMP "freelaz-jobs-startup-helper"

# Token de teste DESTA bateria (nunca o de produção; nunca é o .env real).
$TEST_JOBS_TOKEN = "jobs-token-de-teste-3.2-nao-usar-em-producao-0000"

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

# ---- 0. Postgres de dev portatil -----------------------------------------
if (-not (Get-PortPid 5432)) {
  Write-Host "### 0. Subindo Postgres portatil #############"
  $pgctl = Join-Path $root ".tools\pg\package\native\bin\pg_ctl.exe"
  $pgdata = Join-Path $root ".tools\pgdata"
  & $pgctl -D $pgdata -l (Join-Path $env:TEMP "freelaz-pg.log") start | Out-Null
  if (-not (Wait-Port 5432 60)) { throw "Postgres nao subiu na porta 5432" }
}

# ---- 1. Salva ambiente e para o server atual -----------------------------
$savedToken = $env:JOBS_RUN_TOKEN
Stop-Port $APP_PORT

$failed = $true
try {
  Write-Host "### 1. Dev server com JOBS_RUN_TOKEN de teste (PAYOUT_SANDBOX=1) ###"
  $env:JOBS_RUN_TOKEN = $TEST_JOBS_TOKEN
  $env:PAYOUT_SANDBOX = "1"
  Remove-Item $devLog, $devErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $BackendDir "node_modules\next\dist\bin\next"), "dev", "--port", "$APP_PORT") `
    -WorkingDirectory $BackendDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
  if (-not (Wait-Port $APP_PORT 180)) {
    Get-Content $devErr -ErrorAction SilentlyContinue | Select-Object -Last 20
    throw "dev server nao subiu na porta $APP_PORT"
  }
  Write-Host "  OK    dev server ouvindo em 127.0.0.1:$APP_PORT"

  Write-Host "`n### 1b. Compilando o helper de startup (funcao pura real) #####"
  Remove-Item $startupHelperDir -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location $BackendDir
  try {
    & npx tsc "src/lib/jobsStartup.ts" --outDir $startupHelperDir --module esnext --target es2020 --moduleResolution bundler 2>&1 | Out-Null
  } finally {
    Pop-Location
  }
  $helperJs = Join-Path $startupHelperDir "jobsStartup.js"
  if (-not (Test-Path $helperJs)) { throw "helper de startup nao compilou: $helperJs" }
  Write-Host "  OK    helper compilado em $helperJs"

  Write-Host "`n### 2. test-jobs.mjs #########################"
  $env:JOBS_RUN_TOKEN = $TEST_JOBS_TOKEN
  $env:JOBS_STARTUP_HELPER = $helperJs
  $env:JOBS_DEV_LOG = $devLog
  & $node (Join-Path $tools "test-jobs.mjs")
  if ($LASTEXITCODE -eq 0) { $failed = $false }
} finally {
  Stop-Port $APP_PORT
  Remove-Item Env:PAYOUT_SANDBOX -ErrorAction SilentlyContinue
  Remove-Item Env:JOBS_STARTUP_HELPER -ErrorAction SilentlyContinue
  Remove-Item Env:JOBS_DEV_LOG -ErrorAction SilentlyContinue
  if ($null -eq $savedToken) { Remove-Item Env:JOBS_RUN_TOKEN -ErrorAction SilentlyContinue }
  else { $env:JOBS_RUN_TOKEN = $savedToken }

  Write-Host "`n### 3. Dev server normal restaurado ##########"
  Remove-Item $devLog, $devErr -Force -ErrorAction SilentlyContinue
  Start-Process -FilePath $node `
    -ArgumentList @((Join-Path $BackendDir "node_modules\next\dist\bin\next"), "dev", "--port", "$APP_PORT") `
    -WorkingDirectory $BackendDir -WindowStyle Hidden `
    -RedirectStandardOutput $devLog -RedirectStandardError $devErr
  if (Wait-Port $APP_PORT 180) { Write-Host "  OK    dev server normal de volta em 127.0.0.1:$APP_PORT" }
  else { Write-Host "  AVISO dev server normal nao confirmou" -ForegroundColor Yellow }
}

if ($failed) { exit 1 }
Write-Host "`nEtapa 3.2 (agendador de jobs): todos os testes passaram."
exit 0
