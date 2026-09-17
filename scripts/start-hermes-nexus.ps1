$ErrorActionPreference = "Stop"

docker compose up --build -d

Write-Host ""
Write-Host "Hermes Nexus iniciado." -ForegroundColor Green
Write-Host "Abre: http://localhost:8770"
Write-Host ""