# Bateria completa do projeto: reseta o banco UMA vez e roda, em ordem,
# Fase 1 (1a -> 1b -> 1c), Fase 2, Fase 3 e Fase 4 (confianca). Centraliza a
# sequencia exata num so lugar e para na primeira etapa que falhar (cada
# script devolve exit code != 0).
#
# Uso (a partir da raiz do projeto Freelaz):
#   powershell -ExecutionPolicy Bypass -File .tools\run-all-tests.ps1 `
#     -BackendDir .\freelaz-backend `
#     -LogFile "C:\caminho\do\log-do-npm-run-dev.out"
param(
  [Parameter(Mandatory = $true)][string]$BackendDir,
  [Parameter(Mandatory = $true)][string]$LogFile
)

$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$BackendDir = (Resolve-Path $BackendDir).Path
$env:PATH = "$(Join-Path $root '.tools\node-v20.20.2-win-x64');$env:PATH"

# Hermeticidade: a Fase 1c (boost) e a Fase 2 (payments/create) asseguram o
# guard "sem provedor configurado" (503). Com ASAAS_API_KEY preenchida no
# .env, o dev server chamaria o provedor REAL: as assercoes 503 falhariam e,
# pior, seriam criadas cobrancas de verdade no Sandbox. Logo esta bateria
# roda SOMENTE com a chave vazia. Para validar no Sandbox, use
# .tools\sandbox-etapa2.mjs com a chave restaurada (procedimento em
# .protocol\progress.md).
$envFile = Join-Path $BackendDir ".env"
$keyLine = Select-String -Path $envFile -Pattern '^\s*ASAAS_API_KEY\s*=\s*"?([^"\r\n]*)"?\s*$' | Select-Object -First 1
if ($keyLine -and $keyLine.Matches[0].Groups[1].Value.Trim() -ne "") {
  Write-Host "BLOQUEADO: ASAAS_API_KEY esta preenchida no .env do backend." -ForegroundColor Red
  Write-Host "A bateria local e 100% mock e depende do guard 503 (sem provedor)."
  Write-Host "Acao: esvazie a linha ASAAS_API_KEY no .env, rode a bateria de novo"
  Write-Host "e restaure a chave DEPOIS, apenas para a validacao no Sandbox."
  exit 1
}

Write-Host "### 0. Resetando o banco ################################"
Push-Location $BackendDir
try {
  npx prisma migrate reset --force --skip-generate 2>&1 | Select-Object -Last 4
} finally {
  Pop-Location
}

Write-Host "`n### 1/10. test-fase1.ps1 (Fase 1a) ########################"
& (Join-Path $tools "test-fase1.ps1")
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 1a" -ForegroundColor Red; exit 1 }

Write-Host "`n### 2/10. test-fase1b.ps1 (Fase 1b) #######################"
# O log e append-only: pegamos sempre o ULTIMO token de maria (o recem-gerado).
$line = (Select-String -Path $LogFile -Pattern "Token de confirma.*maria@exemplo.com" | Select-Object -Last 1).Line
if (-not $line) { Write-Host "ERRO: token de confirmacao nao encontrado em $LogFile" -ForegroundColor Red; exit 1 }
$token = ($line -split ": ")[-1].Trim()
& (Join-Path $tools "test-fase1b.ps1") -LogFile $LogFile -EmailToken $token
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 1b" -ForegroundColor Red; exit 1 }

Write-Host "`n### 3/10. test-fase1c.ps1 (Fase 1c) #######################"
& (Join-Path $tools "test-fase1c.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 1c" -ForegroundColor Red; exit 1 }

Write-Host "`n### 4/10. test-fase2.ps1 (Fase 2) #########################"
& (Join-Path $tools "test-fase2.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 2" -ForegroundColor Red; exit 1 }

Write-Host "`n### 5/10. test-fase3.ps1 (Fase 3) #########################"
& (Join-Path $tools "test-fase3.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 3" -ForegroundColor Red; exit 1 }

Write-Host "`n### 6/10. test-fase4.ps1 (Fase 4 - confianca) #############"
& (Join-Path $tools "test-fase4.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 4" -ForegroundColor Red; exit 1 }

Write-Host "`n### 7/10. test-fase5.ps1 (Fase 5 - painel admin) ##########"
& (Join-Path $tools "test-fase5.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Fase 5" -ForegroundColor Red; exit 1 }

Write-Host "`n### 8/10. test-idempotencia.ps1 (Etapa 1+2 - mock) ########"
# A Etapa 1 para/reinicia o dev server com ASAAS_API_URL apontando para o mock
# do Asaas (.tools\mock-asaas.mjs) e restaura o servidor normal ao final.
# Cenario 11 = customer por usuario (Etapa 2) exercitado no mesmo mock.
& (Join-Path $tools "test-idempotencia.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Etapa 1+2 (idempotencia + customer)" -ForegroundColor Red; exit 1 }

Write-Host "`n### 9/10. test-chargeback.ps1 (Etapa 3 - webhook/chargeback) ###"
# Autenticacao por cabecalho oficial, durabilidade/idempotencia por event.id,
# chargeback e bloqueio transacional de repasse. Sobe o dev server apontando
# para o mock do Asaas (PAYOUT_SANDBOX=1 — nenhum dinheiro real) e restaura ao
# final, como a Etapa 1+2.
& (Join-Path $tools "test-chargeback.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Etapa 3 (chargeback/webhook)" -ForegroundColor Red; exit 1 }

Write-Host "`n### 10/10. test-jobs.ps1 (Etapa 3.2 - agendador de jobs) ###"
# Auth por x-jobs-token (JOBS_RUN_TOKEN), idempotencia observada (2x sem efeito)
# e 404 de rota inexistente. Sobe o dev server com token de TESTE e
# PAYOUT_SANDBOX=1 (repasse semanal simulado) e restaura ao final.
& (Join-Path $tools "test-jobs.ps1") -BackendDir $BackendDir
if ($LASTEXITCODE -ne 0) { Write-Host "FALHOU: Etapa 3.2 (agendador de jobs)" -ForegroundColor Red; exit 1 }

Write-Host "`n### TUDO OK: Fase 1 (1a + 1b + 1c) + Fase 2 + Fase 3 + Fase 4 + Fase 5 + Etapa 1+2 + Etapa 3 + Etapa 3.2 ######" -ForegroundColor Green
