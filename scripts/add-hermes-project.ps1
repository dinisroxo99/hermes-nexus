param(
  [Parameter(Mandatory = $true)]
  [string]$Name,

  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$envFile = Join-Path $rootDir ".env"
$projectsFile = Join-Path $rootDir "data\projects.json"

function Read-ProjectRegistry {
  if (!(Test-Path $projectsFile)) {
    return @()
  }

  $raw = Get-Content $projectsFile -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return @()
  }

  $parsed = $raw | ConvertFrom-Json
  if ($null -eq $parsed) {
    return @()
  }

  return @($parsed | Where-Object {
    $_.PSObject.Properties.Name -contains "name" -and
    $_.PSObject.Properties.Name -contains "relativePath" -and
    -not [string]::IsNullOrWhiteSpace($_.name) -and
    -not [string]::IsNullOrWhiteSpace($_.relativePath)
  })
}

function Write-ProjectRegistry($projects) {
  $items = @($projects)

  if ($items.Count -eq 0) {
    $json = "[]`n"
  } elseif ($items.Count -eq 1) {
    $json = "[`n$($items[0] | ConvertTo-Json -Depth 10)`n]`n"
  } else {
    $json = ($items | ConvertTo-Json -Depth 10) + "`n"
  }

  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($projectsFile, $json, $utf8NoBom)
}

if (!(Test-Path $envFile)) {
  throw "Ficheiro .env não encontrado. Faz primeiro: copy .env.example .env"
}

$envLines = Get-Content $envFile
$projectsRootLine = $envLines | Where-Object { $_ -match "^PROJECTS_ROOT=" } | Select-Object -First 1

if (!$projectsRootLine) {
  throw "PROJECTS_ROOT não existe no .env"
}

$projectsRoot = $projectsRootLine.Split("=", 2)[1].Trim().Trim('"')
$projectsRootResolved = (Resolve-Path $projectsRoot).Path.TrimEnd("\", "/")
$projectResolved = (Resolve-Path $Path).Path.TrimEnd("\", "/")

if (!$projectResolved.StartsWith($projectsRootResolved, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "O projeto tem de estar dentro de PROJECTS_ROOT. PROJECTS_ROOT atual: $projectsRootResolved"
}

if ($Name -notmatch "^[a-zA-Z0-9][a-zA-Z0-9\-_]*$") {
  throw "Nome inválido. Usa apenas letras, números, '-' ou '_'. Exemplo: faturas-backend"
}

$relativePath = $projectResolved.Substring($projectsRootResolved.Length).TrimStart("\", "/")
$relativePath = $relativePath -replace "\\", "/"

if ([string]::IsNullOrWhiteSpace($relativePath)) {
  throw "O projeto não pode ser a própria pasta PROJECTS_ROOT. Escolhe uma subpasta."
}

if (!(Test-Path $projectsFile)) {
  Write-ProjectRegistry @()
}

$projects = @(Read-ProjectRegistry)
$existing = @($projects | Where-Object { $_.name -eq $Name -or $_.relativePath -eq $relativePath })
if ($existing.Count -gt 1) {
  throw "Ambiguous project registration: name and path must identify one record."
}

$projectId = "prj_$([Guid]::NewGuid())"
if ($existing.Count -eq 1 -and $existing[0].PSObject.Properties.Name -contains "projectId") {
  $projectId = $existing[0].projectId
  if ($projectId -isnot [string] -or $projectId -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,127}\z') {
    throw "Invalid projectId."
  }
}
$projects = @($projects | Where-Object { $_.name -ne $Name -and $_.relativePath -ne $relativePath })

$projects += [PSCustomObject]@{
  projectId = $projectId
  name = $Name
  relativePath = $relativePath
  addedAt = (Get-Date).ToString("s")
}

Write-ProjectRegistry $projects

Write-Host ""
Write-Host "Projeto adicionado:" -ForegroundColor Green
Write-Host "Nome:          $Name"
Write-Host "Path:          $projectResolved"
Write-Host "RelativePath:  $relativePath"
Write-Host ""
