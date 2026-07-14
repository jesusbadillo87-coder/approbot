Add-Type -AssemblyName System.Drawing

function Resize-Image ($src, $dest, $w, $h) {
    $img = [System.Drawing.Image]::FromFile($src)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, 0, 0, $w, $h)
    $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    $img.Dispose()
}

Resize-Image "C:\Users\Dell\Documents\app_roboto\icon-192.png" "C:\Users\Dell\Documents\app_roboto\icon-192.png" 192 192
Resize-Image "C:\Users\Dell\Documents\app_roboto\icon-512.png" "C:\Users\Dell\Documents\app_roboto\icon-512.png" 512 512
Resize-Image "C:\Users\Dell\Documents\app_roboto\screenshot1.png" "C:\Users\Dell\Documents\app_roboto\screenshot1.png" 1024 1024
Resize-Image "C:\Users\Dell\Documents\app_roboto\screenshot2.png" "C:\Users\Dell\Documents\app_roboto\screenshot2.png" 1024 1024
