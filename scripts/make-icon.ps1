# 生成应用图标（build/icon.png + build/icon.ico）
#   powershell -File scripts/make-icon.ps1
# 注意：本文件含中文注释，必须保存为「UTF-8 with BOM」——Windows PowerShell 5.1
# 会按 GBK 读取无 BOM 的 .ps1，中文注释会破坏脚本解析（表现为函数静默返回 null）。
# ICO 布局：<=64 用 32bpp BMP 条目（兼容老 API），128/256 用 PNG 条目。
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'

$S = 1024
$outDir = Join-Path (Get-Location) 'build'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-MasterBitmap {
  $bmp = New-Object System.Drawing.Bitmap($S, $S, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # 圆角方块 + 蓝紫渐变（与应用内 logo 一致）
  $pad = 60; $r = 232; $d = $r * 2
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc($pad, $pad, $d, $d, 180, 90)
  $path.AddArc($S - $pad - $d, $pad, $d, $d, 270, 90)
  $path.AddArc($S - $pad - $d, $S - $pad - $d, $d, $d, 0, 90)
  $path.AddArc($pad, $S - $pad - $d, $d, $d, 90, 90)
  $path.CloseFigure()

  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Point(0, 0)),
    (New-Object System.Drawing.Point($S, $S)),
    [System.Drawing.Color]::FromArgb(255, 91, 140, 255),
    [System.Drawing.Color]::FromArgb(255, 163, 113, 247))
  $g.FillPath($grad, $path)

  # 顶部高光
  $hlRect = New-Object System.Drawing.Rectangle(0, 0, $S, [int]($S * 0.55))
  $hl = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $hlRect,
    [System.Drawing.Color]::FromArgb(70, 255, 255, 255),
    [System.Drawing.Color]::FromArgb(0, 255, 255, 255),
    [System.Drawing.Drawing2D.LinearGradientMode]::Vertical)
  $g.SetClip($path)
  $g.FillRectangle($hl, $hlRect)
  $g.ResetClip()

  # 内描边，深色任务栏上也有轮廓
  $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(48, 255, 255, 255), 8)
  $g.DrawPath($pen, $path)

  # LC 字标（带轻微投影）
  $font = New-Object System.Drawing.Font('Segoe UI', 420, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(38, 0, 0, 0))
  $g.DrawString('LC', $font, $shadow, (New-Object System.Drawing.RectangleF(4, -14, $S, $S)), $fmt)
  $g.DrawString('LC', $font, [System.Drawing.Brushes]::White, (New-Object System.Drawing.RectangleF(0, -18, $S, $S)), $fmt)
  $g.Dispose()
  return $bmp
}

function Resize-Bitmap([System.Drawing.Bitmap]$src, [int]$size) {
  $b = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($b)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle(0, 0, $size, $size)))
  $g.Dispose()
  return $b
}

# 32 位 BGRA DIB（BITMAPINFOHEADER + 自下而上的像素 + AND 掩码）：老 API 也能正确读
function Get-DibBytes([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $data.Stride
  $raw = New-Object byte[] ($stride * $h)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $raw, 0, $raw.Length)
  $bmp.UnlockBits($data)

  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)
  $bw.Write([UInt32]40)
  $bw.Write([Int32]$w)
  $bw.Write([Int32]($h * 2))
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)
  $bw.Write([Int32]0); $bw.Write([Int32]0)
  $bw.Write([UInt32]0); $bw.Write([UInt32]0)
  for ($y = $h - 1; $y -ge 0; $y--) { $bw.Write($raw, $y * $stride, $w * 4) }
  $maskRow = [int][math]::Ceiling($w / 8.0)
  $pad = (4 - ($maskRow % 4)) % 4
  $zero = New-Object byte[] ($maskRow + $pad)
  for ($y = 0; $y -lt $h; $y++) { $bw.Write($zero, 0, $zero.Length) }
  $bw.Flush()
  $out = $ms.ToArray()
  $bw.Close(); $ms.Close()
  return , $out
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $out = $ms.ToArray()
  $ms.Close()
  return , $out
}

$master = New-MasterBitmap
$master.Save((Join-Path $outDir 'icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$s256 = Resize-Bitmap $master 256
$s256.Save((Join-Path $outDir 'icon-256.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$s256.Dispose()

# <=64 用 BMP 条目（兼容性最好），128/256 用 PNG 条目（体积小，Vista+ 支持）
$entries = @()
foreach ($sz in @(16, 24, 32, 48, 64)) {
  $b = Resize-Bitmap $master $sz
  $entries += , @{ size = $sz; data = (Get-DibBytes $b) }
  $b.Dispose()
}
foreach ($sz in @(128, 256)) {
  $b = Resize-Bitmap $master $sz
  $entries += , @{ size = $sz; data = (Get-PngBytes $b) }
  $b.Dispose()
}
$master.Dispose()

$fs = [System.IO.File]::Create((Join-Path $outDir 'icon.ico'))
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$entries.Count)
$offset = 6 + 16 * $entries.Count
foreach ($e in $entries) {
  $sz = $e.size; $data = $e.data
  $bw.Write([Byte]$(if ($sz -ge 256) { 0 } else { $sz }))
  $bw.Write([Byte]$(if ($sz -ge 256) { 0 } else { $sz }))
  $bw.Write([Byte]0); $bw.Write([Byte]0)
  $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$data.Length); $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($e in $entries) { $bw.Write($e.data) }
$bw.Flush(); $bw.Close(); $fs.Close()

Get-ChildItem $outDir | Select-Object Name, @{n='KB';e={[math]::Round($_.Length/1KB,1)}} | Format-Table -AutoSize

