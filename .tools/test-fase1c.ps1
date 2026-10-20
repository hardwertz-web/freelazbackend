# Parte 3 da Fase 1: aprovacao manual da verificacao, papeis ATIVOS, convite
# direto ("Me contrate"), contraproposta, retomada de vaga e o retrofit de
# autenticacao nas rotas que ja existiam.
param(
  [Parameter(Mandatory = $true)][string]$BackendDir
)

$base = "http://localhost:3000"
$jarMaria = Join-Path $env:TEMP "freelaz-maria.txt"
$jarJoao = Join-Path $env:TEMP "freelaz-joao.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-body3.json"
Remove-Item $jarMaria, $jarJoao -Force -ErrorAction SilentlyContinue

$script:pass = 0
$script:fail = 0
$script:lastJson = ""
$script:jar = $jarMaria

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

Write-Host "== A. Cadastro CNPJ valido (contratante) =="
Call-Api POST "/api/auth/register" '{"documentType":"CNPJ","document":"11.222.333/0001-81","name":"Buffet Festa Boa Ltda","tradeName":"Festa Boa","email":"buffet@exemplo.com","phone":"(35) 94444-0000","password":"senhaSegura123","roles":["CONTRATANTE"],"acceptedTerms":true}' 201

Write-Host "== B. Cadastro de um segundo profissional (Joao) =="
$script:jar = $jarJoao
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"390.533.447-05","name":"Joao Pereira","birthDate":"1992-08-20","email":"joao@exemplo.com","phone":"(35) 93333-0000","password":"senhaSegura123","roles":["PROFISSIONAL"],"acceptedTerms":true}' 201
$joaoId = ($script:lastJson | ConvertFrom-Json).user.id

Write-Host "== C. Aprovar as verificacoes manualmente (como o admin fara no Prisma Studio) =="
$approveCode = @'
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  await prisma.userRoleAssignment.updateMany({ where: { role: "PROFISSIONAL" }, data: { status: "ATIVO" } });
  await prisma.professionalProfile.updateMany({ data: { verificationStatus: "VERIFICADO" } });
  await prisma.identityVerification.updateMany({ where: { role: "PROFISSIONAL" }, data: { status: "VERIFICADO", analyzedAt: new Date() } });
  const roles = await prisma.userRoleAssignment.findMany();
  console.log(JSON.stringify(roles.map(r => r.role + ":" + r.status)));
  await prisma.$disconnect();
})();
'@
Set-Content -Path "$BackendDir\approve.js" -Value $approveCode -Encoding utf8
$out = & node "$BackendDir\approve.js"
Write-Host "        papeis agora: $out"
Remove-Item "$BackendDir\approve.js" -Force

Write-Host "== D. Maria (profissional aprovada) ve o papel ATIVO =="
$script:jar = $jarMaria
Call-Api POST "/api/auth/login" '{"email":"maria@exemplo.com","password":"novaSenha456"}' 200
Call-Api GET "/api/auth/me" "" 200
$me = $script:lastJson | ConvertFrom-Json
$profStatus = ($me.roles | Where-Object { $_.role -eq "PROFISSIONAL" }).status
Write-Host "        papel Profissional: $profStatus / verificacao: $($me.professionalProfile.verificationStatus)"

Write-Host "== E. Rota antiga sem sessao deve dar 401 (retrofit) =="
$script:jar = Join-Path $env:TEMP "freelaz-anon.txt"
Remove-Item $script:jar -Force -ErrorAction SilentlyContinue
Call-Api POST "/api/jobs/invite" '{"targetProfessionalId":"x","valueCents":1000,"startsAt":"2026-11-01T18:00:00Z","endsAt":"2026-11-01T23:00:00Z"}' 401

Write-Host "== F. Maria convida Joao (Me contrate) =="
$script:jar = $jarMaria
Call-Api POST "/api/jobs/invite" "{`"targetProfessionalId`":`"$joaoId`",`"title`":`"Bartender para aniversario`",`"description`":`"Evento de 60 pessoas`",`"category`":`"bartender`",`"valueCents`":25000,`"startsAt`":`"2026-11-01T18:00:00Z`",`"endsAt`":`"2026-11-01T23:00:00Z`"}" 201
$jobId = ($script:lastJson | ConvertFrom-Json).jobPosting.id
$appId = ($script:lastJson | ConvertFrom-Json).jobPosting.applications[0].id

Write-Host "== G. Joao envia contraproposta =="
$script:jar = $jarJoao
Call-Api POST "/api/applications/$appId/counter-offer" '{"valueCents":30000}' 200
Write-Host "        status: $(($script:lastJson | ConvertFrom-Json).application.status) / por: $(($script:lastJson | ConvertFrom-Json).application.counterOfferBy)"

Write-Host "== H. Joao nao pode ver a lista de suplentes (nao e o dono) =="
Call-Api GET "/api/jobs/$jobId/resume" "" 403

Write-Host "== I. Maria ve a lista de suplentes (vazia, so Joao esta pendente) =="
$script:jar = $jarMaria
Call-Api GET "/api/jobs/$jobId/resume" "" 200

Write-Host "== J. Maria aceita a contraproposta =="
Call-Api POST "/api/applications/$appId/respond" '{"decision":"ACCEPT"}' 200
Write-Host "        valor acordado: $(($script:lastJson | ConvertFrom-Json).agreedValueCents)"

Write-Host "== K. Joao nao consegue impulsionar a vaga de Maria =="
$script:jar = $jarJoao
Call-Api POST "/api/jobs/boost" "{`"jobPostingId`":`"$jobId`"}" 403

Write-Host "== L. Maria (dona) passa pela checagem de dono no impulsionamento =="
Write-Host "        (sem ASAAS_API_KEY o provedor Asaas responde 503; o 503 prova que Maria passou pela checagem de dono)"
$script:jar = $jarMaria
Call-Api POST "/api/jobs/boost" "{`"jobPostingId`":`"$jobId`"}" 503

Write-Host ""
Write-Host "== RESULTADO: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
