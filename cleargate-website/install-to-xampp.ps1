<#
  Copies the ClearGate website (pages + PHP API) into XAMPP so it runs at
    http://localhost/cleargate/

  Usage (PowerShell, from this folder):
    powershell -ExecutionPolicy Bypass -File .\install-to-xampp.ps1
  Pass -Xampp "D:\xampp" if XAMPP is not in C:\xampp.

  Re-running updates the copy in htdocs\cleargate. Evidence files students
  uploaded (api\uploads) are kept. The database folder is NOT copied: it holds
  the SQL you import in phpMyAdmin.
#>
param(
  [string]$Xampp = "C:\xampp"
)

$ErrorActionPreference = "Stop"
$site   = $PSScriptRoot
$target = Join-Path $Xampp "htdocs\cleargate"

if (-not (Test-Path (Join-Path $Xampp "htdocs"))) {
  throw "XAMPP not found at $Xampp. Install XAMPP or pass -Xampp <folder>."
}
New-Item -ItemType Directory -Force $target | Out-Null

# robocopy merges into the existing copy, so uploaded evidence is never deleted.
robocopy $site $target /E /XD database .vscode .git /XF README.md install-to-xampp.ps1 /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copy failed (robocopy exit code $LASTEXITCODE)." }

Write-Host ""
Write-Host "ClearGate copied to $target" -ForegroundColor Green
Write-Host "Next: import database\cleargate_db.sql in phpMyAdmin (if you haven't), then open:"
Write-Host "  http://localhost/cleargate/api/index.php?route=health   (should say connected)"
Write-Host "  http://localhost/cleargate/                              (the website)"
