param([int]$ProcId = 0, [string]$OutPath = "win_shot.png", [int]$WaitSec = 6)
# 窗口级截屏（验证布局居中 —— viewport 纹理截图在 canvas_items 缩放下恒全幅，无法暴露窗口布局问题）
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Start-Sleep -Seconds $WaitSec
$proc = Get-Process -Id $ProcId -ErrorAction Stop
# Godot 窗口标题 = 项目名
$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($b.Width, $b.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output "SAVED $OutPath"
