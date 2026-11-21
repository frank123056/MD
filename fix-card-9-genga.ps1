$ErrorActionPreference = 'Stop'

$ArtifactDir = 'C:\Users\Frank\.gemini\antigravity\brain\89963a54-e141-403a-8542-bd6479effd7c'
$ProjectDir = $PSScriptRoot
$CardsDir = Join-Path $ProjectDir 'public\assets\cards'

Add-Type -AssemblyName PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class GengaFilterV4Padded {
    public static void ConvertToGenga(string inPath, string outPath, int seed) {
        using (Bitmap raw = new Bitmap(inPath)) {
            int w = 960;
            int h = 720;
            int pad = 28;
            using (Bitmap src = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(src)) {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.Clear(Color.FromArgb(250, 243, 227));
                    g.DrawImage(raw, pad, pad, w - pad * 2, h - pad * 2);
                }
                Bitmap dst = new Bitmap(w, h, PixelFormat.Format24bppRgb);
                BitmapData sData = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                BitmapData dData = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                int stride = Math.Abs(sData.Stride);
                byte[] sBuf = new byte[stride * h];
                byte[] dBuf = new byte[stride * h];
                Marshal.Copy(sData.Scan0, sBuf, 0, sBuf.Length);

                float[] rawLum = new float[w * h];
                float[] warmth = new float[w * h];
                for (int y = 0; y < h; y++) {
                    int row = y * stride;
                    for (int x = 0; x < w; x++) {
                        int idx = row + x * 3;
                        float b = sBuf[idx] / 255f;
                        float gr = sBuf[idx + 1] / 255f;
                        float r = sBuf[idx + 2] / 255f;
                        rawLum[y * w + x] = 0.299f * r + 0.587f * gr + 0.114f * b;
                        warmth[y * w + x] = (r - b) + 0.35f * (gr - b);
                        dBuf[idx] = 226;
                        dBuf[idx + 1] = 243;
                        dBuf[idx + 2] = 250;
                    }
                }

                float[] mean7 = new float[w * h];
                for (int y = 4; y < h - 4; y++) {
                    for (int x = 4; x < w - 4; x++) {
                        float sum = 0f;
                        for (int dy = -3; dy <= 3; dy++) {
                            int rOff = (y + dy) * w + x;
                            for (int dx = -3; dx <= 3; dx++) {
                                sum += rawLum[rOff + dx];
                            }
                        }
                        mean7[y * w + x] = sum / 49f;
                    }
                }

                Random rng = new Random(seed);
                for (int y = 5; y < h - 5; y++) {
                    int row = y * stride;
                    for (int x = 5; x < w - 5; x++) {
                        int p = y * w + x;
                        float l = rawLum[p];
                        float m = mean7[p];

                        float dogDark = Math.Max(0f, m - l);
                        float gx = mean7[p + 1] - mean7[p - 1];
                        float gy = mean7[p + w] - mean7[p - w];
                        float smoothGrad = (float)Math.Sqrt(gx * gx + gy * gy);

                        int p2 = (y - 2) * w + (x + 3);
                        float dogDark2 = Math.Max(0f, mean7[p2] - rawLum[p2]);

                        float grain = ((float)rng.NextDouble() - 0.5f) * 0.026f;
                        float pr = 0.980f + grain;
                        float pg = 0.953f + grain * 0.9f;
                        float pb = 0.886f + grain * 0.8f;

                        // Suppress border artifact lines right at pad seam
                        if (x < pad + 3 || x >= w - pad - 3 || y < pad + 3 || y >= h - pad - 3) {
                            dogDark = 0f;
                            dogDark2 = 0f;
                            smoothGrad = 0f;
                        }

                        float wVal = warmth[p];
                        if (wVal > 0.25f && m > 0.25f && m < 0.88f) {
                            float wash = Math.Min(0.48f, (wVal - 0.25f) * 1.25f);
                            pr = pr * (1f - wash) + 0.84f * wash;
                            pg = pg * (1f - wash) + 0.71f * wash;
                            pb = pb * (1f - wash) + 0.37f * wash;
                        }

                        if (m < 0.46f) {
                            float shade = (0.46f - m) * 0.78f;
                            int diag = (x + y) % 6;
                            float hatch = (diag == 0 || diag == 1) ? 1.32f : 0.68f;
                            float sAmt = Math.Min(0.55f, shade * hatch);
                            pr = pr * (1f - sAmt) + 0.26f * sAmt;
                            pg = pg * (1f - sAmt) + 0.25f * sAmt;
                            pb = pb * (1f - sAmt) + 0.23f * sAmt;
                        }

                        if (Math.Abs(m - 0.47f) < 0.022f && smoothGrad > 0.018f && dogDark < 0.08f) {
                            float bAmt = 0.72f;
                            pr = pr * (1f - bAmt) + 0.25f * bAmt;
                            pg = pg * (1f - bAmt) + 0.47f * bAmt;
                            pb = pb * (1f - bAmt) + 0.78f * bAmt;
                        }
                        if (Math.Abs(m - 0.68f) < 0.020f && smoothGrad > 0.018f && dogDark < 0.08f) {
                            float rAmt = 0.74f;
                            pr = pr * (1f - rAmt) + 0.85f * rAmt;
                            pg = pg * (1f - rAmt) + 0.29f * rAmt;
                            pb = pb * (1f - rAmt) + 0.27f * rAmt;
                        }

                        if (dogDark2 > 0.07f) {
                            float cAmt = Math.Min(0.32f, (dogDark2 - 0.06f) * 2.2f);
                            pr = pr * (1f - cAmt) + 0.26f * cAmt;
                            pg = pg * (1f - cAmt) + 0.25f * cAmt;
                            pb = pb * (1f - cAmt) + 0.23f * cAmt;
                        }

                        float strokeStrength = Math.Max(dogDark * 3.8f, (l < 0.22f ? (0.24f - l) * 2.6f : 0f));
                        if (strokeStrength > 0.14f) {
                            float pAmt = Math.Min(0.94f, strokeStrength);
                            pr = pr * (1f - pAmt) + 0.13f * pAmt;
                            pg = pg * (1f - pAmt) + 0.12f * pAmt;
                            pb = pb * (1f - pAmt) + 0.11f * pAmt;
                        }

                        int idx = row + x * 3;
                        dBuf[idx] = (byte)Math.Max(0, Math.Min(255, (int)(pb * 255f)));
                        dBuf[idx + 1] = (byte)Math.Max(0, Math.Min(255, (int)(pg * 255f)));
                        dBuf[idx + 2] = (byte)Math.Max(0, Math.Min(255, (int)(pr * 255f)));
                    }
                }

                Marshal.Copy(dBuf, 0, dData.Scan0, dBuf.Length);
                src.UnlockBits(sData);
                dst.UnlockBits(dData);
                dst.Save(outPath, ImageFormat.Jpeg);
                dst.Dispose();
            }
        }
    }
}
"@

function Decode-WebPToPng($webpPath, $pngPath) {
    $stream = [System.IO.File]::OpenRead($webpPath)
    try {
        $dec = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
            $stream,
            [System.Windows.Media.Imaging.BitmapCreateOptions]::None,
            [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
        )
        $frame = $dec.Frames[0]
        $enc = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
        $enc.Frames.Add($frame)
        $outStream = [System.IO.File]::Create($pngPath)
        try {
            $enc.Save($outStream)
        } finally {
            $outStream.Close()
        }
    } finally {
        $stream.Close()
    }
}

$HordeHeaders = @{
    'Content-Type' = 'application/json'
    'apikey'       = '0000000000'
    'Client-Agent' = 'modern-art-online:1.0:card9fix'
}

$prompt = '1980s Japanese anime mecha production lineart sketch on white paper, centered medium shot with wide empty margin above head, full helmeted head of a classic giant robot mecha and armored shoulders inside frame, intricate mechanical panels, crisp dark pencil outlines, yellow ochre visor accent ### cropped head, cut off top, close up face, dark background, 3d render, blurry'
$body = @{
    prompt = $prompt
    params = @{
        width        = 512
        height       = 384
        steps        = 24
        cfg_scale    = 7.5
        sampler_name = 'k_euler_a'
        seed         = '88909'
        n            = 1
    }
    nsfw        = $false
    censor_nsfw = $false
    slow_workers = $true
    models      = @('Flat-2D Animerge', 'MeinaMix', 'Deliberate')
} | ConvertTo-Json -Depth 5

$sub = Invoke-RestMethod -Uri 'https://stablehorde.net/api/v2/generate/async' -Method Post -Headers $HordeHeaders -Body $body
$id = $sub.id
[Console]::Out.WriteLine("Submitted card #9 job=$id")

$webpPath = Join-Path $ArtifactDir 'scratch_raw_mecha_9_v2.webp'
$pngPath  = Join-Path $ArtifactDir 'scratch_raw_mecha_9_v2.png'
$start = Get-Date
$done = $false

while (((Get-Date) - $start).TotalSeconds -lt 55) {
    Start-Sleep -Seconds 2
    $chk = Invoke-RestMethod -Uri "https://stablehorde.net/api/v2/generate/check/$id"
    if ($chk.faulted) { throw 'Card #9 job faulted' }
    if ($chk.done) {
        $st = Invoke-RestMethod -Uri "https://stablehorde.net/api/v2/generate/status/$id"
        $gen = $st.generations[0]
        if (-not $gen -or -not $gen.img -or $gen.censored -eq $true) { throw 'Empty/censored card #9' }
        Invoke-WebRequest -Uri $gen.img -OutFile $webpPath -UseBasicParsing
        if ((Get-Item $webpPath).Length -lt 15000) { throw 'Card #9 buffer too small' }
        Decode-WebPToPng $webpPath $pngPath
        [Console]::Out.WriteLine("Downloaded card #9 via $($gen.model)")
        $done = $true
        break
    }
}
if (-not $done) { throw 'Card #9 timed out' }

$outJpg = Join-Path $CardsDir 'card_9.jpg'
$outPng = Join-Path $CardsDir 'card_9.png'
[GengaFilterV4Padded]::ConvertToGenga($pngPath, $outJpg, 3909)
Copy-Item $outJpg $outPng -Force
[Console]::Out.WriteLine("Card #9 converted -> $outJpg ($((Get-Item $outJpg).Length) bytes)")
