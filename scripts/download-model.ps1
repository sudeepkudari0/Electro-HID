# Quick setup script for downloading Whisper model

Write-Host "🎙️ Whisper.cpp Model Downloader" -ForegroundColor Cyan
Write-Host ""

$modelsDir = "native\whisper\models"

# Create directory if it doesn't exist
if (!(Test-Path $modelsDir)) {
    New-Item -ItemType Directory -Path $modelsDir -Force | Out-Null
}

# Model options
Write-Host "Available models:" -ForegroundColor Yellow
Write-Host "1. tiny.en   (75 MB)  - Fast, basic accuracy"
Write-Host "2. base.en   (142 MB) - Good balance (RECOMMENDED for GTX 1650)"
Write-Host "3. small.en  (466 MB) - Better accuracy"
Write-Host ""

$choice = Read-Host "Select model (1-3)"

$modelName = switch ($choice) {
    "1" { "tiny.en" }
    "2" { "base.en" }
    "3" { "small.en" }
    default { "base.en" }
}

$fileName = "ggml-$modelName.bin"
$filePath = Join-Path $modelsDir $fileName
$url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$fileName"

Write-Host ""
Write-Host "Downloading $fileName..." -ForegroundColor Green
Write-Host "URL: $url"
Write-Host ""

try {
    Invoke-WebRequest -Uri $url -OutFile $filePath -UseBasicParsing
    Write-Host "✓ Downloaded successfully!" -ForegroundColor Green
    Write-Host "Location: $filePath"
    Write-Host ""
    Write-Host "File size: $((Get-Item $filePath).Length / 1MB) MB"
} catch {
    Write-Host "✗ Download failed: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🎉 Model ready! Now you need whisper.exe (see docs/WHISPER_NATIVE_SETUP.md)" -ForegroundColor Cyan
