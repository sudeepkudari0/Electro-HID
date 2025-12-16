# Download medium.en model for Whisper.cpp
# Medium quality - best balance of accuracy and speed for GTX 1650

Write-Host ""
Write-Host "🎙️ Downloading Whisper Medium.en Model" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$modelsDir = "native\whisper\models"
$modelName = "ggml-medium.en.bin"
$modelPath = Join-Path $modelsDir $modelName
$url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$modelName"

# Create directory if it doesn't exist
if (!(Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
    Write-Host "✓ Created models directory" -ForegroundColor Green
}

# Check if already downloaded
if (Test-Path $modelPath) {
    $size = (Get-Item $modelPath).Length / 1MB
    Write-Host "⚠️  Model already exists!" -ForegroundColor Yellow
    Write-Host "   Location: $modelPath"
    Write-Host "   Size: $([math]::Round($size, 2)) MB"
    Write-Host ""
    $overwrite = Read-Host "Download again? (y/N)"
    if ($overwrite -ne "y") {
        Write-Host "Skipping download." -ForegroundColor Yellow
        exit 0
    }
}

Write-Host "Model: medium.en" -ForegroundColor White
Write-Host "Size: ~1.5 GB (this will take a few minutes)" -ForegroundColor White
Write-Host "URL: $url" -ForegroundColor Gray
Write-Host ""
Write-Host "Downloading..." -ForegroundColor Green

try {
    # Download with progress
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $url -OutFile $modelPath -UseBasicParsing
    $ProgressPreference = 'Continue'
    
    Write-Host ""
    Write-Host "✓ Download complete!" -ForegroundColor Green
    Write-Host ""
    
    $finalSize = (Get-Item $modelPath).Length / 1MB
    Write-Host "📁 Location: $modelPath" -ForegroundColor Cyan
    Write-Host "📊 Size: $([math]::Round($finalSize, 2)) MB" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "🎉 Medium.en model ready!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next step: Update your code to use 'medium.en' model" -ForegroundColor Yellow
    
} catch {
    Write-Host ""
    Write-Host "✗ Download failed!" -ForegroundColor Red
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Troubleshooting:" -ForegroundColor Yellow
    Write-Host "1. Check internet connection" 
    Write-Host "2. Try downloading manually from:" 
    Write-Host "   https://huggingface.co/ggerganov/whisper.cpp/tree/main"
    Write-Host "3. Place the file in: native\whisper\models\"
    exit 1
}
