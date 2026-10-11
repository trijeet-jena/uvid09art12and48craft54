# UVID — shrink a product photo for data-URI embedding
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File shrink.ps1 -Src "<in.jpg>" -Out "<out.jpg>" [-MaxDim 900] [-Quality 82]
param(
  [Parameter(Mandatory = $true)][string]$Src,
  [Parameter(Mandatory = $true)][string]$Out,
  [int]$MaxDim = 900,
  [int]$Quality = 82
)

Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Src)
try {
  $ratio = [Math]::Min($MaxDim / $img.Width, $MaxDim / $img.Height)
  if ($ratio -gt 1) { $ratio = 1 }
  $w = [int][Math]::Round($img.Width * $ratio)
  $h = [int][Math]::Round($img.Height * $ratio)

  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $w, $h
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $g.DrawImage($img, 0, 0, $w, $h)
    } finally { $g.Dispose() }

    $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() |
      Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
    $ep = New-Object System.Drawing.Imaging.EncoderParameters -ArgumentList 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter -ArgumentList ([System.Drawing.Imaging.Encoder]::Quality), ([long]$Quality)

    $dir = Split-Path -Parent $Out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $bmp.Save($Out, $codec, $ep)
  } finally { $bmp.Dispose() }

  "{0}x{1} -> {2} bytes" -f $w, $h, (Get-Item $Out).Length
} finally { $img.Dispose() }
