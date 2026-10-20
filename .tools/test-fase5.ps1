# Teste ponta a ponta da Fase 5 (painel administrativo):
#   bootstrap do papel ADMIN (fora da API) -> autorizacao rigorosa das rotas
#   /api/admin/* (anonimo/usuario comum/segredo/sessao ADMIN) -> fila de
#   identidade com documento MASCARADO -> acesso admin aos arquivos de prova
#   (documento/selfie) -> aprovacao transacional -> rejeicao com motivo +
#   reenvio -> contratacao real ate CONCLUIDO pelos codigos de turno ->
#   consultas (contratacoes/repasses/ledger) -> reconciliacao -> lote de
#   repasses disparado pelo painel -> disputa e denuncia decididas com
#   auditoria do id DA SESSAO -> historico financeiro intocado por denuncia.
#
# Por que este arquivo existe: a Fase 5 troca a aprovacao manual no Prisma
# Studio por um painel com a MESMA regra (aprovacao humana) e adiciona um
# caminho de autorizacao por SESSAO ADMIN ao lado do segredo interno. Nada e
# forjado: a contratacao passa por webhook/codigos reais, a aprovacao de
# identidade e testada pela rota nova, e o id auditado das decisoes e
# conferido no banco.
#
# E autossuficiente: cadastra as proprias contas (empresa5/ana5/bruno5) e
# concede ADMIN via Prisma (exatamente como o operador faria uma unica vez).
#
# Pre-requisito: banco recem-resetado (roda-lo via .tools/run-all-tests.ps1)
# e servidor de dev no ar com ASAAS_WEBHOOK_TOKEN, INTERNAL_API_SECRET e
# PAYOUT_SANDBOX=1 no .env (sem ASAAS_API_KEY).
#
# Uso (a partir da raiz do projeto Freelaz, com o servidor de dev no ar):
#   powershell -ExecutionPolicy Bypass -File .tools\test-fase5.ps1 `
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
    Write-Host "ERRO: ASAAS_API_KEY preenchido no .env - a bateria espera SEM credencial." -ForegroundColor Red
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

$jarAdmin = Join-Path $env:TEMP "freelaz-f5-admin.txt"
$jarEmpresa = Join-Path $env:TEMP "freelaz-f5-empresa.txt"
$jarAna = Join-Path $env:TEMP "freelaz-f5-ana.txt"
$jarBruno = Join-Path $env:TEMP "freelaz-f5-bruno.txt"
$jarAnon = Join-Path $env:TEMP "freelaz-f5-anon.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-f5-body.json"
Remove-Item $jarAdmin, $jarEmpresa, $jarAna, $jarBruno, $jarAnon -Force -ErrorAction SilentlyContinue

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
    description = "Vaga de teste da Fase 5 com descricao suficientemente longa."
    category    = $Category
    valueCents  = $Value
    startsAt    = $Starts
    endsAt      = $Ends
  } | ConvertTo-Json -Compress
  Call-Api POST "/api/jobs" $body 201
  return (Get-Json).jobPosting.id
}

# ---- Helpers de banco (node direto) --------------------------------------
function Invoke-Db {
  param([string]$Script, [string[]]$DbArgs = @())
  $tmpFile = [System.IO.Path]::GetTempFileName() + ".js"
  Set-Content -LiteralPath $tmpFile -Value $Script -Encoding utf8
  & node $tmpFile @DbArgs | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "script de banco falhou" }
  Remove-Item $tmpFile -Force
}

function Invoke-Db-Json {
  param([string]$Script, [string[]]$DbArgs = @())
  $tmpFile = [System.IO.Path]::GetTempFileName() + ".js"
  Set-Content -LiteralPath $tmpFile -Value $Script -Encoding utf8
  $output = & node $tmpFile @DbArgs
  if ($LASTEXITCODE -ne 0) { throw "script de banco falhou" }
  Remove-Item $tmpFile -Force
  return ($output | Out-String | ConvertFrom-Json)
}

# Webhook do Asaas montado como o provedor de verdade enviaria: o segredo vai
# no CABEÇALHO oficial `asaas-access-token` (contrato docs.asaas.com) e o
# evento leva um `id` único (idempotência por event.id).
$script:webhookSeq = 0
function Send-Webhook {
  param([string]$HiringId, [double]$Value, [string]$Token, [string]$PaymentId, [int]$Expect)
  $script:webhookSeq++
  $body = @{
    id      = "evt_f5_${PaymentId}_$($script:webhookSeq)"
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

# Retroagir a hora de uso do codigo de fechamento (janela de avaliacao de 2h).
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
  $p = Join-Path $BackendDir "_window-f5.js"
  Set-Content -Path $p -Value $js -Encoding utf8
  & node $p
  if ($LASTEXITCODE -ne 0) { throw "retrocesso da janela de avaliacao falhou para $HiringId" }
  Remove-Item $p -Force
}

$png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
$secretHeader = @{ "x-internal-secret" = $internalSecret }

# ==========================================================================
Write-Host "`n== 0. Auto-checagem dos geradores de documento =="
Assert-True ((New-Cpf "123456789") -eq "123.456.789-09") "New-Cpf reproduz o CPF conhecido 123.456.789-09"
Assert-True ((New-Cnpj "123456780001") -eq "12.345.678/0001-95") "New-Cnpj reproduz o CNPJ conhecido 12.345.678/0001-95"

$cnpjEmpresa = New-Cnpj "555555550001"
$cpfAna = New-Cpf "678901234"
$cpfBruno = New-Cpf "789012345"
$cpfAnaDigits = $cpfAna -replace '\D', ''

Write-Host "`n== 0b. Cadastro das contas de teste =="
$script:jar = $jarEmpresa
Call-Api POST "/api/auth/register" (@{
  documentType = "CNPJ"; document = $cnpjEmpresa; name = "Empresa Cinco Freelaz Ltda"; tradeName = "Festa Cinco"
  email = "empresa5@exemplo.com"; phone = "(35) 92000-0007"; password = "senhaSegura123"
  roles = @("CONTRATANTE"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$empresaId = (Get-Json).user.id

$script:jar = $jarAna
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfAna; name = "Ana Cinco Souza"; birthDate = "1994-03-15"
  email = "ana5@exemplo.com"; phone = "(35) 92000-0008"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$anaId = (Get-Json).user.id

$script:jar = $jarBruno
Call-Api POST "/api/auth/register" (@{
  documentType = "CPF"; document = $cpfBruno; name = "Bruno Cinco Lima"; birthDate = "1991-07-22"
  email = "bruno5@exemplo.com"; phone = "(35) 92000-0009"; password = "senhaSegura123"
  roles = @("PROFISSIONAL"); acceptedTerms = $true
} | ConvertTo-Json -Compress) 201
$brunoId = (Get-Json).user.id

Assert-True ([bool]$empresaId -and [bool]$anaId -and [bool]$brunoId) "ids das contas capturados"

Write-Host "`n== 0c. Verificacoes de identidade submetidas (EM_ANALISE) =="
$script:jar = $jarAna
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201
$script:jar = $jarBruno
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201

Login "empresa5@exemplo.com" "senhaSegura123" $jarEmpresa
Call-Api PUT "/api/profile/contractor" '{"city":"Itajuba","state":"MG"}' 200
Login "ana5@exemplo.com" "senhaSegura123" $jarAna
Call-Api PUT "/api/profile/professional" '{"pixKey":"ana5@exemplo.com"}' 200
Login "bruno5@exemplo.com" "senhaSegura123" $jarBruno
Call-Api PUT "/api/profile/professional" '{"pixKey":"bruno5@exemplo.com"}' 200

Write-Host "`n== 0d. Bootstrap do ADMIN (fora da API, como o operador faria) =="
$grantAdmin = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const userId = process.argv[2];
  await prisma.userRoleAssignment.upsert({
    where: { userId_role: { userId, role: "ADMIN" } },
    update: { status: "ATIVO" },
    create: { userId, role: "ADMIN", status: "ATIVO" },
  });
  const roles = await prisma.userRoleAssignment.findMany({ where: { userId } });
  console.log(JSON.stringify(roles.map(r => r.role + ":" + r.status)));
  await prisma.$disconnect();
})();
'@
$adminRoles = Invoke-Db-Json -Script $grantAdmin -DbArgs @($empresaId)
Write-Host "        papeis de empresa5: $((@($adminRoles) -join ', '))"
Assert-True ((@($adminRoles) -join ",") -match "ADMIN:ATIVO") "empresa5 tem ADMIN:ATIVO (bootstrap via Prisma)"

Login "empresa5@exemplo.com" "senhaSegura123" $jarAdmin
Call-Api GET "/api/auth/me" "" 200
Assert-True ((@((Get-Json).roles | Where-Object { $_.role -eq "ADMIN" -and $_.status -eq "ATIVO" })).Count -eq 1) "sessao ADMIN visivel em /api/auth/me"

# ==========================================================================
Write-Host "`n== 1. Autorizacao rigorosa das rotas administrativas =="
$script:jar = $jarAnon
Call-Api GET "/api/admin/verifications" "" 403
Call-Api GET "/api/admin/hirings" "" 403
Call-Api GET "/api/admin/payouts" "" 403
Call-Api GET "/api/admin/ledger" "" 403
Call-Api GET "/api/admin/reconciliation" "" 403
Call-Api POST "/api/admin/payouts/run-batch" "" 403
Call-Api GET "/api/admin/verifications" "" 403 -Header @{ "x-internal-secret" = "segredo-errado" }

$script:jar = $jarAna
Call-Api GET "/api/admin/verifications" "" 403
$script:jar = $jarBruno
Call-Api GET "/api/admin/reconciliation" "" 403

$script:jar = $jarAdmin
Call-Api GET "/api/admin/verifications" "" 200
Call-Api GET "/api/admin/reconciliation" "" 200

$script:jar = $jarAnon
Call-Api GET "/api/admin/verifications" "" 200 -Header $secretHeader
Call-Api GET "/api/admin/hirings" "" 200 -Header $secretHeader

# Rotas admin antigas seguem respondendo ao segredo (compatibilidade).
$script:jar = $jarAnon
Call-Api GET "/api/admin/disputes" "" 403
Call-Api GET "/api/admin/disputes" "" 200 -Header $secretHeader
Call-Api GET "/api/admin/reports" "" 200 -Header $secretHeader

Write-Host "`n== 1b. ADMIN nao e autoatribuivel pela API =="
$script:jar = $jarAna
Call-Api POST "/api/auth/roles" '{"role":"ADMIN"}' 400

# ==========================================================================
Write-Host "`n== 2. Fila de identidade: documento mascarado, anexos visiveis =="
$script:jar = $jarAdmin
Call-Api GET "/api/admin/verifications?status=EM_ANALISE" "" 200
$queue = Get-Json
$anaVerif = @($queue.verifications | Where-Object { $_.user.id -eq $anaId })[0]
$brunoVerif = @($queue.verifications | Where-Object { $_.user.id -eq $brunoId })[0]
Assert-True ([bool]$anaVerif -and [bool]$brunoVerif) "ana e bruno aparecem na fila EM_ANALISE"
Assert-True ($anaVerif.user.documentMasked -match '\*') "documento vem MASCARADO na fila"
Assert-True (-not ($script:lastJson -match [regex]::Escape($cpfAnaDigits))) "CPF completo da ana NAO aparece na resposta"
Assert-True ([bool]$anaVerif.documentUrl -and [bool]$anaVerif.selfieUrl) "anexos (documento + selfie) presentes"
$anaVerifId = $anaVerif.id
$brunoVerifId = $brunoVerif.id
$anaDocUrl = $anaVerif.documentUrl

# ==========================================================================
Write-Host "`n== 3. Uploads: admin enxerga a prova, terceiro nao =="
# documentUrl ja vem como "/api/uploads/verifications/..." (saveDataUrlFile).
$anaDocPath = $anaDocUrl -replace '^/api/uploads/', ''
$script:jar = $jarAdmin
Call-Api GET "/api/uploads/$anaDocPath" "" 200
$script:jar = $jarAna
Call-Api GET "/api/uploads/$anaDocPath" "" 200
$script:jar = $jarBruno
Call-Api GET "/api/uploads/$anaDocPath" "" 403
$script:jar = $jarAnon
Call-Api GET "/api/uploads/$anaDocPath" "" 401

# ==========================================================================
Write-Host "`n== 4. Aprovacao de identidade (transacao auditada) =="
$script:jar = $jarAdmin
Call-Api POST "/api/admin/verifications/$anaVerifId/approve" "{}" 200
Assert-True ((Get-Json).decidedById -eq $empresaId) "resposta confirma o id auditado (sessao)"
$approveDb = Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const v = await prisma.identityVerification.findUnique({ where: { id: process.argv[2] } });
  const a = await prisma.userRoleAssignment.findUnique({ where: { userId_role: { userId: v.userId, role: v.role } } });
  const prof = await prisma.professionalProfile.findUnique({ where: { userId: v.userId } });
  console.log(JSON.stringify({
    status: v.status, decidedById: v.decidedById, analyzed: !!v.analyzedAt,
    roleStatus: a ? a.status : null, profStatus: prof ? prof.verificationStatus : null,
  }));
  await prisma.$disconnect();
})();
'@ @($anaVerifId)
Assert-True ($approveDb.status -eq "VERIFICADO") "IdentityVerification VERIFICADO"
Assert-True ($approveDb.decidedById -eq $empresaId) "decidedById gravado no banco (id da sessao)"
Assert-True ($approveDb.analyzed -eq $true) "analyzedAt preenchido"
Assert-True ($approveDb.roleStatus -eq "ATIVO") "UserRoleAssignment ATIVO"
Assert-True ($approveDb.profStatus -eq "VERIFICADO") "ProfessionalProfile VERIFICADO"

$script:jar = $jarAna
Call-Api GET "/api/auth/me" "" 200
Assert-True ((@((Get-Json).roles | Where-Object { $_.role -eq "PROFISSIONAL" -and $_.status -eq "ATIVO" })).Count -eq 1) "ana5 enxerga papel PROFISSIONAL ATIVO"

Write-Host "`n== 4b. Estados invalidos da aprovacao =="
$script:jar = $jarAdmin
Call-Api POST "/api/admin/verifications/$anaVerifId/approve" "{}" 409
Call-Api POST "/api/admin/verifications/$anaVerifId/reject" '{"reason":"qualquer"}' 409
Call-Api POST "/api/admin/verifications/inexistente-xyz/approve" "{}" 404

# ==========================================================================
Write-Host "`n== 5. Rejeicao com motivo + reenvio =="
$script:jar = $jarAdmin
Call-Api POST "/api/admin/verifications/$brunoVerifId/reject" '{"reason":""}' 400
Call-Api POST "/api/admin/verifications/$brunoVerifId/reject" '{"reason":"Selfie escura, reenvie com boa luz"}' 200
$rejectDb = Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const v = await prisma.identityVerification.findUnique({ where: { id: process.argv[2] } });
  const a = await prisma.userRoleAssignment.findUnique({ where: { userId_role: { userId: v.userId, role: v.role } } });
  const prof = await prisma.professionalProfile.findUnique({ where: { userId: v.userId } });
  console.log(JSON.stringify({
    status: v.status, reason: v.rejectionReason, decidedById: v.decidedById,
    roleStatus: a ? a.status : null, profStatus: prof ? prof.verificationStatus : null,
  }));
  await prisma.$disconnect();
})();
'@ @($brunoVerifId)
Assert-True ($rejectDb.status -eq "NAO_VERIFICADO") "verificacao do bruno NAO_VERIFICADO"
Assert-True ($rejectDb.reason -match "Selfie escura") "motivo da rejeicao guardado"
Assert-True ($rejectDb.decidedById -eq $empresaId) "decidedById da rejeicao tambem auditado"
Assert-True ($rejectDb.roleStatus -eq "PENDENTE") "papel do bruno continua PENDENTE (nao bloqueia)"
Assert-True ($rejectDb.profStatus -eq "NAO_VERIFICADO") "perfil do bruno volta a NAO_VERIFICADO"

$script:jar = $jarBruno
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201
$brunoVerif2 = (Get-Json).verification.id
Assert-True ([bool]$brunoVerif2 -and $brunoVerif2 -ne $brunoVerifId) "reenvio apos rejeicao cria nova verificacao"

$script:jar = $jarAdmin
Call-Api POST "/api/admin/verifications/$brunoVerif2/approve" "{}" 200

# ==========================================================================
Write-Host "`n== 6. Contratacao real ate CONCLUIDO (codigos de turno) =="
$t0 = [DateTime]::UtcNow
$starts1 = $t0.AddMinutes(60).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends1 = $t0.AddMinutes(62).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")

$script:jar = $jarEmpresa
$job1 = New-Job "Bartender Fase 5" "bartender" 20000 $starts1 $ends1
Assert-True ([bool]$job1) "vaga 1 publicada (job1)"

$script:jar = $jarAna
Call-Api POST "/api/jobs/$job1/apply" "" 201
$app1 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job1/select" (@{ applicationId = $app1 } | ConvertTo-Json -Compress) 200
$hiring1 = (Get-Json).application.hiring.id
Assert-True ([bool]$hiring1) "Hiring 1 criado na selecao"

Send-Webhook $hiring1 200 $webhookToken "pay-f5-h1" 200
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiring1" "" 200
Assert-True ((Get-Json).hiring.status -eq "RETIDO") "Hiring 1 RETIDO apos webhook"

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
Assert-True ((Get-Json).openingCodesGenerated -ge 1) "codigo de abertura gerado"

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

$script:jar = $jarAnon
Call-Api POST "/api/cron/shift-codes" "" 200 -Header $secretHeader
Assert-True ((Get-Json).closingCodesGenerated -ge 1) "codigo de fechamento gerado"

$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hiring1" "" 200
$closingCode = (Get-Json).hiring.closingCode
Call-Api POST "/api/hirings/$hiring1/codes" (@{ kind = "CLOSING"; code = $closingCode } | ConvertTo-Json -Compress) 200
$closed = (Get-Json).hiring
Assert-True ($closed.status -eq "CONCLUIDO" -and [bool]$closed.closingCodeUsedAt) "fechamento confirmado -> CONCLUIDO"

# ==========================================================================
Write-Host "`n== 7. Consultas do painel (contratacoes/repasses/ledger) =="
$script:jar = $jarAdmin
Call-Api GET "/api/admin/hirings?take=100" "" 200
$hRow = @((Get-Json).hirings | Where-Object { $_.id -eq $hiring1 })[0]
Assert-True ([bool]$hRow) "Hiring 1 aparece na consulta de contratacoes"
Assert-True ($hRow.status -eq "CONCLUIDO") "status CONCLUIDO na consulta"
Assert-True ($hRow.contractor.documentMasked -match '\*' -and $hRow.professional.documentMasked -match '\*') "partes com documento mascarado"
Assert-True (-not ($script:lastJson -match [regex]::Escape($cpfAnaDigits))) "consulta nao vaza o CPF completo"
Assert-True (@($hRow.ledgerEntries | Where-Object { $_.type -eq "RETENCAO" }).Count -ge 1) "ledger da contratacao mostra RETENCAO"

Call-Api GET "/api/admin/ledger?hiringId=$hiring1" "" 200
Assert-True (@((Get-Json).entries | Where-Object { $_.type -eq "RETENCAO" }).Count -ge 1) "consulta de ledger filtra por contratacao"
Call-Api GET "/api/admin/payouts" "" 200

# ==========================================================================
Write-Host "`n== 8. Reconciliacao no painel =="
Set-ClosingCodeUsedAt $hiring1
$script:jar = $jarAdmin
Call-Api GET "/api/admin/reconciliation" "" 200
$recon = Get-Json
Assert-True ($recon.report.ok -eq $true) "reconciliacao OK (sem divergencias)"
Assert-True (@($recon.report.discrepancies).Count -eq 0) "nenhuma divergencia listada"
Assert-True (@($recon.report.checks).Count -ge 5) "invariantes checadas presentes"
Assert-True ($recon.report.totals.retainedCents -ge 20000) "saldo retido contabilizado"
Assert-True ($recon.report.external.skipped -eq $true) "comparacao com extrato externo marcada como pulada"

# ==========================================================================
Write-Host "`n== 9. Lote de repasses disparado pelo painel =="
$script:jar = $jarAnon
Call-Api POST "/api/admin/payouts/run-batch" "" 403
$script:jar = $jarAna
Call-Api POST "/api/admin/payouts/run-batch" "" 403

$script:jar = $jarAdmin
Call-Api POST "/api/admin/payouts/run-batch" "" 200
$batch = Get-Json
Assert-True ($batch.result.eligible -ge 1) "lote com ao menos 1 elegivel"
Assert-True ((@($batch.result.released | Where-Object { $_ -eq $hiring1 })).Count -eq 1) "Hiring 1 repassado pelo lote do painel"
Assert-True ((@($batch.result.failed | Where-Object { $_.hiringId -eq $hiring1 })).Count -eq 0) "Hiring 1 sem falha no lote"

$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiring1" "" 200
$h1After = (Get-Json).hiring
Assert-True ($h1After.status -eq "LIBERADO") "Hiring 1 LIBERADO apos o lote"
Assert-True ($h1After.payout.status -eq "CONCLUIDO" -and $h1After.payout.amountCents -eq 18000) "payout CONCLUIDO de 18000 (liquido, sem taxa)"

$script:jar = $jarAdmin
Call-Api GET "/api/admin/ledger?hiringId=$hiring1" "" 200
Assert-True (@((Get-Json).entries | Where-Object { $_.type -eq "LIBERACAO" -and $_.amountCents -eq 18000 }).Count -eq 1) "ledger tem LIBERACAO de 18000"

Call-Api POST "/api/admin/payouts/run-batch" "" 200
$batch2 = Get-Json
Assert-True ((@($batch2.result.released | Where-Object { $_ -eq $hiring1 })).Count -eq 0) "segundo lote nao repassa de novo (idempotente)"

# ==========================================================================
Write-Host "`n== 10. Disputa: fila enriquecida + decisao auditada pela sessao =="
$starts2 = $t0.AddMinutes(61).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$ends2 = $t0.AddMinutes(63).ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$script:jar = $jarEmpresa
$job2 = New-Job "Garcom Fase 5" "garcom" 20000 $starts2 $ends2
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$job2/apply" "" 201
$app2 = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$job2/select" (@{ applicationId = $app2 } | ConvertTo-Json -Compress) 200
$hiring2 = (Get-Json).application.hiring.id
Send-Webhook $hiring2 200 $webhookToken "pay-f5-h2" 200

$script:jar = $jarBruno
Call-Api POST "/api/hirings/$hiring2/dispute" '{"reason":"Nao recebi o material combinado"}' 201
$dispute2 = (Get-Json).dispute.id
Assert-True ([bool]$dispute2) "disputa aberta pelo profissional"

$script:jar = $jarAdmin
Call-Api GET "/api/admin/disputes?status=EM_ANALISE" "" 200
$dRow = @((Get-Json).disputes | Where-Object { $_.id -eq $dispute2 })[0]
Assert-True ([bool]$dRow) "disputa aparece na fila administrativa"
Assert-True ($dRow.openedBySide -eq "PROFESSIONAL") "lado que abriu registrado"
Assert-True ([bool]$dRow.hiring.contractor.name -and [bool]$dRow.hiring.professional.name) "partes presentes para analise"
Assert-True ($dRow.hiring.contractor.documentMasked -match '\*') "parte com documento mascarado na disputa"

Call-Api POST "/api/admin/disputes/$dispute2/resolve" '{"resolution":"DEVOLUCAO_TOTAL","decisionNote":"Sem servico prestado, devolucao integral"}' 200
Assert-True ((Get-Json).dispute.status -eq "RESOLVIDA") "disputa resolvida"
$disputeDb = Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const d = await prisma.dispute.findUnique({ where: { id: process.argv[2] } });
  const h = await prisma.hiring.findUnique({ where: { id: d.hiringId } });
  const entries = await prisma.ledgerEntry.findMany({ where: { hiringId: d.hiringId } });
  console.log(JSON.stringify({
    decidedById: d.decidedById, resolution: d.resolution, hiringStatus: h.status,
    reembolso: entries.filter(e => e.type === "REEMBOLSO").map(e => e.amountCents),
  }));
  await prisma.$disconnect();
})();
'@ @($dispute2)
Assert-True ($disputeDb.decidedById -eq $empresaId) "decidedById = id da SESSAO (auditoria real)"
Assert-True ($disputeDb.resolution -eq "DEVOLUCAO_TOTAL") "resolucao registrada"
Assert-True ($disputeDb.hiringStatus -eq "CANCELADO") "contratacao CANCELADA apos devolucao"
Assert-True (@($disputeDb.reembolso).Count -eq 1 -and $disputeDb.reembolso[0] -eq 20000) "ledger tem REEMBOLSO de 20000"

# ==========================================================================
Write-Host "`n== 11. Denuncia: fila enriquecida + decisao pela sessao =="
$ledgerBefore = (Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => { console.log(JSON.stringify({ n: await prisma.ledgerEntry.count() })); await prisma.$disconnect(); })();
'@ @()).n

$script:jar = $jarAna
Call-Api POST "/api/reports" (@{ reportedId = $brunoId; category = "ABUSO"; description = "Ofensas no chat durante o servico" } | ConvertTo-Json -Compress) 201
$report1 = (Get-Json).report.id

$script:jar = $jarAdmin
Call-Api GET "/api/admin/reports?status=ABERTA" "" 200
$rRow = @((Get-Json).reports | Where-Object { $_.id -eq $report1 })[0]
Assert-True ([bool]$rRow) "denuncia aparece na fila administrativa"
Assert-True ($rRow.priority -eq "ALTA") "ABUSO entra como prioridade ALTA"
Assert-True ($rRow.reporter.name -and $rRow.reported.name) "denunciante e denunciado com nome"

Call-Api POST "/api/admin/reports/$report1/resolve" '{"outcome":"ACAO_TOMADA","decisionNote":"Notificacao aplicada ao denunciado"}' 200
$reportDb = Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.report.findUnique({ where: { id: process.argv[2] } });
  console.log(JSON.stringify({ decidedById: r.decidedById, status: r.status, ledger: await prisma.ledgerEntry.count() }));
  await prisma.$disconnect();
})();
'@ @($report1)
Assert-True ($reportDb.decidedById -eq $empresaId) "denuncia decidida com id da SESSAO"
Assert-True ($reportDb.status -eq "ACAO_TOMADA") "desfecho registrado"
Assert-True ($reportDb.ledger -eq $ledgerBefore) "denuncia NAO movimentou o ledger (nao move dinheiro)"

# ==========================================================================
Write-Host "`n== 12. Caminho do segredo: adminId do corpo continua auditado =="
$script:jar = $jarBruno
Call-Api POST "/api/reports" (@{ reportedId = $anaId; category = "OUTRO"; description = "Denuncia de teste do caminho por segredo" } | ConvertTo-Json -Compress) 201
$report2 = (Get-Json).report.id

$script:jar = $jarAnon
Call-Api POST "/api/admin/reports/$report2/resolve" '{"adminId":"admin-segredo-f5","outcome":"ARQUIVADA","decisionNote":"Sem elementos"}' 200 -Header $secretHeader
$report2Db = Invoke-Db-Json @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const r = await prisma.report.findUnique({ where: { id: process.argv[2] } });
  console.log(JSON.stringify({ decidedById: r.decidedById }));
  await prisma.$disconnect();
})();
'@ @($report2)
Assert-True ($report2Db.decidedById -eq "admin-segredo-f5") "segredo: adminId do corpo auditado (compatibilidade)"

# ==========================================================================
Write-Host "`n== 13. Pagina do painel =="
$html = (& curl.exe -s "$base/admin") -join "`n"
Assert-True ($html -match "Carregando") "pagina /admin serve o painel (SSR inicial)"

# ==========================================================================
Write-Host "`n========================================================="
Write-Host "Fase 5: $($script:pass) OK, $($script:fail) FALHA(S)"
if ($script:fail -gt 0) { exit 1 }
exit 0
