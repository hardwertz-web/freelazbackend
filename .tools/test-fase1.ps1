# Teste ponta a ponta da Fase 1 (cadastro -> papeis -> perfil -> verificacao).
# Roda contra o servidor de dev em http://localhost:3000, usando um cookie
# jar para manter a sessao entre as chamadas.
$base = "http://localhost:3000"
$jar = Join-Path $env:TEMP "freelaz-cookies.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-body.json"
Remove-Item $jar -Force -ErrorAction SilentlyContinue

$script:pass = 0
$script:fail = 0
$script:lastJson = ""

function Call-Api {
  param([string]$Method, [string]$Path, [string]$Body = "", [int]$Expect)
  if ($Body) { Set-Content -Path $bodyFile -Value $Body -Encoding utf8 -NoNewline }
  $curlArgs = @("-s", "-X", $Method, "$base$Path", "-H", "Content-Type: application/json",
                "-b", $jar, "-c", $jar, "-w", "`n%{http_code}")
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

Write-Host "== 1. Sem sessao, /me deve dar 401 =="
Call-Api GET "/api/auth/me" "" 401

Write-Host "== 2. Cadastro CPF valido (profissional) =="
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"529.982.247-25","name":"Maria da Silva","birthDate":"1995-04-12","email":"maria@exemplo.com","phone":"(35) 99999-0000","password":"senhaSegura123","roles":["PROFISSIONAL"],"acceptedTerms":true}' 201
Write-Host "        papel inicial: $($script:lastJson)"

Write-Host "== 3. Sessao atual =="
Call-Api GET "/api/auth/me" "" 200

Write-Host "== 4. Cadastro duplicado (mesmo CPF/e-mail) deve dar 409 =="
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"52998224725","name":"Maria da Silva","birthDate":"1995-04-12","email":"maria@exemplo.com","phone":"(35) 98888-0000","password":"senhaSegura123","roles":["PROFISSIONAL"],"acceptedTerms":true}' 409

Write-Host "== 5. CPF invalido deve dar 422 =="
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"111.111.111-11","name":"Joao Teste","birthDate":"1995-04-12","email":"joao@exemplo.com","phone":"(35) 97777-0000","password":"senhaSegura123","roles":["CONTRATANTE"],"acceptedTerms":true}' 422

Write-Host "== 6. Menor de 18 anos deve dar 422 =="
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"390.533.447-05","name":"Jovem Teste","birthDate":"2015-04-12","email":"jovem@exemplo.com","phone":"(35) 96666-0000","password":"senhaSegura123","roles":["CONTRATANTE"],"acceptedTerms":true}' 422

Write-Host "== 7. Sem aceitar os termos deve dar 422 =="
Call-Api POST "/api/auth/register" '{"documentType":"CPF","document":"39053344705","name":"Sem Termos","birthDate":"1990-04-12","email":"semtermos@exemplo.com","phone":"(35) 95555-0000","password":"senhaSegura123","roles":["CONTRATANTE"],"acceptedTerms":false}' 422

Write-Host "== 8. Atualizar perfil profissional =="
Call-Api PUT "/api/profile/professional" '{"bio":"Bartender com 6 anos de experiencia em eventos e bares da regiao.","headline":"Bartender e barista","categories":["bartender","garcom"],"region":"Itajuba - Centro","availability":["SEX_NOITE","SAB_INTEIRO"],"softSkills":["Pontual","Simpatico"],"referencePriceCents":25000,"experiences":[{"company":"Bar do Ze","role":"Bartender","periodStart":"03-2019","periodEnd":"12-2022"}]}' 200
Write-Host "        forca do perfil: $(($script:lastJson | ConvertFrom-Json).profileStrength)"

Write-Host "== 9. Periodo de experiencia invalido deve dar 422 =="
Call-Api PUT "/api/profile/professional" '{"experiences":[{"company":"X","role":"Y","periodStart":"2019-03"}]}' 422

Write-Host "== 10. Enviar verificacao profissional (documento + selfie) =="
$png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
Call-Api POST "/api/verification/professional" "{`"documentUrl`":`"$png`",`"selfieUrl`":`"$png`"}" 201
Write-Host "        status: $((($script:lastJson | ConvertFrom-Json).verification).status)"

Write-Host "== 11. Ativar papel Contratante depois do cadastro =="
Call-Api POST "/api/auth/roles" '{"role":"CONTRATANTE"}' 201

Write-Host "== 12. Perfil do contratante =="
Call-Api GET "/api/profile/contractor" "" 200

Write-Host "== 13. Login com senha errada deve dar 401 =="
Call-Api POST "/api/auth/login" '{"email":"maria@exemplo.com","password":"errada12345"}' 401

Write-Host "== 14. Verificacao do contratante sem e-mail confirmado deve dar 422 =="
Call-Api POST "/api/verification/contractor" "" 422

Write-Host "== 15. Upload privado sem sessao deve dar 401 =="
$r = & curl.exe -s -o NUL -w "%{http_code}" "$base/api/uploads/verifications/qualquer/arquivo.jpg"
if ($r -eq "401") { Write-Host "  OK    [401] upload privado sem sessao"; $script:pass++ }
else { Write-Host "  FALHA [$r] upload privado sem sessao (esperado 401)" -ForegroundColor Red; $script:fail++ }

Write-Host ""
Write-Host "== RESULTADO: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
