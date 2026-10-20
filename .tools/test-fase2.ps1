# Teste ponta a ponta da Fase 2 (loop do marketplace):
#   publicacao de vaga -> busca/filtros -> edicao/cancelamento -> candidaturas
#   -> selecao (que cria o Hiring) -> pagamento confirmado libera o chat ->
#   contraproposta -> suplentes com conflito de agenda -> encerramento do chat.
#
# Por que este arquivo existe: o webhook do Mercado Pago nao da para simular
# sem sandbox (exige assinatura HMAC + credencial real). Entao, para testar a
# mudanca de status da contratacao e a sincronizacao do chat, compilamos o
# servico REAL (hiringService.setHiringStatus) com tsc para CommonJS e o
# executamos aqui via .tools/fase2-service-sim.js — nada e forjado no banco a mao.
#
# E autossuficiente: cadastra as proprias contas (empresa/ana/bruno) e aprova as
# verificacoes via Prisma, exatamente como o admin fara no Prisma Studio ate a
# Fase 5. Nao depende do log do dev server.
#
# Pre-requisito: banco recem-resetado (as contas de teste nao podem existir
# ainda) — por isso o normal e roda-lo via .tools/run-all-tests.ps1, que reseta
# o banco antes.
#
# Uso (a partir da raiz do projeto Freelaz, com o servidor de dev no ar):
#   powershell -ExecutionPolicy Bypass -File .tools\test-fase2.ps1 `
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
# O sim roda o servico real contra o banco: precisa da URL e de achar o
# @prisma/client do projeto (a pasta de build temporaria nao tem node_modules).
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/freelaz"
$env:NODE_PATH = Join-Path $BackendDir "node_modules"

$jarEmpresa = Join-Path $env:TEMP "freelaz-f2-empresa.txt"
$jarAna = Join-Path $env:TEMP "freelaz-f2-ana.txt"
$jarBruno = Join-Path $env:TEMP "freelaz-f2-bruno.txt"
$jarAnon = Join-Path $env:TEMP "freelaz-f2-anon.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-f2-body.json"
Remove-Item $jarEmpresa, $jarAna, $jarBruno, $jarAnon -Force -ErrorAction SilentlyContinue

$script:pass = 0
$script:fail = 0
$script:lastJson = ""
$script:jar = $jarAnon

function Call-Api {
  param([string]$Method, [string]$Path, [string]$Body = "", [int]$Expect)
  if ($Body) { Set-Content -Path $bodyFile -Value $Body -Encoding utf8 -NoNewline }
  $curlArgs = @("-s", "-X", $Method, "$base$Path", "-H", "Content-Type: application/json",
                "-b", $script:jar, "-c", $script:jar, "-w", "`n%{http_code}")
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

# Publica uma vaga como o usuario do jar atual e devolve o id.
function New-Job {
  param([string]$Title, [string]$Category, [int]$Value, [string]$Starts, [string]$Ends)
  $body = @{
    title       = $Title
    description = "Vaga de teste da Fase 2 com descricao suficientemente longa."
    category    = $Category
    valueCents  = $Value
    startsAt    = $Starts
    endsAt      = $Ends
  } | ConvertTo-Json -Compress
  Call-Api POST "/api/jobs" $body 201
  return (Get-Json).jobPosting.id
}

# Compila os servicos reais para CommonJS (o projeto usa esnext + noEmit).
$build = Join-Path $env:TEMP "freelaz-f2-build"
$compiledService = Join-Path $build "services\hiringService.js"
$compiledLedger = Join-Path $build "services\ledgerService.js"

function Build-Services {
  Write-Host "`n== Compilando os servicos reais (tsc -> CommonJS) para o sim =="
  Remove-Item $build -Recurse -Force -ErrorAction SilentlyContinue
  Push-Location $BackendDir
  try {
    # ledgerService tambem: o sim do RETIDO espelha o webhook do Asaas, que
    # grava a RETENCAO no ledger na mesma transacao do status.
    $out = & npx tsc --module commonjs --target es2019 --esModuleInterop `
      --skipLibCheck --moduleResolution node --outDir "$build" --rootDir "$BackendDir\src" `
      --noEmit false "$BackendDir\src\services\hiringService.ts" `
      "$BackendDir\src\services\ledgerService.ts" 2>&1
  } finally {
    Pop-Location
  }
  if ((Test-Path $compiledService) -and (Test-Path $compiledLedger)) {
    Write-Host "  OK    servicos compilados em $build"
    $script:pass++
  } else {
    Write-Host "  FALHA compilacao dos servicos" -ForegroundColor Red
    Write-Host ($out -join "`n")
    $script:fail++
  }
}

# Executa a transicao de status REAL via servico compilado.
function Invoke-Sim {
  param([string]$HiringId, [string]$Status)
  $out = & node (Join-Path $tools "fase2-service-sim.js") $BackendDir $compiledService $HiringId $Status
  $line = ($out | Select-Object -Last 1)
  $json = $null
  try { $json = $line | ConvertFrom-Json } catch { }
  if ($json -and $json.ok -eq $true) {
    Write-Host "  OK    sim $Status -> status=$($json.status) chat=$($json.chatStatus)"
    $script:pass++
  } else {
    Write-Host "  FALHA sim $Status ($HiringId)" -ForegroundColor Red
    Write-Host "        $line"
    $script:fail++
  }
  return $json
}

Build-Services

# ==========================================================================
Write-Host "`n== 0. Cadastro das contas de teste =="
$png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="

$script:jar = $jarEmpresa
Call-Api POST "/api/auth/register" '{"documentType":"CNPJ","document":"12.345.678/0001-95","name":"Empresa Teste Freelaz Ltda","tradeName":"Festa Teste","email":"empresa@exemplo.com","phone":"(35) 91000-0001","password":"senhaSegura123","roles":["CONTRATANTE"],"acceptedTerms":true}' 201
$empresaId = (Get-Json).user.id

$script:jar = $jarAna
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"123.456.789-09","name":"Ana Souza","birthDate":"1994-03-15","email":"ana@exemplo.com","phone":"(35) 91000-0002","password":"senhaSegura123","roles":["PROFISSIONAL"],"acceptedTerms":true}' 201
$anaId = (Get-Json).user.id

$script:jar = $jarBruno
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"111.444.777-35","name":"Bruno Lima","birthDate":"1991-07-22","email":"bruno@exemplo.com","phone":"(35) 91000-0003","password":"senhaSegura123","roles":["PROFISSIONAL"],"acceptedTerms":true}' 201
$brunoId = (Get-Json).user.id

Assert-True ([bool]$empresaId -and [bool]$anaId -and [bool]$brunoId) "ids das contas capturados"

# Envio da verificacao profissional (documento + selfie) para os dois.
$script:jar = $jarAna
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201
$script:jar = $jarBruno
Call-Api POST "/api/verification/professional" (@{ documentUrl = $png; selfieUrl = $png } | ConvertTo-Json -Compress) 201

Write-Host "`n== 0b. Aprovando as verificacoes (como o admin no Prisma Studio) =="
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
$approvePath = Join-Path $BackendDir "_approve-f2.js"
Set-Content -Path $approvePath -Value $approve -Encoding utf8
$approveOut = & node $approvePath $anaId $brunoId
Remove-Item $approvePath -Force
Write-Host "        papeis: $approveOut"
Assert-True ($approveOut -match "PROFISSIONAL:ATIVO") "papeis Profissional ATIVO"

# Cidade/estado da empresa: base do filtro de localizacao do marketplace.
Login "empresa@exemplo.com" "senhaSegura123" $jarEmpresa
Call-Api PUT "/api/profile/contractor" '{"city":"Itajuba","state":"MG"}' 200

# ==========================================================================
Write-Host "`n== 1. Publicacao de vaga (autorizacao e validacao) =="
$script:jar = $jarAnon
Call-Api POST "/api/jobs" (@{ title = "Vaga anonima"; description = "Descricao longa o suficiente para passar"; category = "x"; valueCents = 1000; startsAt = "2026-12-01T18:00:00Z"; endsAt = "2026-12-01T23:00:00Z" } | ConvertTo-Json -Compress) 401

$script:jar = $jarAna
Call-Api POST "/api/jobs" (@{ title = "Vaga da Ana"; description = "Descricao longa o suficiente para passar"; category = "x"; valueCents = 1000; startsAt = "2026-12-01T18:00:00Z"; endsAt = "2026-12-01T23:00:00Z" } | ConvertTo-Json -Compress) 403

$script:jar = $jarEmpresa
Call-Api POST "/api/jobs" '{"title":"Curta","description":"curta","category":"x"}' 422

$jobA = New-Job "Bartender para casamento" "bartender" 20000 "2026-12-01T18:00:00Z" "2026-12-01T23:00:00Z"
$jobX = New-Job "DJ para formatura" "dj" 20000 "2026-12-05T18:00:00Z" "2026-12-05T23:00:00Z"
$jobB = New-Job "Garcom para jantar" "garcom" 15000 "2026-12-15T18:00:00Z" "2026-12-15T23:00:00Z"
$jobOB = New-Job "Recepcionista para evento" "recepcionista" 12000 "2026-12-15T19:00:00Z" "2026-12-15T22:00:00Z"
$jobC = New-Job "Seguranca para festa" "seguranca" 18000 "2026-12-18T18:00:00Z" "2026-12-18T23:00:00Z"
$jobD = New-Job "Fotografo para ensaio" "fotografo" 30000 "2026-12-20T18:00:00Z" "2026-12-20T23:00:00Z"
Assert-True ([bool]$jobA -and [bool]$jobX -and [bool]$jobB -and [bool]$jobOB -and [bool]$jobC -and [bool]$jobD) "6 vagas publicadas"

# ==========================================================================
Write-Host "`n== 2. Marketplace: lista, busca e filtros =="
$script:jar = $jarAnon
Call-Api GET "/api/jobs" "" 200
$list = Get-Json
Assert-True ($list.total -ge 6) "lista publica tem >= 6 vagas (total=$($list.total))"
Assert-True ((@($list.items | Where-Object { $_.id -eq $jobA })).Count -eq 1) "vaga A aparece na lista"

Call-Api GET "/api/jobs?q=bartender" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobA })).Count -eq 1) "busca q=bartender acha A"

Call-Api GET "/api/jobs?category=garcom" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobB })).Count -eq 1) "filtro category=garcom acha B"

Call-Api GET "/api/jobs?city=Itajuba&state=MG" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobA })).Count -eq 1) "filtro city/state acha A"

Call-Api GET "/api/jobs?city=Curitiba" "" 200
Assert-True ((Get-Json).total -eq 0) "filtro city=Curitiba nao acha nada"

Call-Api GET "/api/jobs?minValueCents=25000" "" 200
$hi = Get-Json
Assert-True ((@($hi.items | Where-Object { $_.id -eq $jobD })).Count -eq 1 -and (@($hi.items | Where-Object { $_.id -eq $jobA })).Count -eq 0) "minValueCents=25000 inclui D e exclui A"

Call-Api GET "/api/jobs?date=2026-12-01" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobA })).Count -eq 1) "filtro date=2026-12-01 acha A"

Call-Api GET "/api/jobs/$jobA" "" 200
Assert-True ((Get-Json).jobPosting.id -eq $jobA) "detalhe publico da vaga A"

# ==========================================================================
Write-Host "`n== 3. Edicao e cancelamento de vaga =="
$script:jar = $jarAna
Call-Api PATCH "/api/jobs/$jobD" '{"valueCents":32000}' 403
$script:jar = $jarEmpresa
Call-Api PATCH "/api/jobs/$jobD" '{"valueCents":32000}' 200
Assert-True ((Get-Json).jobPosting.valueCents -eq 32000) "valor da vaga D atualizado"
Call-Api PATCH "/api/jobs/$jobD" '{"startsAt":"2026-12-20T18:00:00Z","endsAt":"2026-12-20T17:00:00Z"}' 422
Call-Api DELETE "/api/jobs/$jobD" "" 200
Assert-True ((Get-Json).jobPosting.status -eq "CANCELADA") "vaga D cancelada"
$script:jar = $jarAnon
Call-Api GET "/api/jobs" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobD })).Count -eq 0) "vaga D sumiu da lista"

# ==========================================================================
Write-Host "`n== 4. Candidaturas =="
$script:jar = $jarAnon
Call-Api POST "/api/jobs/$jobA/apply" "" 401
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$jobA/apply" "" 403
$script:jar = $jarAna
Call-Api POST "/api/jobs/$jobA/apply" "" 201
$anaAppA = (Get-Json).application.id
Call-Api POST "/api/jobs/$jobA/apply" "" 409
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$jobA/apply" "" 201
$brunoAppA = (Get-Json).application.id
$script:jar = $jarAna
Call-Api GET "/api/jobs/$jobA/applications" "" 403
$script:jar = $jarEmpresa
Call-Api GET "/api/jobs/$jobA/applications" "" 200
Assert-True ((Get-Json).applications.Count -eq 2) "empresa ve 2 candidaturas"
$script:jar = $jarAna
Call-Api GET "/api/applications" "" 200
Assert-True ((@((Get-Json).applications | Where-Object { $_.jobPosting.id -eq $jobA })).Count -eq 1) "Ana ve a propria candidatura"

# ==========================================================================
Write-Host "`n== 5. Selecao -> contratacao (Hiring) =="
$script:jar = $jarAna
Call-Api POST "/api/jobs/$jobA/select" (@{ applicationId = $anaAppA } | ConvertTo-Json -Compress) 403
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$jobA/select" (@{ applicationId = $anaAppA } | ConvertTo-Json -Compress) 200
$hiringA = (Get-Json).application.hiring.id
Assert-True ([bool]$hiringA) "Hiring criado na selecao (vaga A)"

Call-Api GET "/api/jobs/$jobA/applications" "" 200
$appsA = (Get-Json).applications
Assert-True ((@($appsA | Where-Object { $_.id -eq $anaAppA })[0].status) -eq "SELECIONADO") "Ana SELECIONADO"
Assert-True ((@($appsA | Where-Object { $_.id -eq $brunoAppA })[0].status) -eq "SUPLENTE") "Bruno SUPLENTE"

Call-Api GET "/api/hirings" "" 200
$hA = @((Get-Json).hirings | Where-Object { $_.id -eq $hiringA })[0]
Assert-True ($hA.side -eq "CONTRACTOR" -and $hA.grossValueCents -eq 20000) "empresa ve a contratacao (CONTRACTOR, bruto 20000)"

$script:jar = $jarAna
Call-Api GET "/api/hirings" "" 200
$hAana = @((Get-Json).hirings | Where-Object { $_.id -eq $hiringA })[0]
Assert-True ($hAana.side -eq "PROFESSIONAL") "Ana ve a contratacao (PROFESSIONAL)"

Call-Api GET "/api/hirings/$hiringA" "" 200
$det = (Get-Json).hiring
Assert-True ($det.grossValueCents -eq 20000 -and $det.netValueCents -eq 18000 -and $det.commissionCents -eq 2000 -and $det.commissionBps -eq 1000) "valores: bruto 20000 / liquido 18000 / comissao 2000"
Assert-True ($det.chat.status -eq "AGUARDANDO_PAGAMENTO") "chat bloqueado antes do pagamento"

$script:jar = $jarBruno
Call-Api GET "/api/hirings/$hiringA" "" 403
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hiringA/chat" "" 200
Assert-True ((Get-Json).messages.Count -eq 0) "historico do chat vazio antes do pagamento"
Call-Api POST "/api/hirings/$hiringA/chat/messages" '{"body":"Ola antes do pagamento"}' 409
Call-Api POST "/api/payments/create" (@{ hiringId = $hiringA } | ConvertTo-Json -Compress) 503
Call-Api PATCH "/api/jobs/$jobA" '{"valueCents":21000}' 409

# ==========================================================================
Write-Host "`n== 6. Pagamento confirmado (sim do servico real) -> chat abre =="
Invoke-Sim $hiringA "RETIDO" | Out-Null
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiringA" "" 200
$det = (Get-Json).hiring
Assert-True ($det.status -eq "RETIDO") "Hiring em RETIDO"
Assert-True ($det.chat.status -eq "ABERTO" -and [bool]$det.chat.openedAt) "chat ABERTO apos pagamento"

$script:jar = $jarEmpresa
Call-Api POST "/api/hirings/$hiringA/chat/messages" '{"body":"Bom dia, combinamos as 18h."}' 201
$script:jar = $jarAna
Call-Api POST "/api/hirings/$hiringA/chat/messages" '{"body":"Combinado, ate la!"}' 201
Call-Api GET "/api/hirings/$hiringA/chat" "" 200
$chat = Get-Json
Assert-True ($chat.messages.Count -eq 2) "2 mensagens no historico"
Assert-True ($chat.messages[0].mine -eq $false -and $chat.messages[1].mine -eq $true) "flag mine correta para a Ana"

$script:jar = $jarAnon
Call-Api GET "/api/jobs" "" 200
Assert-True ((@((Get-Json).items | Where-Object { $_.id -eq $jobA })).Count -eq 0) "vaga A sumiu do marketplace (PREENCHIDA)"

# ==========================================================================
Write-Host "`n== 7. Contraproposta e encerramento do chat =="
$script:jar = $jarAna
Call-Api POST "/api/jobs/$jobX/apply" "" 201
$anaAppX = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/applications/$anaAppX/counter-offer" '{"valueCents":25000}' 200
$co = Get-Json
Assert-True ($co.application.status -eq "CONTRAPROPOSTA" -and $co.application.counterOfferBy -eq "CONTRACTOR") "empresa enviou contraproposta de 25000"
$script:jar = $jarAna
Call-Api POST "/api/applications/$anaAppX/respond" '{"decision":"ACCEPT"}' 200
$hiringX = (Get-Json).application.hiring.id
Assert-True ((Get-Json).agreedValueCents -eq 25000) "valor acordado 25000"
$script:jar = $jarEmpresa
Call-Api GET "/api/hirings/$hiringX" "" 200
$dx = (Get-Json).hiring
Assert-True ($dx.grossValueCents -eq 25000 -and $dx.netValueCents -eq 22500 -and $dx.commissionCents -eq 2500) "Hiring X: bruto 25000 / liquido 22500 / comissao 2500"

Invoke-Sim $hiringX "RETIDO" | Out-Null
Invoke-Sim $hiringX "CANCELADO" | Out-Null
$script:jar = $jarAna
Call-Api GET "/api/hirings/$hiringX/chat" "" 200
$cx = Get-Json
Assert-True ($cx.chat.status -eq "ENCERRADO" -and [bool]$cx.chat.closedAt) "chat encerrado ao cancelar a contratacao"
Call-Api POST "/api/hirings/$hiringX/chat/messages" '{"body":"mensagem tardia"}' 409

# ==========================================================================
Write-Host "`n== 8. Suplentes e conflito de agenda =="
$script:jar = $jarAna
Call-Api POST "/api/jobs/$jobB/apply" "" 201
$anaAppB = (Get-Json).application.id
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$jobB/apply" "" 201
$brunoAppB = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$jobB/select" (@{ applicationId = $anaAppB } | ConvertTo-Json -Compress) 200
Call-Api GET "/api/jobs/$jobB/resume" "" 200
$subsB1 = (Get-Json).substitutes
Assert-True ((@($subsB1 | Where-Object { $_.professionalId -eq $brunoId })).Count -eq 1) "Bruno suplente incluido (ainda sem conflito)"

# Bruno ganha uma contratacao confirmada que sobrepoe a vaga B (ambas em 15/12).
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$jobOB/apply" "" 201
$brunoAppOB = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$jobOB/select" (@{ applicationId = $brunoAppOB } | ConvertTo-Json -Compress) 200
$hiringOB = (Get-Json).application.hiring.id
Invoke-Sim $hiringOB "RETIDO" | Out-Null

Call-Api GET "/api/jobs/$jobB/resume" "" 200
$subsB2 = (Get-Json).substitutes
Assert-True ((@($subsB2 | Where-Object { $_.professionalId -eq $brunoId })).Count -eq 0) "Bruno excluido dos suplentes de B (conflito em 15/12)"

# Vaga C (18/12) nao conflita com a contratacao de Bruno: ele deve aparecer.
$script:jar = $jarAna
Call-Api POST "/api/jobs/$jobC/apply" "" 201
$anaAppC = (Get-Json).application.id
$script:jar = $jarBruno
Call-Api POST "/api/jobs/$jobC/apply" "" 201
$brunoAppC = (Get-Json).application.id
$script:jar = $jarEmpresa
Call-Api POST "/api/jobs/$jobC/select" (@{ applicationId = $anaAppC } | ConvertTo-Json -Compress) 200
Call-Api GET "/api/jobs/$jobC/resume" "" 200
$subsC = (Get-Json).substitutes
Assert-True ((@($subsC | Where-Object { $_.professionalId -eq $brunoId })).Count -eq 1) "Bruno incluido nos suplentes de C (sem conflito)"

Write-Host ""
Write-Host "== RESULTADO: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
