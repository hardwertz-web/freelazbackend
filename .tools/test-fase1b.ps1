# Parte 2 da Fase 1: confirmação de e-mail, verificação do contratante e
# recuperação de senha. Os tokens são gerados no console do servidor de dev,
# então este script lê o arquivo de log do "npm run dev".
param(
  [Parameter(Mandatory = $true)][string]$LogFile,
  [Parameter(Mandatory = $true)][string]$EmailToken
)

$base = "http://localhost:3000"
$jar = Join-Path $env:TEMP "freelaz-cookies2.txt"
$bodyFile = Join-Path $env:TEMP "freelaz-body2.json"
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

Write-Host "== A. Login (maria) =="
Call-Api POST "/api/auth/login" '{"email":"maria@exemplo.com","password":"senhaSegura123"}' 200

Write-Host "== B. Confirmar e-mail =="
Call-Api POST "/api/auth/confirm" "{`"token`":`"$EmailToken`"}" 200

Write-Host "== C. Verificar papel Contratante (agora com e-mail confirmado) =="
Call-Api POST "/api/verification/contractor" "" 200
Write-Host "        status: $(($script:lastJson | ConvertFrom-Json).verificationStatus)"

Write-Host "== D. Pedir redefinicao de senha =="
Call-Api POST "/api/auth/password/forgot" '{"email":"maria@exemplo.com"}' 200

Start-Sleep -Seconds 2
$resetToken = (Select-String -Path $LogFile -Pattern "Token de redefini" | Select-Object -Last 1).Line
if ($resetToken) { $resetToken = ($resetToken -split ": ")[-1].Trim() }
Write-Host "        token encontrado no console: $resetToken"

Write-Host "== E. Redefinir a senha =="
Call-Api POST "/api/auth/password/reset" "{`"token`":`"$resetToken`",`"newPassword`":`"novaSenha456`"}" 200

Write-Host "== F. Token de reset nao pode ser reusado (422) =="
Call-Api POST "/api/auth/password/reset" "{`"token`":`"$resetToken`",`"newPassword`":`"outraSenha789`"}" 422

Write-Host "== G. Login com a senha antiga deve dar 401 =="
Call-Api POST "/api/auth/login" '{"email":"maria@exemplo.com","password":"senhaSegura123"}' 401

Write-Host "== H. Login com a senha nova deve dar 200 =="
Call-Api POST "/api/auth/login" '{"email":"maria@exemplo.com","password":"novaSenha456"}' 200

Write-Host ""
Write-Host "== RESULTADO: $($script:pass) passaram, $($script:fail) falharam =="
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
