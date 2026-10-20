# Baixa o tarball de um pacote npm usando o download com retomada e o
# insere no cache do npm, contornando a queda de TLS em arquivos grandes.
param(
  [Parameter(Mandatory = $true)][string]$PackagesCsv,
  [Parameter(Mandatory = $true)][string]$Tools
)

$npm = Join-Path $Tools "node-v20.20.2-win-x64\npm.cmd"
$tarballs = Join-Path $Tools "tarballs"
New-Item -ItemType Directory -Force -Path $tarballs | Out-Null

foreach ($pkg in ($PackagesCsv -split ",")) {
  $url = (& $npm view $pkg dist.tarball) | Select-Object -Last 1
  if (-not $url) { Write-Output "[seed] $pkg : URL nao encontrada"; continue }
  $url = $url.Trim()

  $head = & curl.exe -sIL --http1.1 --max-time 60 $url
  $lengthLine = ($head | Select-String -Pattern "^content-length:" | Select-Object -Last 1)
  if (-not $lengthLine) { Write-Output "[seed] $pkg : sem content-length"; continue }
  $expected = [long]($lengthLine.ToString() -replace "[^0-9]", "")

  $safe = ($pkg -replace "[@/]", "_")
  $out = Join-Path $tarballs "$safe.tgz"

  Write-Output "[seed] $pkg ($expected bytes)"
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Tools "resume-download.ps1") -Url $url -Out $out -ExpectedBytes $expected | Select-Object -Last 1

  if ((Test-Path $out) -and (Get-Item $out).Length -ge $expected) {
    & $npm cache add $out 2>&1 | Select-Object -Last 2
  } else {
    Write-Output "[seed] $pkg : download incompleto, cache nao atualizado"
  }
}
