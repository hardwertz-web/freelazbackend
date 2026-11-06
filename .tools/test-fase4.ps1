# Teste ponta a ponta da Fase 4 (confianca) + migracao Asaas:
#   webhook Asaas REAL por HTTP (token) com duplicidade e concorrencia ->
#   check-in por geolocalizacao -> limite de tentativas de codigo (forca
#   bruta) -> cancelamento pelas duas partes -> disputas (antes/durante/depois
#   do servico, com as 3 decisoes) -> avaliacao mutua com janela de 2h ->
#   confiabilidade recalculada -> denuncias com prioridade -> travas admin.
#
# Por que este arquivo existe: o webhook do Asaas so exige um TOKEN de webhook
# no corpo (sem HMAC nem credencial quando ASAAS_API_KEY esta vazio) - entao
# esta bateria exercita o caminho REAL da rota HTTP, incluindo duplicidade e
# dois envios simultaneos (trava de linha no banco). Nada e forjado: todo
# status passa pelo webhook, pelos codigos de turno ou pelas rotas de servico.
#
# E autossuficiente: cadastra as proprias contas (empresa4/ana4/bruno4) e
# aprova as verificacoes via Prisma, exatamente como o admin faria no Prisma
# Studio ate a Fase 5. Vagas comecam dentro da janela do agendador (55-65 min).
#
# Pre-requisito: banco recem-resetado (roda-lo via .tools/run-all-tests.ps1)
# e servidor de dev no ar com ASAAS_WEBHOOK_TOKEN, INTERNAL_API_SECRET e
# PAYOUT_SANDBOX=1 no .env (sem ASAAS_API_KEY - as rotas de cobranca devem
# responder 503, e o webhook confia no payload apos o token).
#
# Uso (a partir da raiz do projeto Freelaz, com o servidor de dev no ar):
#   powershell -ExecutionPolicy Bypass -File .tools\test-fase4.ps1 `
#     -BackendDir .\freelaz-backend
param(
  [Parameter(Mandatory = $true)][string]$BackendDir
)

$tools = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $tools
$BackendDir = (Resolve-Path $BackendDir).Path
$base = "http://localhost:3000"

$env:PATH = "$(Join-Path $root '.tools\node-v20.20.2-win-x64');$env:PATH"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/freelaz"
$env:NODE_PATH = Join-Path $BackendDir "node_modules"

# ---- Pre-requisitos lidos do .env do backend -----------------------------
$envFile = Join-Path $BackendDir ".env"
$internalSecret = "dev-secret-local"
$webhookToken = ""
$sandbox = "0"
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\s*INTERNAL_API_SECRET\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $internalSecret = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
  $m = Select-String -Path $envFile -Pattern '^\s*ASAAS_WEBHOOK_TOKEN\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $webhookToken = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
  $m = Select-String -Path $envFile -Pattern '^\s*ASAAS_API_KEY\s*=\s*(.+)$' | Select-Object -First 1
  if ($m -and $m.Matches[0].Groups[1].Value.Trim().Trim('"') -ne "") {
    Write-Host "ERRO: ASAAS_API_KEY preenchido no .env - a bateria espera SEM credencial (503 nas rotas de cobranca)." -ForegroundColor Red
    exit 1
  }
  $m = Select-String -Path $envFile -Pattern '^\s*PAYOUT_SANDBOX\s*=\s*(.+)$' | Select-Object -First 1
  if ($m) { $sandbox = $m.Matches[0].Groups[1].Value.Trim().Trim('"') }
}
if (-not $webhookToken) {
  Write-Host "ERRO: ASAAS_WEBHOOK_TOKEN ausente no .env - o webhook recusaria ate o provedor de teste." -ForegroundColor Red
  exit 1
}
if ($sandbox -ne "1") {
  Write-Host "ERRO: PAYOUT_SANDBOX deve ser '1' no .env para o repasse de teste." -ForegroundColor Red
  exit 1
}

$jarEmpresa = Join-Path $env:TEMP "freelaz-f4-empresa.txt"
$jarAna = Join-Path $env:TEMP "freelaz-f4-ana.txt"
$jarBruno = Join-Path $env:TEMP "freelaz-f4-bruno.txt"
$jarAnon = Join-Path $env:TEMP "freelaz-f4-anon.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-f4-body.json"
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
    description = "Vaga de teste da Fase 4 com descricao suficientemente longa."
    category    = $Category
    valueCents  = $Value
    startsAt    = $Starts
    endsAt      = $Ends
  } | ConvertTo-Json -Compress
  Call-Api POST "/api/jobs" $body 201
  return (Get-Json).jobPosting.id
}

# ---- Helpers de banco e concorrencia (node direto) ------------------------
function Invoke-Db-Json {
  param([string]$Script)
  $tmpFile = [System.IO.Path]::GetTempFileName() + ".js"
  Set-Content -LiteralPath $tmpFile -Value $Script -Encoding utf8
  $output = & node $tmpFile
  if ($LASTEXITCODE -ne 0) { throw "script de banco falhou: $Script" }
  Remove-Item $tmpFile -Force
  return ($output | Out-String | ConvertFrom-Json)
}

function Invoke-Db {
  param([string]$Script)
  $tmpFile = [System.IO.Path]::GetTempFileName() + ".js"
  Set-Content -LiteralPath $tmpFile -Value $Script -Encoding utf8
  & node $tmpFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "script de banco falhou: $Script" }
  Remove-Item $tmpFile -Force
}

# Webhook do Asaas montado como o provedor de verdade enviaria: o segredo vai
# no CABEÇALHO oficial `asaas-access-token` (contrato docs.asaas.com) e o
# evento leva um `id` único (idempotência por event.id). `-EventId` permite
# REENTREGAR o mesmo evento (mesmo id) para exercitar o no-op de idempotência.
$script:webhookSeq = 0
function Send-Webhook {
  param([string]$HiringId, [double]$Value, [string]$Token, [string]$PaymentId, [int]$Expect, [string]$EventId = "")
  if (-not $EventId) {
    $script:webhookSeq++
    $EventId = "evt_f4_${PaymentId}_$($script:webhookSeq)"
  }
  $body = @{
    id      = $EventId
    event   = "PAYMENT_CONFIRMED"
    payment = @{
      id                = $PaymentId
      status            = "CONFIRMED"
      value             = $Value
      externalReference = $HiringId
    }
  } | ConvertTo-Json -Compress
  $script:jar = $jarAnon
  Call-Api POST "/api/webhooks/asaas" $body $Expect -Header @{ "asaas-access-token" = $Token }
}

$png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

# ==========================================================================
Write-Host "`n== 0. Auto-checagem dos geradores de documento =="
Assert-True ((New-Cpf "123456789") -eq "123.456.789-09") "New-Cpf reproduz o CPF conhecido 123.456.789-09"
Assert-True ((New-Cnpj "123456780001") -eq "12.345.678/0001-95") "New-Cnpj reproduz o CNPJ conhecido 12.345.678/0001-95"

$cnpjEmpresa = New-Cnpj "444444440001"
$cpfAna = New-Cpf "456789012"
$cpfBruno = New-Cpf "567890123"

Write-Host "`n== 0b. Cadastro das contas de teste =="
$script:jar = $jarEmpresa
Call-Api POST "/api/auth/register" (@{
  documentType = "CNPJ"; document = $cnpjEmpresa; name = "Empresa Quatro Freelaz Ltda"; tradeName = "Festa Quatro"
  email = "empresa4@exemplo.com"; phone = "(35) 92000-0004"; password = "senhaSegura123"
  roles = @("CONTRATANTE"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$empresaId = (Get-Json).user.id

$script:jar = $jarAna
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfAna; name = "Ana Quatro Souza"; birthDate = "1994-03-15"
  email = "ana4@exemplo.com"; phone = "(35) 92000-0005"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$anaId = (Get-Json).user.id

$script:jar = $jarBruno
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfBruno; name = "Bruno Quatro Lima"; birthDate = "1991-07-22"
  email = "bruno4@exemplo.com"; phone = "(35) 92000-0006"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$brunoId = (Get-Json).user.id

Assert-True ([bool]$empresaId -and [bool]$anaId -and [bool]$brunoId) "ids das contas capturados"

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
$approvePath = Join-Path $BackendDir "_approve-f4.js"
Set-Content -Path $approvePath -Value $approve -Encoding utf8
$approveOut = & node $approvePath $anaId $brunoId
Remove-Item $approvePath -Force
Write-Host "        papeis: $approveOut"
Assert-True ($approveOut -match "PROFISSIONAL:ATIVO") "papeis Profissional ATIVO"

Login "empresa4@exemplo.com" "senhaSegura123" $jarEmpresa
Call-Api PUT "/api/profile/contractor" '{"city":"Itajuba","state":"MG"}' 200

Write-Host "`n== 0d. Chave Pix do profissional (destino do repasse) =="
Login "ana4@exemplo.com" "senhaSegura123" $jarAna
Call-Api PUT "/api/profile/professional" '{"pixKey":"ana4@exemplo.com"}' 200
Assert-True ((Get-Json).pixKey -eq "ana4@exemplo.com") "pixKey gravada e devolvida"
$script:jar = $jarBruno
Call-Api PUT "/api/profile/professional" '{"pixKey":"bruno4@exemplo.com"}' 200

# ==========================================================================
Write-Host "`n== 1. Webhook Asaas REAL (HTTP): token, valor, duplicidade =="
$t0 = [DateTime]::UtcNow
$starts = $t0.AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = $t0.AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$script:jar = $jarEmpresa
$job1 = New-Job "Bartender Fase 4" "bartender" 20000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job1/apply" "" 201
$app1 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job1/select" (@{ applicationId = $app1 } | ConvertTo-Json -Compress) 200
$hW1 = (Get-Json).application.hiring.id
Assert-True ([bool]$hW1) "Hiring W1 criado na selecao"

Send-Webhook $hW1 200 "token-forjado" "pay-f4-bad" 401
Send-Webhook $hW1 999 $webhookToken "pay-f4-wrongvalue" 400
Send-Webhook "contratacao-nao-existe" 200 $webhookToken "pay-f4-unknown" 404
$w1EventId = "evt_f4_w1_fixo"
Send-Webhook $hW1 200 $webhookToken "pay-f4-w1" 200 -EventId $w1EventId

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW1" "" 200
$h1 = (Get-Json).hiring
Assert-True ($h1.status -eq "RETIDO") "W1 em RETIDO apos webhook valido"
Assert-True ($h1.chat.status -eq "ABERTO") "chat ABERTO no pagamento confirmado"
Assert-True ($h1.jobPosting.status -eq "PREENCHIDA") "vaga PREENCHIDA no pagamento confirmado"
$retW1 = @($h1.ledger | Where-Object { $_.type -eq "RETENCAO" })
Assert-True ($retW1.Count -eq 1 -and $retW1[0].amountCents -eq 20000) "exatamente 1 RETENCAO de 20000"

Send-Webhook $hW1 200 $webhookToken "pay-f4-w1" 200 -EventId $w1EventId
# Send-Webhook troca o jar ativo para anonimo; restaurar a sessao da Ana
# antes das leituras autenticadas abaixo.
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW1" "" 200
$retW1b = @((Get-Json).hiring.ledger | Where-Object { $_.type -eq "RETENCAO" })
Assert-True ($retW1b.Count -eq 1) "webhook duplicado nao duplica a retencao"

Call-Api GET "/api/wallet" "" 200
Assert-True ((Get-Json).wallet.aReceberCents -eq 18000) "carteira ana: a receber 18000 (10% de comissao)"

# Contratacao de Bruno para o teste de CONCORRENCIA (dois webhooks juntos)
$script:jar = $jarEmpresa
$job6 = New-Job "Faxineiro Fase 4" "faxina" 8000 $starts $ends
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$job6/apply" "" 201
$app6 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job6/select" (@{ applicationId = $app6 } | ConvertTo-Json -Compress) 200
$hW6 = (Get-Json).application.hiring.id

Write-Host "`n== 1b. Dois webhooks do MESMO pagamento em paralelo =="
$conc = @'
const [hiringId, value, token, paymentId] = process.argv.slice(2);
const url = "http://localhost:3000/api/webhooks/asaas";
// Duas ENTREGAS paralelas do mesmo pagamento, cada uma com um id de evento
// distinto (reenvio com id novo): a trava de linha serializa e apenas UMA
// retenção é gravada. O segredo vai no cabeçalho oficial.
const send = (n) => fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "asaas-access-token": token },
  body: JSON.stringify({
    id: `evt_f4_conc_${n}_${paymentId}`,
    event: "PAYMENT_CONFIRMED",
    payment: { id: paymentId, status: "CONFIRMED", value: Number(value), externalReference: hiringId },
  }),
}).then(r => r.status).catch(() => 0);
Promise.all([send(1), send(2)]).then(codes => console.log(JSON.stringify(codes.sort())));
'@
$concPath = Join-Path $BackendDir "_conc-f4.js"
Set-Content -Path $concPath -Value $conc -Encoding utf8
$concOut = (& node $concPath $hW6 80 $webhookToken "pay-f4-w6" | Out-String | ConvertFrom-Json)
Remove-Item $concPath -Force
Assert-True (@($concOut | Where-Object { $_ -eq 200 }).Count -eq 2) "os dois envios simultaneos responderam 200"

$script:jar = $jarBruno
Call-Api GET "/api/hirings/$hW6" "" 200
$h6 = (Get-Json).hiring
$retW6 = @($h6.ledger | Where-Object { $_.type -eq "RETENCAO" })
Assert-True ($h6.status -eq "RETIDO" -and $retW6.Count -eq 1 -and $retW6[0].amountCents -eq 8000) "concorrencia: 1 retencao de 8000, sem duplicidade"

# ==========================================================================
Write-Host "`n== 2. Check-in por geolocalizacao =="
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW1/check-in" (@{ latitude = -22.7555; longitude = -45.7033; accuracyMeters = 12 } | ConvertTo-Json -Compress) 201
$ci1 = (Get-Json).checkIn.id
Assert-True ([bool]$ci1) "check-in criado para a profissional"
Call-Api POST "/api/hirings/$hW1/check-in" (@{ latitude = -22.7555; longitude = -45.7033 } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).checkIn.id -eq $ci1) "check-in idempotente (mesmo registro)"
Call-Api POST "/api/hirings/$hW1/check-in" '{"latitude":999,"longitude":0}' 400

$script:jar = $jarEmpresa
Call-Api POST "/api/hirings/$hW1/check-in" (@{ latitude = 0; longitude = 0 } | ConvertTo-Json -Compress) 403
$script:jar = $jarBruno
Call-Api POST "/api/hirings/$hW1/check-in" (@{ latitude = 0; longitude = 0 } | ConvertTo-Json -Compress) 403
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW6/check-in" (@{ latitude = 0; longitude = 0 } | ConvertTo-Json -Compress) 403

# ==========================================================================
Write-Host "`n== 3. Limite de tentativas de codigo (forca bruta) =="
$secretHeader = @{ "x-internal-secret" = $internalSecret }
$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 403
Call-Api POST "/api/cron/shift-codes" "" 403 -Header @{ "x-internal-secret" = "segredo-errado" }
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
Assert-True ((Get-Json).openingCodesGenerated -ge 2) "codigos de abertura gerados (W1 e W6, as duas contratacoes na janela)"
Assert-True ((Get-Json).closingCodesGenerated -eq 0) "nenhum codigo de fechamento (nenhum turno em andamento)"

$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW1" "" 200
$openingW1 = (Get-Json).hiring.openingCode
Assert-True ([bool]$openingW1) "codigo de abertura visivel na contratacao"

for ($i = 1; $i -le 5; $i++) {
  Call-Api POST "/api/hirings/$hW1/codes" '{"kind":"OPENING","code":"000000"}' 422
}
Call-Api POST "/api/hirings/$hW1/codes" (@{ kind = "OPENING"; code = $openingW1 } | ConvertTo-Json -Compress) 422

$attemptCount = Invoke-Db-Json @"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const failed = await prisma.codeAttempt.count({ where: { hiringId: "$hW1", kind: "OPENING", success: false } });
  const ok = await prisma.codeAttempt.count({ where: { hiringId: "$hW1", kind: "OPENING", success: true } });
  console.log(JSON.stringify({ failed, ok }));
  await prisma.`$disconnect();
})();
"@
Assert-True ($attemptCount.failed -eq 5 -and $attemptCount.ok -eq 0) "auditoria: 5 tentativas falhas registradas; nem o codigo certo passou"
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW1" "" 200
Assert-True ((Get-Json).hiring.status -eq "RETIDO") "W1 segue RETIDO apos o bloqueio do canal"

# ==========================================================================
Write-Host "`n== 4. Cancelamento pelo profissional (reembolso de 100%) =="
$script:jar = $jarEmpresa
# Janela recalculada agora: o agendador so gera codigo para turno comecando
# em 55-65 min, e a bateria ja roda ha um tempo nesta altura.
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job2 = New-Job "Garcom Fase 4" "garcom" 15000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job2/apply" "" 201
$app2 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job2/select" (@{ applicationId = $app2 } | ConvertTo-Json -Compress) 200
$hW2 = (Get-Json).application.hiring.id
Send-Webhook $hW2 150 $webhookToken "pay-f4-w2" 200

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW2" "" 200
$openingW2 = (Get-Json).hiring.openingCode
Assert-True ([bool]$openingW2) "W2: codigo de abertura gerado (limite e POR contratacao)"
Call-Api POST "/api/hirings/$hW2/codes" (@{ kind = "OPENING"; code = $openingW2 } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).hiring.status -eq "EM_ANDAMENTO") "W2 inicia com o codigo certo apesar do bloqueio em W1"

$script:jar = $jarBruno
Call-Api POST "/api/hirings/$hW2/cancel" '{}' 403
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW2/cancel" '{}' 200
Assert-True ((Get-Json).refundCents -eq 15000 -and (Get-Json).feeCents -eq 0 -and (Get-Json).feePercent -eq 0) "cancelamento profissional: reembolso integral 15000, sem multa (refundCents/feeCents/feePercent)"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW2" "" 200
$h2 = (Get-Json).hiring
Assert-True ($h2.status -eq "CANCELADO") "W2 CANCELADO"
Assert-True (@($h2.ledger | Where-Object { $_.type -eq "REEMBOLSO" }).Count -eq 1) "REEMBOLSO registrado no ledger"
Assert-True ($h2.jobPosting.status -eq "ABERTA") "vaga reaberta para 'Retomar vaga'"
Call-Api GET "/api/wallet" "" 200
$w = (Get-Json).wallet
# Carteira da ANA: W2 reembolsada some da carteira; W1 segue RETIDO com
# 18000 de liquido a receber — W1 sera encerrada pela disputa da secao 5,
# nao pelo cancelamento. (W6 e do Bruno: outra carteira.)
Assert-True ($w.aReceberCents -eq 18000 -and $w.disponivelCents -eq 0) "reembolso de W2 some da carteira; so resta o liquido de W1 (RETIDO)"

# ==========================================================================
Write-Host "`n== 5. Disputa ANTES do servico (W1 bloqueado) + decisao devolucao =="
$script:jar = $jarBruno
Call-Api GET "/api/hirings/$hW1/dispute" "" 403
Call-Api POST "/api/hirings/$hW1/dispute" '{"reason":"tentativa de golpe"}' 403
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW1/dispute" '{}' 400
Call-Api POST "/api/hirings/$hW1/dispute" '{"reason":"Canal de codigos bloqueado por tentativas erradas da empresa"}' 201
$disputeW1 = (Get-Json).dispute.id
Assert-True ([bool]$disputeW1) "disputa aberta pela profissional"

Call-Api GET "/api/hirings/$hW1" "" 200
Assert-True ((Get-Json).hiring.status -eq "EM_DISPUTA" -and (Get-Json).hiring.disputeOpen -eq $true) "W1 EM_DISPUTA com flag de disputa"
$script:jar = $jarEmpresa
Call-Api POST "/api/hirings/$hW1/dispute" '{"reason":"empresa tambem quer abrir"}' 400

$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW1/dispute/evidence" (@{ file = $png; kind = "FOTO" } | ConvertTo-Json -Compress) 201
Call-Api GET "/api/hirings/$hW1/dispute" "" 200
Assert-True (@((Get-Json).disputes).Count -eq 1 -and @((Get-Json).disputes[0].evidences).Count -eq 1) "1 disputa com 1 evidencia"

$script:jar = $jarAnon
Call-Api GET "/api/admin/disputes" "" 403
Call-Api GET "/api/admin/disputes" "" 403 -Header @{ "x-internal-secret" = "segredo-errado" }
Call-Api GET "/api/admin/disputes" "" 200 -Header $secretHeader
Assert-True (@((Get-Json).disputes | Where-Object { $_.id -eq $disputeW1 }).Count -eq 1) "fila admin mostra a disputa em analise"

$resolveBase = "/api/admin/disputes/$disputeW1/resolve"
Call-Api POST $resolveBase '{"adminId":"admin-f4","resolution":"DEVOLUCAO_TOTAL","decisionNote":""}' 400 -Header $secretHeader
Call-Api POST $resolveBase '{"adminId":"","resolution":"DEVOLUCAO_TOTAL","decisionNote":"nota"}' 400 -Header $secretHeader
Call-Api POST $resolveBase '{"adminId":"admin-f4","resolution":"DIVISAO","decisionNote":"nota sem percentual"}' 400 -Header $secretHeader
Call-Api POST $resolveBase '{"adminId":"admin-f4","resolution":"DEVOLUCAO_TOTAL","decisionNote":"Canal bloqueado: devolucao integral a empresa"}' 200 -Header $secretHeader
Assert-True ($null -eq (Get-Json).payout -or (Get-Json).payout -eq $null) "devolucao total nao gera repasse"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW1" "" 200
$h1r = (Get-Json).hiring
Assert-True ($h1r.status -eq "CANCELADO") "W1 CANCELADO apos devolucao total"
Assert-True (@($h1r.ledger | Where-Object { $_.type -eq "REEMBOLSO" -and $_.amountCents -eq 20000 }).Count -eq 1) "20000 devolvidos a empresa"
Assert-True ($h1r.disputes[0].status -eq "RESOLVIDA" -and $h1r.disputes[0].decidedById -eq "admin-f4") "disputa resolvida com admin auditado"
Assert-True ($h1r.jobPosting.status -eq "ABERTA") "vaga reaberta pela devolucao"
# Contratacao em estado terminal (CANCELADO) nao reabre por cancelamento: 409.
Call-Api POST "/api/hirings/$hW1/cancel" '{}' 409
Call-Api POST "/api/hirings/$hW1/dispute/evidence" (@{ file = $png } | ConvertTo-Json -Compress) 409
Call-Api POST "/api/hirings/$hW1/dispute" '{"reason":"de novo"}' 400
Call-Api GET "/api/admin/disputes?status=RESOLVIDA" "" 200 -Header $secretHeader
Assert-True (@((Get-Json).disputes | Where-Object { $_.id -eq $disputeW1 }).Count -eq 1) "fila admin consulta disputas resolvidas"

# ==========================================================================
Write-Host "`n== 6. Fluxo completo + gate de avaliacao + notas (W3) =="
$script:jar = $jarEmpresa
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job3 = New-Job "Cozinheiro Fase 4" "cozinheiro" 12000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job3/apply" "" 201
$app3 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job3/select" (@{ applicationId = $app3 } | ConvertTo-Json -Compress) 200
$hW3 = (Get-Json).application.hiring.id
Send-Webhook $hW3 120 $webhookToken "pay-f4-w3" 200

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW3" "" 200
Call-Api POST "/api/hirings/$hW3/codes" (@{ kind = "OPENING"; code = (Get-Json).hiring.openingCode } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).hiring.status -eq "EM_ANDAMENTO") "W3 em andamento"

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
Assert-True ((Get-Json).closingCodesGenerated -ge 1) "codigo de fechamento gerado para o turno em andamento"
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW3" "" 200
$closingW3 = (Get-Json).hiring.closingCode
Call-Api POST "/api/hirings/$hW3/codes" (@{ kind = "CLOSING"; code = $closingW3 } | ConvertTo-Json -Compress) 200
$h3c = (Get-Json).hiring
Assert-True ($h3c.status -eq "CONCLUIDO" -and [bool]$h3c.closingCodeUsedAt) "W3 CONCLUIDO com hora do codigo de fechamento"

$script:jar = $jarAna
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 5 } | ConvertTo-Json -Compress) 400
Call-Api POST "/api/wallet/withdraw" (@{ hiringId = $hW3 } | ConvertTo-Json -Compress) 422

$script:jar = $jarAnon
Call-Api POST "/api/cron/payouts" "" 200 -Header $secretHeader
Assert-True ((Get-Json).eligible -eq 0) "lote ignora W3: janela de avaliacao ainda aberta"

$backdate = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  await prisma.hiring.update({ where: { id: process.argv[2] }, data: { closingCodeUsedAt: new Date(Date.now() - 3 * 60 * 60 * 1000) } });
  await prisma.$disconnect();
})();
'@
Invoke-Db $backdate.Replace('process.argv[2]', "`"$hW3`"") # janela retroagida: 2h ja passaram

$script:jar = $jarAna
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 5; comment = "Excelente empresa" } | ConvertTo-Json -Compress) 201
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 5 } | ConvertTo-Json -Compress) 400
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 6 } | ConvertTo-Json -Compress) 400
$script:jar = $jarBruno
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 5 } | ConvertTo-Json -Compress) 400
$script:jar = $jarEmpresa
Call-Api POST "/api/evaluations" (@{ hiringId = $hW3; rating = 4; comment = "Pontual" } | ConvertTo-Json -Compress) 201

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW3" "" 200
Assert-True (@((Get-Json).hiring.evaluations).Count -eq 2) "duas avaliacoes registradas (uma por parte)"

$ratings = Invoke-Db-Json @"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const prof = await prisma.professionalProfile.findUnique({ where: { userId: "$anaId" } });
  const contr = await prisma.contractorProfile.findUnique({ where: { userId: "$empresaId" } });
  console.log(JSON.stringify({ prof: prof ? prof.ratingAverage : null, contr: contr ? contr.ratingAverage : null }));
  await prisma.`$disconnect();
})();
"@
Assert-True ($ratings.prof -eq 4 -and $ratings.contr -eq 5) "medias de estrelas atualizadas nos perfis (4 e 5)"

$script:jar = $jarAnon
Call-Api POST "/api/cron/payouts" "" 200 -Header $secretHeader
Assert-True (@((Get-Json).released | Where-Object { $_ -eq $hW3 }).Count -eq 1) "W3 repassado no lote apos a janela"
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW3" "" 200
$h3 = (Get-Json).hiring
Assert-True ($h3.status -eq "LIBERADO" -and $h3.payout.amountCents -eq 10800) "W3 LIBERADO com payout de 10800 (liquido de 12000)"
Assert-True ($h3.payout.providerTransferId -like "sandbox:*") "transferencia confirmada pelo provedor de sandbox"
$rel = Invoke-Db-Json @"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const prof = await prisma.professionalProfile.findUnique({ where: { userId: "$anaId" } });
  console.log(JSON.stringify({ score: prof ? prof.reliabilityScore : null }));
  await prisma.`$disconnect();
})();
"@
Assert-True ($rel.score -eq 33.3) "confiabilidade 33.3 (1 limpa de 3 finalizadas)"

# ==========================================================================
Write-Host "`n== 7. Disputa DURANTE o servico + decisao DIVISAO (W4) =="
$script:jar = $jarEmpresa
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job4 = New-Job "Motorista Fase 4" "motorista" 10000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job4/apply" "" 201
$app4 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job4/select" (@{ applicationId = $app4 } | ConvertTo-Json -Compress) 200
$hW4 = (Get-Json).application.hiring.id
Send-Webhook $hW4 100 $webhookToken "pay-f4-w4" 200

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW4" "" 200
Call-Api POST "/api/hirings/$hW4/codes" (@{ kind = "OPENING"; code = (Get-Json).hiring.openingCode } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).hiring.status -eq "EM_ANDAMENTO") "W4 em andamento"

$script:jar = $jarEmpresa
Call-Api POST "/api/hirings/$hW4/dispute" '{"reason":"Cliente pagou a menos, combinamos outro valor"}' 201
$disputeW4 = (Get-Json).dispute.id
Call-Api POST "/api/admin/disputes/$disputeW4/resolve" (@{
  adminId = "admin-f4"; resolution = "DIVISAO"; splitPercentToProfessional = 50
  decisionNote = "Servico parcialmente executado: 50% do liquido ao profissional"
} | ConvertTo-Json -Compress) 200 -Header $secretHeader
Assert-True ((Get-Json).payout.amountCents -eq 4500) "payout de 4500 (50% do liquido de 9000)"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW4" "" 200
$h4 = (Get-Json).hiring
Assert-True ($h4.status -eq "LIBERADO") "W4 LIBERADO apos a divisao"
Assert-True (@($h4.ledger | Where-Object { $_.type -eq "REEMBOLSO" -and $_.amountCents -eq 4500 }).Count -eq 1) "4500 reembolsados a empresa"
Assert-True (@($h4.ledger | Where-Object { $_.type -eq "RETENCAO" }).Count -eq 1) "retencao unica preservada"

# ==========================================================================
Write-Host "`n== 8. Disputa DEPOIS do servico + LIBERACAO_TOTAL (W5) =="
$script:jar = $jarEmpresa
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job5 = New-Job "Fotografo Fase 4" "fotografo" 16000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job5/apply" "" 201
$app5 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job5/select" (@{ applicationId = $app5 } | ConvertTo-Json -Compress) 200
$hW5 = (Get-Json).application.hiring.id
Send-Webhook $hW5 160 $webhookToken "pay-f4-w5" 200

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW5" "" 200
Call-Api POST "/api/hirings/$hW5/codes" (@{ kind = "OPENING"; code = (Get-Json).hiring.openingCode } | ConvertTo-Json -Compress) 200
$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hW5" "" 200
Call-Api POST "/api/hirings/$hW5/codes" (@{ kind = "CLOSING"; code = (Get-Json).hiring.closingCode } | ConvertTo-Json -Compress) 200
Assert-True ((Get-Json).hiring.status -eq "CONCLUIDO") "W5 concluido pelo caminho real de codigos"

$script:jar = $jarAna
Call-Api POST "/api/hirings/$hW5/dispute" '{"reason":"Cliente nao aceitou o resultado e queria nao pagar nada"}' 201
$disputeW5 = (Get-Json).dispute.id
Call-Api POST "/api/admin/disputes/$disputeW5/resolve" (@{
  adminId = "admin-f4"; resolution = "LIBERACAO_TOTAL"
  decisionNote = "Servico executado e comprovado: repasse integral"
} | ConvertTo-Json -Compress) 200 -Header $secretHeader
Assert-True ((Get-Json).payout.amountCents -eq 14400) "payout integral de 14400"
Call-Api POST "/api/admin/disputes/$disputeW5/resolve" (@{
  adminId = "admin-f4"; resolution = "LIBERACAO_TOTAL"; decisionNote = "de novo"
} | ConvertTo-Json -Compress) 400 -Header $secretHeader

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hW5" "" 200
Assert-True ((Get-Json).hiring.status -eq "LIBERADO") "W5 LIBERADO"
$rel2 = Invoke-Db-Json @"
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const prof = await prisma.professionalProfile.findUnique({ where: { userId: "$anaId" } });
  console.log(JSON.stringify({ score: prof ? prof.reliabilityScore : null }));
  await prisma.`$disconnect();
})();
"@
Assert-True ($rel2.score -eq 60) "confiabilidade 60.0 (3 limpas de 5 finalizadas)"
Call-Api GET "/api/wallet" "" 200
Assert-True ((Get-Json).wallet.sacadoCents -eq 29700) "carteira: sacado acumulado 29700 (10800+4500+14400)"

# ==========================================================================
Write-Host "`n== 9. Rotas de cobranca sem credencial Asaas (503) =="
$script:jar = $jarEmpresa
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job7 = New-Job "Jardineiro Fase 4" "jardineiro" 9000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job7/apply" "" 201
$app7 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job7/select" (@{ applicationId = $app7 } | ConvertTo-Json -Compress) 200
$hW7 = (Get-Json).application.hiring.id

Call-Api POST "/api/payments/create" (@{ hiringId = $hW7 } | ConvertTo-Json -Compress) 503
Call-Api POST "/api/payments/create" (@{ hiringId = $hW1 } | ConvertTo-Json -Compress) 409
$script:jar = $jarBruno
Call-Api POST "/api/payments/create" (@{ hiringId = $hW7 } | ConvertTo-Json -Compress) 403
$script:jar = $jarAna
Call-Api POST "/api/payments/create" (@{ hiringId = $hW7 } | ConvertTo-Json -Compress) 403
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/boost" (@{ jobPostingId = $job7 } | ConvertTo-Json -Compress) 503
$script:jar = $jarAna
Call-Api POST "/api/jobs/boost" (@{ jobPostingId = $job7 } | ConvertTo-Json -Compress) 403

# ==========================================================================
Write-Host "`n== 10. Denuncias: fila separada, abuso prioritario =="
$script:jar = $jarAna
Call-Api POST "/api/reports" (@{ reportedId = $anaId; category = "OUTRO"; description = "auto" } | ConvertTo-Json -Compress) 400
Call-Api POST "/api/reports" (@{ reportedId = $brunoId; category = "CATEGORIA_INVALIDA"; description = "x" } | ConvertTo-Json -Compress) 400
Call-Api POST "/api/reports" (@{ reportedId = $brunoId; category = "NAO_COMPARECEU"; description = "Faltou ao turno sem avisar." } | ConvertTo-Json -Compress) 201
$reportNormal = (Get-Json).report.id
Call-Api POST "/api/reports" (@{ reportedId = $brunoId; category = "ABUSO"; description = "Ameacou a equipe durante o turno." } | ConvertTo-Json -Compress) 201
$reportAlta = (Get-Json).report.id
Assert-True ([bool]$reportNormal -and [bool]$reportAlta) "duas denuncias registradas"

$script:jar = $jarAnon
Call-Api GET "/api/admin/reports" "" 403
Call-Api GET "/api/admin/reports" "" 200 -Header $secretHeader
$reports = (Get-Json).reports
Assert-True ($reports[0].id -eq $reportAlta -and $reports[0].priority -eq "ALTA") "ABUSO primeiro na fila admin"
Call-Api POST "/api/admin/reports/$reportAlta/resolve" '{"adminId":"admin-f4","outcome":"ACAO_TOMADA","decisionNote":""}' 400 -Header $secretHeader
Call-Api POST "/api/admin/reports/$reportAlta/resolve" (@{
  adminId = "admin-f4"; outcome = "ACAO_TOMADA"; decisionNote = "Advertencia formal enviada"
} | ConvertTo-Json -Compress) 200 -Header $secretHeader
Assert-True ((Get-Json).report.status -eq "ACAO_TOMADA" -and (Get-Json).report.decidedById -eq "admin-f4") "denuncia encerrada com admin auditado"
Call-Api POST "/api/admin/reports/$reportAlta/resolve" (@{
  adminId = "admin-f4"; outcome = "ARQUIVADA"; decisionNote = "de novo"
} | ConvertTo-Json -Compress) 400 -Header $secretHeader

# ==========================================================================
Write-Host "`n== 11. Selecao dupla concorrente (uma vaga, duas selecoes) =="
$script:jar = $jarEmpresa
$starts = ([DateTime]::UtcNow).AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends = ([DateTime]::UtcNow).AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$job8 = New-Job "Selecao Dupla Fase 4" "bartender" 9000 $starts $ends
$script:jar = $jarAna
Call-Api POST "/api/jobs/$job8/apply" "" 201
$appA = (Get-Json).application.id
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$job8/apply" "" 201
$appB = (Get-Json).application.id

$selConc = @'
const [jobId, appA, appB, jarPath] = process.argv.slice(2);
const fs = require("fs");
const lines = fs.readFileSync(jarPath, "utf8").split(/\r?\n/).filter(l => l && (l.startsWith("#HttpOnly_") || !l.startsWith("#")));
const cookie = lines.map(l => { const f = l.split("\t"); return f[5] + "=" + f[6]; }).join("; ");
const send = (applicationId) => fetch("http://localhost:3000/api/jobs/" + jobId + "/select", {
  method: "POST",
  headers: { "Content-Type": "application/json", Cookie: cookie },
  body: JSON.stringify({ applicationId }),
}).then(r => r.status).catch(() => 0);
Promise.all([send(appA), send(appB)]).then(codes => console.log(JSON.stringify(codes.sort())));
'@
$selPath = Join-Path $BackendDir "_selconc-f4.js"
Set-Content -Path $selPath -Value $selConc -Encoding utf8
$selOut = (& node $selPath $job8 $appA $appB $jarEmpresa | Out-String | ConvertFrom-Json)
Remove-Item $selPath -Force
# A rota de selecao captura o erro do servico e devolve 422 (a segunda
# selecao perde a corrida: ou ve a contratacao ativa, ou esbarra no indice
# unico parcial Hiring_uma_contratacao_viva_por_vaga).
Assert-True (@($selOut).Count -eq 2 -and @($selOut)[0] -eq 200 -and @($selOut)[1] -eq 422) "duas selecoes simultaneas: exatamente 1 venceu (200), a outra recusada (422)"

Write-Host ""
Write-Host "== RESULTADO FASE 4: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
