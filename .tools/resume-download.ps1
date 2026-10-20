# Baixa um arquivo grande em pedaços, retomando de onde parou.
# Motivo: nesta rede o TLS cai no meio de transferências longas
# (SEC_E_DECRYPT_FAILURE), então baixamos em várias tentativas com
# "curl -C -" (resume) até o tamanho bater com o esperado.
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][long]$ExpectedBytes,
  [int]$MaxAttempts = 60
)

$attempt = 0
while ($attempt -lt $MaxAttempts) {
  $attempt++
  $current = if (Test-Path $Out) { (Get-Item $Out).Length } else { 0 }
  if ($current -ge $ExpectedBytes) { break }

  Write-Output ("[resume] tentativa {0}: {1:N0}/{2:N0} bytes" -f $attempt, $current, $ExpectedBytes)
  # --speed-time/--speed-limit: aborta conexões que travarem, para tentar de novo
  & curl.exe -sL -C - --http1.1 --max-time 300 --speed-limit 10240 --speed-time 30 -o $Out $Url
  Start-Sleep -Seconds 1
}

$final = if (Test-Path $Out) { (Get-Item $Out).Length } else { 0 }
if ($final -ge $ExpectedBytes) {
  Write-Output ("[resume] completo: {0:N0} bytes" -f $final)
  exit 0
} else {
  Write-Output ("[resume] INCOMPLETO: {0:N0}/{1:N0} bytes" -f $final, $ExpectedBytes)
  exit 1
}
