# Download base.en model for Whisper.cpp
# Base quality - excellent balance for GTX 1650 (142 MB)

Write-Host ""
Write-Host "Downloading Whisper Base.en Model" -ForegroundColor Cyan
Write-Host "==================================" -ForegroundColor Cyan
Write-Host ""

$modelsDir = "native\whisper\models"
$modelName = "ggml-base.en.bin"
$modelPath = Join-Path $modelsDir $modelName
$url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelName"

# Create directory
if (!(Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
}

# Check if exists
if (Test-Path $modelPath) {
    $size = (Get-Item $modelPath).Length / 1MB
    Write-Host "Model already exists ($([math]::Round($size, 2)) MB)" -ForegroundColor Yellow
    Write-Host "At: $modelPath" -ForegroundColor Yellow
    exit 0
}

Write-Host "Model: base.en (142 MB)" -ForegroundColor White
Write-Host "Downloading from HuggingFace..." -ForegroundColor Green
Write-Host ""

Invoke-WebRequest -Uri $url -OutFile $modelPath -UseBasicParsing

Write-Host ""
Write-Host "Download complete!" -ForegroundColor Green
$finalSize = (Get-Item $modelPath).Length / 1MB
Write-Host "Size: $([math]::Round($finalSize, 2)) MB" -ForegroundColor Cyan
Write-Host "Location: $modelPath" -ForegroundColor Cyan
Write-Host ""
Write-Host "Ready! Update code to use model: 'base.en'" -ForegroundColor Yellow
