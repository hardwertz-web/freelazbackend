# Teste ponta a ponta da Fase 3 (dinheiro):
#   carteira/extrato -> codigos de turno (RETIDO -> EM_ANDAMENTO -> CONCLUIDO)
#   -> saque instantaneo com taxa -> repasse semanal em lote (cron) ->
#   reconciliacao diaria -> travas de segredo interno.
#
# Por que este arquivo existe: o webhook do Mercado Pago (assinatura HMAC +
# credencial real) e a transferencia Pix de saida nao dao para simular sem
# sandbox. Entao o teste compila os servicos REAIS (hiringService +
# ledgerService) com tsc para CommonJS e roda o caminho do webhook via
# .tools/fase3-sim.js — nada e forjado no banco a mao. O repasse usa o provedor
# de SANDBOX (PAYOUT_SANDBOX=1), que confirma a transferencia sem mover dinheiro.
#
# E autossuficiente: cadastra as proprias contas (empresa3/ana3/bruno3) e aprova
# as verificacoes via Prisma, exatamente como o admin fara no Prisma Studio ate
# a Fase 5. O teste de codigos cria vagas que comecam/terminam dentro da janela
# do agendador (55-65 min a frente).
#
# Pre-requisito: banco recem-resetado (o normal e roda-lo via
# .tools/run-all-tests.ps1, que reseta antes) e servidor de dev no ar com
# PAYOUT_SANDBOX=1 e INTERNAL_API_SECRET definidos no .env.
#
# Uso (a partir da raiz do projeto Freelaz, com o servidor de dev no ar):
#   powershell -ExecutionPolicy Bypass -File .tools\test-fase3.ps1 `
#     -BackendDir .\freelaz-backend
param(
  [Parameter(Mandatory = $true)][string]$BackendDir
)

$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$BackendDir = (Resolve-Path $BackendDir).Path
$base = "http://localhost:3000"

# O Node portatil nao esta no PATH (ver README > "Node local portatil").
$env:PATH = "$(Join-Path $root '.tools\node-v20.20.2-win-x64');$env:PATH"
# O sim roda os servicos reais contra o banco: precisa da URL e de achar o
# @prisma/client do projeto (a pasta de build temporaria nao tem node_modules).
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/freelaz"
$env:NODE_PATH = Join-Path $BackendDir "node_modules"

# ---- Pre-requisitos lidos do .env do backend -----------------------------
# O segredo das rotas internas precisa ser o MESMO que o servidor carregou.
$envFile = Join-Path $BackendDir ".env"
$internalSecret = "dev-secret-local"
$sandbox = "0"
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\s*INTERNAL_API_SECRET\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $internalSecret = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
  $m = Select-String -Path $envFile -Pattern '^\s*PAYOUT_SANDBOX\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $sandbox = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
}
if ($sandbox -ne "1") {
  Write-Host "ERRO: PAYOUT_SANDBOX deve ser '1' no .env para o teste do repasse." -ForegroundColor Red
  Write-Host "      Ajuste o .env e REINICIE o servidor de dev antes de rodar." -ForegroundColor Red
  exit 1
}

$jarEmpresa = Join-Path $env:TEMP "freelaz-f3-empresa.txt"
$jarAna = Join-Path $env:TEMP "freelaz-f3-ana.txt"
$jarBruno = Join-Path $env:TEMP "freelaz-f3-bruno.txt"
$jarAnon = Join-Path $env:TEMP "freelaz-f3-anon.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-f3-body.json"
Remove-Item $jarEmpresa, $jarAna, $jarBruno, $jarAnon -Force -ErrorAction SilentlyContinue

$script:pass = 0
$script:fail = 0
$script:lastJson = ""
$script:jar = $jarAnon

function Call-Api {
  param([string]$Method, [string]$Path, [string]$Body = "", [int]$Expect, [hashtable]$Header)
  if ($Body) { Set-Content -Path $bodyFile -Value $Body -Encoding utf8 -NoNewline }
  $curlArgs = @("-s", "-X", $Method, "$base$Path", "-H", "Content-Type: application/json",
                "-b", $script:jar, "-c", $script:jar, "-w", "`n%{http_code}")
  if ($Header) { foreach ($k in $Header.Keys) { $curlArgs += @("-H", "${k}: $($Header[$k])") } }
  if ($Body) { $curlArgs += @("--data-binary", "@$bodyFile") }
  $raw = (& curl.exe @curlArgs) -join "`n"
  $code = ($raw -split "`n")[-1].Trim()
  $script:lastJson = ($raw -split "`n" | Select-Object -First (($raw -split "`n").Count - 1)) -join "`n"
  if ($code -eq "$Expect") {
    Write-Host "  OK    [$code] $Method $Path"
    $script:pass++
  } else {
    Write-Host "  FALHA [$code] $Method $Path (esperado $Expect)" -ForegroundColor Red
    Write-Host "        $script:lastJson"
    $script:fail++
  }
}

function Assert-True {
  param([bool]$Cond, [string]$Label)
  if ($Cond) { Write-Host "  OK    $Label"; $script:pass++ }
  else { Write-Host "  FALHA $Label" -ForegroundColor Red; $script:fail++ }
}

function Get-Json { return ($script:lastJson | ConvertFrom-Json) }

function Login {
  param([string]$Email, [string]$Password, [string]$Jar)
  Remove-Item $Jar -Force -ErrorAction SilentlyContinue
  $script:jar = $Jar
  Call-Api POST "/api/auth/login" (@{ email = $Email; password = $Password } | ConvertTo-Json -Compress) 200
}

# ---- Geradores de documento (mesmo modulo 11 do server) ------------------
# Self-check mais abaixo prova que a copia do algoritmo esta correta.
function Cpf-Dv {
  param([string]$N, [int[]]$W)
  $s = 0
  for ($i = 0; $i -lt $W.Length; $i++) { $s += ((([int]$N[$i]) - 48) * $W[$i]) }
  $r = $s % 11
  if ($r -lt 2) { return 0 } else { return 11 - $r }
}

function New-Cpf {
  param([string]$Base) # 9 digitos
  $d1 = Cpf-Dv $Base @(10, 9, 8, 7, 6, 5, 4, 3, 2)
  $d2 = Cpf-Dv "$Base$d1" @(11, 10, 9, 8, 7, 6, 5, 4, 3, 2)
  $digits = "$Base$d1$d2"
  return $digits.Insert(3, ".").Insert(7, ".").Insert(11, "-")
}

function New-Cnpj {
  param([string]$Base) # 12 caracteres
  $d1 = Cpf-Dv $Base @(5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
  $d2 = Cpf-Dv "$Base$d1" @(6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2)
  $digits = "$Base$d1$d2"
  return $digits.Insert(2, ".").Insert(6, ".").Insert(10, "/").Insert(15, "-")
}

# Publica uma vaga como o usuario do jar atual e devolve o id.
function New-Job {
  param([string]$Title, [string]$Category, [int]$Value, [string]$Starts, [string]$Ends)
  $body = @{
    title       = $Title
    description = "Vaga de teste da Fase 3 com descricao suficientemente longa."
    category    = $Category
    valueCents  = $Value
    startsAt    = $Starts
    endsAt      = $Ends
  } | ConvertTo-Json -Compress
  Call-Api POST "/api/jobs" $body 201
  return (Get-Json).jobPosting.id
}

# ---- Compilacao dos servicos reais para o sim ----------------------------
$build = Join-Path $env:TEMP "freelaz-f3-build"

function Build-Services {
  Write-Host "`n== Compilando os servicos reais (tsc -> CommonJS) para o sim =="
  Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location $BackendDir
  try {
    $out = & npx tsc --module commonjs --target es2019 --esModuleInterop `
      --skipLibCheck --moduleResolution node --outDir "$build" --rootDir "$BackendDir\src" `
      --noEmit false "$BackendDir\src\services\hiringService.ts" "$BackendDir\src\services\ledgerService.ts" 2>&1
  } finally {
    Pop-Location
  }
  $hasHiring = Test-Path (Join-Path $build "services\hiringService.js")
  $hasLedger = Test-Path (Join-Path $build "services\ledgerService.js")
  if ($hasHiring -and $hasLedger) {
    Write-Host "  OK    servicos compilados em $build"
    $script:pass++
  } else {
    Write-Host "  FALHA compilacao dos servicos" -ForegroundColor Red
    Write-Host ($out -join "`n")
    $script:fail++
  }
}

# Executa um caminho REAL via servico compilado (ver .tools/fase3-sim.js).
function Invoke-Sim {
  param([string]$Command, [string]$HiringId, [string]$Extra = "")
  $out = & node (Join-Path $tools "fase3-sim.js") $BackendDir $build $Command $HiringId $Extra
  $line = ($out | Select-Object -Last 1)
  $json = $null
  try { $json = $line | ConvertFrom-Json } catch { }
  if ($json -and $json.ok -eq $true) {
    Write-Host "  OK    sim $Command -> status=$($json.status) chat=$($json.chatStatus)"
    $script:pass++
  } else {
    Write-Host "  FALHA sim $Command ($HiringId)" -ForegroundColor Red
    Write-Host "        $line"
    $script:fail++
  }
  return $json
}

# Retroagir a hora de uso do codigo de fechamento — a janela de avaliacao de
# 2h (gate de repasse, Fase 4) bloqueia saque e lote enquanto nao passa. Nos
# cenarios em que o teste nao espera 2h de relogio, a hora e retroagida pelo
# caminho de dados (mesmo padrao do _approve-f3.js); o gate em si e testado
# na Fase 4.
function Set-ClosingCodeUsedAt {
  param([string]$HiringId, [int]$HoursAgo = 3)
  $js = @"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  await prisma.hiring.update({
    where: { id: "$HiringId" },
    data: { closingCodeUsedAt: new Date(Date.now() - $HoursAgo * 60 * 60 * 1000) },
  });
  await prisma.`$disconnect();
})();
"@
  $p = Join-Path $BackendDir "_window-f3.js"
  Set-Content -Path $p -Value $js -Encoding utf8
  & node $p
  if ($LASTEXITCODE -ne 0) { throw "retrocesso da janela de avaliacao falhou para $HiringId" }
  Remove-Item $p -Force
}

Build-Services

# ==========================================================================
Write-Host "`n== 0. Auto-checagem dos geradores de documento =="
Assert-True ((New-Cpf "123456789") -eq "123.456.789-09") "New-Cpf reproduz o CPF conhecido 123.456.789-09"
Assert-True ((New-Cnpj "123456780001") -eq "12.345.678/0001-95") "New-Cnpj reproduz o CNPJ conhecido 12.345.678/0001-95"

$cnpjEmpresa = New-Cnpj "333333330001"
$cpfAna = New-Cpf "234567890"
$cpfBruno = New-Cpf "345678901"

Write-Host "`n== 0b. Cadastro das contas de teste =="
$png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

$script:jar = $jarEmpresa
Call-Api POST "/api/auth/register" (@{
  documentType = "CNPJ"; document = $cnpjEmpresa; name = "Empresa Tres Freelaz Ltda"; tradeName = "Festa Tres"
  email = "empresa3@exemplo.com"; phone = "(35) 92000-0001"; password = "senhaSegura123"
  roles = @("CONTRATANTE"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$empresaId = (Get-Json).user.id

$script:jar = $jarAna
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfAna; name = "Ana Tres Souza"; birthDate = "1994-03-15"
  email = "ana3@exemplo.com"; phone = "(35) 92000-0002"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$anaId = (Get-Json).user.id

$script:jar = $jarBruno
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfBruno; name = "Bruno Tres Lima"; birthDate = "1991-07-22"
  email = "bruno3@exemplo.com"; phone = "(35) 92000-0003"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$brunoId = (Get-Json).user.id

Assert-True ([bool]$empresaId -and [bool]$anaId -and [bool]$brunoId) "ids das contas capturados"

# Envio da verificacao profissional (documento + selfie) para os dois.
$script:jar = $jarAna
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201
$script:jar = $jarBruno
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201

Write-Host "`n== 0c. Aprovando as verificacoes (como o admin no Prisma Studio) =="
$approve = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const ids = process.argv.slice(2);
(async () => {
  await prisma.userRoleAssignment.updateMany({ where: { role: "PROFISSIONAL", userId: { in: ids } }, data: { status: "ATIVO" } });
  await prisma.professionalProfile.updateMany({ where: { userId: { in: ids } }, data: { verificationStatus: "VERIFICADO" } });
  await prisma.identityVerification.updateMany({ where: { role: "PROFISSIONAL", userId: { in: ids } }, data: { status: "VERIFICADO", analyzedAt: new Date() } });
  const roles = await prisma.userRoleAssignment.findMany({ where: { userId: { in: ids } } });
  console.log(roles.map(r => r.role + ":" + r.status).join(","));
  await prisma.$disconnect();
})();
'@
$approvePath = Join-Path $BackendDir "_approve-f3.js"
Set-Content -Path $approvePath -Value $approve -Encoding utf8
$approveOut = & node $approvePath $anaId $brunoId
Remove-Item $approvePath -Force
Write-Host "        papeis: $approveOut"
Assert-True ($approveOut -match "PROFISSIONAL:ATIVO") "papeis Profissional ATIVO"

Login "empresa3@exemplo.com" "senhaSegura123" $jarEmpresa
Call-Api PUT "/api/profile/contractor" '{"city":"Itajuba","state":"MG"}' 200

Write-Host "`n== 0d. Chave Pix do profissional (destino do repasse) =="
Login "ana3@exemplo.com" "senhaSegura123" $jarAna
Call-Api PUT "/api/profile/professional" '{"pixKey":"ana3@exemplo.com"}' 200
Assert-True ((Get-Json).pixKey -eq "ana3@exemplo.com") "pixKey gravada e devolvida"
Call-Api GET "/api/profile/professional" "" 200
Assert-True ((Get-Json).pixKey -eq "ana3@exemplo.com") "pixKey sobrevive ao GET"

# ==========================================================================
Write-Host "`n== 1. Carteira: autorizacao e estado vazio =="
$script:jar = $jarAnon
Call-Api GET "/api/wallet" "" 401
$script:jar = $jarEmpresa
Call-Api GET "/api/wallet" "" 403
$script:jar = $jarAna
Call-Api GET "/api/wallet" "" 200
$w = (Get-Json).wallet
Assert-True ($w.aReceberCents -eq 0 -and $w.disponivelCents -eq 0 -and $w.emProcessamentoCents -eq 0 -and $w.sacadoCents -eq 0) "carteira zerada"
Assert-True ($w.instantWithdrawalFeeBps -eq 100) "taxa do saque instantaneo = 100 bps (1%)"
Assert-True (@((Get-Json).statement).Count -eq 0) "extrato vazio"

# ==========================================================================
Write-Host "`n== 2. Vaga na janela do agendador -> selecao -> RETIDO =="
$t0 = [DateTime]::UtcNow
$starts1 = $t0.AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends1 = $t0.AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$script:jar = $jarEmpresa
$job1 = New-Job "Bartender Fase 3" "bartender" 20000 $starts1 $ends1
Assert-True ([bool]$job1) "vaga 1 publicada (job1)"

$script:jar = $jarAna
Call-Api POST "/api/jobs/$job1/apply" "" 201
$app1 = (Get-Json).application.id

$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job1/select" (@{ applicationId = $app1 } | ConvertTo-Json -Compress) 200
$hiring1 = (Get-Json).application.hiring.id
Assert-True ([bool]$hiring1) "Hiring 1 criado na selecao"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiring1" "" 200
Assert-True ((Get-Json).hiring.status -eq "AGUARDANDO_PAGAMENTO") "Hiring 1 aguardando pagamento"
Assert-True (-not (Get-Json).hiring.openingCode) "codigo de abertura ainda nao existe"

Invoke-Sim "retido" $hiring1 "mp-f3-h1" | Out-Null

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiring1" "" 200
Assert-True ((Get-Json).hiring.status -eq "RETIDO") "Hiring 1 em RETIDO apos pagamento"
Call-Api GET "/api/wallet" "" 200
$w = (Get-Json).wallet
Assert-True ($w.aReceberCents -eq 18000 -and $w.disponivelCents -eq 0) "carteira: a receber 18000, disponivel 0"

# ==========================================================================
Write-Host "`n== 3. Codigos de turno (RETIDO -> EM_ANDAMENTO -> CONCLUIDO) =="
$secretHeader = @{ "x-internal-secret" = $internalSecret }

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 403
Call-Api POST "/api/cron/shift-codes" "" 403 -Header @{ "x-internal-secret" = "segredo-errado" }
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$codes = Get-Json
Assert-True ($codes.openingCodesGenerated -ge 1) "codigo de abertura gerado para o turno de ~1h"
Assert-True ($codes.closingCodesGenerated -eq 0) "nenhum codigo de fechamento (turno ainda nao comecou)"

$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hiring1" "" 200
$openingCode = (Get-Json).hiring.openingCode
Assert-True ([bool]$openingCode) "codigo de abertura visivel na contratacao"

Call-Api POST "/api/hirings/$hiring1/codes" '{"kind":"OPENING","code":"000000"}' 422
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hiring1/codes" (@{ kind = "OPENING"; code = $openingCode } | ConvertTo-Json -Compress) 403
$script:jar = $jarEmpresa
Call-Api POST "/api/hirings/$hiring1/codes" (@{ kind = "OPENING"; code = $openingCode } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).hiring.status -eq "EM_ANDAMENTO") "abertura confirmada -> EM_ANDAMENTO"

$script:jar = $jarAna
Call-Api GET "/api/wallet" "" 200
Assert-True ((Get-Json).wallet.aReceberCents -eq 18000) "em andamento ainda conta como a receber (18000)"

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
Assert-True ((Get-Json).closingCodesGenerated -ge 1) "codigo de fechamento gerado para o turno terminando em ~1h"

$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hiring1" "" 200
$closingCode = (Get-Json).hiring.closingCode
Assert-True ([bool]$closingCode) "codigo de fechamento visivel na contratacao"

Call-Api POST "/api/hirings/$hiring1/codes" '{"kind":"CLOSING","code":"000000"}' 422
Call-Api POST "/api/hirings/$hiring1/codes" (@{ kind = "CLOSING"; code = $closingCode } | ConvertTo-Json -Compress) 200
$closed = (Get-Json).hiring
Assert-True ($closed.status -eq "CONCLUIDO" -and [bool]$closed.closingCodeUsedAt) "fechamento confirmado -> CONCLUIDO com hora de uso"

$script:jar = $jarAna
Call-Api GET "/api/wallet" "" 200
$w = (Get-Json).wallet
Assert-True ($w.aReceberCents -eq 0 -and $w.disponivelCents -eq 18000) "concluido -> disponivel 18000, a receber 0"

# ==========================================================================
Write-Host "`n== 4. Saque instantaneo (com taxa de 1%) =="
# O saque instantaneo tambem passa pelo gate de janela de avaliacao (2h apos
# o uso do codigo de fechamento): retroagimos a hora para exercitar o caminho
# normal de repasse (o bloqueio em si esta na Fase 4).
Set-ClosingCodeUsedAt $hiring1
$script:jar = $jarAnon
Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 401
$script:jar = $jarEmpresa
Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 403
$script:jar = $jarBruno
Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 403

$script:jar = $jarAna
Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 200
$wd = Get-Json
Assert-True ($wd.payout.status -eq "CONCLUIDO") "saque -> Payout CONCLUIDO"
Assert-True ($wd.grossNetCents -eq 18000 -and $wd.feeCents -eq 180) "taxa = 180 centavos (1% de 18000)"
Assert-True ($wd.payout.amountCents -eq 17820) "valor transferido = 17820 (18000 - 180)"
Assert-True ($wd.payout.providerTransferId -like "sandbox:*") "transferencia confirmada pelo provedor de sandbox"

Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 409
Call-Api GET "/api/hirings/$hiring1" "" 200
$h1 = (Get-Json).hiring
Assert-True ($h1.status -eq "LIBERADO") "Hiring 1 LIBERADO apos saque"
Assert-True ($h1.payout.status -eq "CONCLUIDO" -and $h1.payout.amountCents -eq 17820) "payout 17820 no detalhe da contratacao"

Call-Api GET "/api/wallet" "" 200
$w = (Get-Json).wallet
Assert-True ($w.disponivelCents -eq 0 -and $w.sacadoCents -eq 17820 -and $w.emProcessamentoCents -eq 0) "carteira: sacado 17820, disponivel 0"
$stmt = (Get-Json).statement
$cred = @($stmt | Where-Object { $_.hiringId -eq $hiring1 -and $_.kind -eq "CREDITO" })[0]
$trf = @($stmt | Where-Object { $_.hiringId -eq $hiring1 -and $_.kind -eq "TRANSFERENCIA" })[0]
Assert-True ($cred.amountCents -eq 18000) "extrato: credito de 18000 (liquido)"
Assert-True ($trf.amountCents -eq 17820 -and $trf.feeCents -eq 180) "extrato: transferencia 17820 com taxa 180"

# ==========================================================================
Write-Host "`n== 5. Repasse semanal em lote (cron) =="
$t0 = [DateTime]::UtcNow
$starts2 = $t0.AddMinutes(120).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends2 = $t0.AddMinutes(180).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$script:jar = $jarEmpresa
$job2 = New-Job "Garcom Fase 3" "garcom" 15000 $starts2 $ends2
Assert-True ([bool]$job2) "vaga 2 publicada (job2)"

$script:jar = $jarAna
Call-Api POST "/api/jobs/$job2/apply" "" 201
$app2 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job2/select" (@{ applicationId = $app2 } | ConvertTo-Json -Compress) 200
$hiring2 = (Get-Json).application.hiring.id
Assert-True ([bool]$hiring2) "Hiring 2 criado na selecao"

Invoke-Sim "retido" $hiring2 "mp-f3-h2" | Out-Null
Invoke-Sim "status" $hiring2 "CONCLUIDO" | Out-Null
# Mesmo motivo da secao 4: o lote semanal do cron so repassa contratacoes cuja
# janela de avaliacao (2h) ja passou — retroagimos a hora para simular isso.
Set-ClosingCodeUsedAt $hiring2

$script:jar = $jarAna
Call-Api GET "/api/wallet" "" 200
Assert-True ((Get-Json).wallet.disponivelCents -eq 13500) "Hiring 2 concluido -> disponivel 13500"

$script:jar = $jarAnon
Call-Api POST "/api/cron/payouts" "" 403
Call-Api POST "/api/cron/payouts" "" 200 -Header $secretHeader
$batch = Get-Json
Assert-True (@($batch.failed).Count -eq 0) "nenhuma falha no lote"
Assert-True ((@($batch.released | Where-Object { $_ -eq $hiring2 })).Count -eq 1) "Hiring 2 repassado no lote"
Assert-True ($batch.eligible -ge 1) "lote teve ao menos 1 elegivel"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiring2" "" 200
$h2 = (Get-Json).hiring
Assert-True ($h2.status -eq "LIBERADO" -and $h2.payout.amountCents -eq 13500) "Hiring 2 LIBERADO com payout 13500 (sem taxa)"

Call-Api GET "/api/wallet" "" 200
Assert-True ((Get-Json).wallet.sacadoCents -eq 31320) "carteira: sacado acumulado 31320 (17820 + 13500)"

$script:jar = $jarAnon
Call-Api POST "/api/cron/payouts" "" 200 -Header $secretHeader
Assert-True ((Get-Json).eligible -eq 0 -and @((Get-Json).released).Count -eq 0) "segundo lote: nada elegivel (idempotente)"

# ==========================================================================
Write-Host "`n== 6. Reconciliacao diaria =="
$script:jar = $jarAnon
Call-Api POST "/api/cron/reconciliation" "" 403
Call-Api POST "/api/cron/reconciliation" "" 200 -Header $secretHeader
$rec = Get-Json
Assert-True ($rec.ok -eq $true) "reconciliacao OK"
Assert-True (@($rec.discrepancies).Count -eq 0) "nenhuma divergencia"
Assert-True ($rec.totals.releasedCount -ge 2) "ao menos 2 repasses concluidos contabilizados"
Assert-True ($rec.external.skipped -eq $true) "comparacao com extrato externo marcada como pulada"

# ==========================================================================
Write-Host "`n== 7. Travas da rota de liberacao direta =="
$script:jar = $jarAnon
Call-Api POST "/api/payouts/release" (@{ hiringId = $hiring1 } | ConvertTo-Json -Compress) 403
Call-Api POST "/api/payouts/release" '{}' 400 -Header $secretHeader
Call-Api POST "/api/payouts/release" '{"hiringId":"nao-existe"}' 422 -Header $secretHeader

Write-Host ""
Write-Host "== RESULTADO: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
