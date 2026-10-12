# Nhập token Cloudflare Tunnel (do người quản lý Cloudflare gửi) để app chạy bằng tên miền cố định.
# Chạy bằng cách bấm đúp file nhap-token-cloudflare.cmd
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host ''
Write-Host '=== GAN TEN MIEN CO DINH CHO ZALO CSKH ===' -ForegroundColor Green
Write-Host ''
Write-Host 'Dan TOKEN ma nguoi quan ly Cloudflare gui (chuoi dai bat dau bang eyJ...).'
Write-Host 'Neu ho gui ca cau lenh "cloudflared ... install eyJ..." thi dan ca cau cung duoc.'
$raw = Read-Host 'Token'
$token = ($raw -split '\s+' | Where-Object { $_ -like 'eyJ*' } | Select-Object -Last 1)
if (-not $token) { Write-Host 'Khong tim thay token hop le (phai bat dau bang eyJ).' -ForegroundColor Red; Read-Host 'Nhan Enter de dong'; exit 1 }

$domain = (Read-Host 'Ten mien da duoc cap (vd: cskhzalo.sieutoc.com)').Trim() -replace '^https?://', '' -replace '/.*$', ''
if (-not $domain) { Write-Host 'Chua nhap ten mien.' -ForegroundColor Red; Read-Host 'Nhan Enter de dong'; exit 1 }

# Luu token (file nay KHONG duoc gui cho ai, khong dua len GitHub)
New-Item -ItemType Directory -Force (Join-Path $root 'tools') | Out-Null
Set-Content -Path (Join-Path $root 'tools\cloudflare-tunnel-token.txt') -Value $token -NoNewline -Encoding ascii

# Ghi PUBLIC_URL vao .env de app hien link co dinh cho nhan vien
$envFile = Join-Path $root '.env'
$lines = @()
if (Test-Path $envFile) { $lines = Get-Content $envFile -Encoding utf8 | Where-Object { $_ -notmatch '^\s*PUBLIC_URL=' } }
$lines += "PUBLIC_URL=https://$domain"
Set-Content -Path $envFile -Value $lines -Encoding utf8

Write-Host ''
Write-Host 'Dang khoi dong lai tunnel va app...' -ForegroundColor Yellow
$pm2 = Join-Path $root 'node_modules\.bin\pm2.cmd'
& $pm2 delete zalo-cskh-tunnel 2>$null | Out-Null
& $pm2 start ecosystem.config.cjs --only zalo-cskh-tunnel | Out-Null
& $pm2 restart zalo-cskh --update-env | Out-Null
& $pm2 save | Out-Null

Write-Host ''
Write-Host "XONG! Doi khoang 30 giay roi mo: https://$domain" -ForegroundColor Green
Write-Host 'Neu khong vao duoc, chup man hinh cua so nay gui lai.'
Read-Host 'Nhan Enter de dong'
