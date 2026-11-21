$ErrorActionPreference = 'Stop'

$ArtifactDir = 'C:\Users\Frank\.gemini\antigravity\brain\89963a54-e141-403a-8542-bd6479effd7c'
$ProjectDir = $PSScriptRoot
$CardsDir = Join-Path $ProjectDir 'public\assets\cards'
$AvatarsDir = Join-Path $ProjectDir 'public\assets\avatars'
$MetaPath = Join-Path $ProjectDir 'cardMetadata.json'

Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class Fix7Filters {
    public static void ConvertGengaClean(string inPath, string outPath, int seed) {
        using (Bitmap raw = new Bitmap(inPath)) {
            int w = 960;
            int h = 720;
            int pad = 24;
            int cropX = Math.Min(28, raw.Width / 10);
            int cropY = Math.Min(8, raw.Height / 12);
            Rectangle srcRect = new Rectangle(cropX, cropY, raw.Width - cropX * 2, raw.Height - cropY * 2);
            using (Bitmap src = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(src)) {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.Clear(Color.FromArgb(250, 243, 227));
                    g.DrawImage(raw, new Rectangle(pad, pad, w - pad * 2, h - pad * 2), srcRect, GraphicsUnit.Pixel);
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
                            for (int dx = -3; dx <= 3; dx++) sum += rawLum[rOff + dx];
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

                        bool inMargin = (x <= pad + 4 || x >= w - pad - 4 || y <= pad + 4 || y >= h - pad - 4);
                        if (!inMargin) {
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

    public static void ConvertToParchmentArtbook(string inPath, string outPath, Rectangle cropRect, int seed) {
        using (Bitmap raw = new Bitmap(inPath)) {
            int w = 960;
            int h = 720;
            Rectangle srcRect = (cropRect.Width > 0 && cropRect.Height > 0)
                ? new Rectangle(cropRect.X, cropRect.Y, Math.Min(cropRect.Width, raw.Width - cropRect.X), Math.Min(cropRect.Height, raw.Height - cropRect.Y))
                : new Rectangle(0, 0, raw.Width, raw.Height);
            using (Bitmap src = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(src)) {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.DrawImage(raw, new Rectangle(0, 0, w, h), srcRect, GraphicsUnit.Pixel);
                }
                Bitmap dst = new Bitmap(w, h, PixelFormat.Format24bppRgb);
                BitmapData sData = src.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
                BitmapData dData = dst.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
                int stride = Math.Abs(sData.Stride);
                byte[] sBuf = new byte[stride * h];
                byte[] dBuf = new byte[stride * h];
                Marshal.Copy(sData.Scan0, sBuf, 0, sBuf.Length);

                float[] lum = new float[w * h];
                float[] mean7 = new float[w * h];
                for (int y = 0; y < h; y++) {
                    int row = y * stride;
                    for (int x = 0; x < w; x++) {
                        int idx = row + x * 3;
                        float b = sBuf[idx] / 255f;
                        float gr = sBuf[idx + 1] / 255f;
                        float r = sBuf[idx + 2] / 255f;
                        lum[y * w + x] = 0.299f * r + 0.587f * gr + 0.114f * b;
                    }
                }
                for (int y = 4; y < h - 4; y++) {
                    for (int x = 4; x < w - 4; x++) {
                        float sum = 0f;
                        for (int dy = -3; dy <= 3; dy++) {
                            int rOff = (y + dy) * w + x;
                            for (int dx = -3; dx <= 3; dx++) sum += lum[rOff + dx];
                        }
                        mean7[y * w + x] = sum / 49f;
                    }
                }

                Random rng = new Random(seed);
                float cx = w * 0.5f, cy = h * 0.48f;
                for (int y = 0; y < h; y++) {
                    int row = y * stride;
                    for (int x = 0; x < w; x++) {
                        int idx = row + x * 3;
                        int p = y * w + x;
                        float b = sBuf[idx] / 255f, gr = sBuf[idx + 1] / 255f, r = sBuf[idx + 2] / 255f;
                        float l = lum[p];
                        float m = (y >= 4 && y < h - 4 && x >= 4 && x < w - 4) ? mean7[p] : l;
                        float grain = ((float)rng.NextDouble() - 0.5f) * 0.025f;
                        float parchR = 0.937f + grain, parchG = 0.890f + grain * 0.9f, parchB = 0.776f + grain * 0.8f;
                        float greenDom = Math.Max(0f, gr - Math.Max(r, b) * 0.75f);
                        float warmDom = Math.Max(0f, r - b);

                        float outR = parchR * (0.35f + 0.65f * l) * 0.55f + r * 0.45f;
                        float outG = parchG * (0.35f + 0.65f * l) * 0.50f + gr * 0.50f;
                        float outB = parchB * (0.35f + 0.65f * l) * 0.65f + b * 0.35f;

                        if (greenDom > 0.04f) {
                            float eAmt = Math.Min(0.65f, greenDom * 2.2f);
                            outR = outR * (1f - eAmt) + 0.16f * eAmt;
                            outG = outG * (1f - eAmt) + 0.52f * eAmt;
                            outB = outB * (1f - eAmt) + 0.34f * eAmt;
                        } else if (warmDom > 0.18f && l > 0.40f) {
                            float gAmt = Math.Min(0.55f, (warmDom - 0.15f) * 1.6f);
                            outR = outR * (1f - gAmt) + 0.82f * gAmt;
                            outG = outG * (1f - gAmt) + 0.67f * gAmt;
                            outB = outB * (1f - gAmt) + 0.34f * gAmt;
                        }

                        float nx = (x - cx) / (w * 0.5f), ny = (y - cy) / (h * 0.5f);
                        float rad = (float)Math.Sqrt(nx * nx * 0.85f + ny * ny * 0.95f);
                        if (rad > 0.62f) {
                            float vAmt = Math.Min(0.88f, (rad - 0.62f) * 1.45f);
                            if (Math.Max(0f, m - l) < 0.07f) {
                                outR = outR * (1f - vAmt) + parchR * vAmt;
                                outG = outG * (1f - vAmt) + parchG * vAmt;
                                outB = outB * (1f - vAmt) + parchB * vAmt;
                            }
                        }

                        if (m < 0.45f) {
                            int h1 = (x + y) % 5, h2 = (x - y + 1000) % 7;
                            if (h1 == 0 || (m < 0.30f && h2 == 0)) {
                                float hAmt = Math.Min(0.38f, (0.45f - m) * 0.85f);
                                outR = outR * (1f - hAmt) + 0.22f * hAmt;
                                outG = outG * (1f - hAmt) + 0.18f * hAmt;
                                outB = outB * (1f - hAmt) + 0.13f * hAmt;
                            }
                        }

                        float stroke = Math.Max(0f, m - l) * 3.8f;
                        if (stroke > 0.12f) {
                            float pAmt = Math.Min(0.92f, stroke);
                            outR = outR * (1f - pAmt) + 0.18f * pAmt;
                            outG = outG * (1f - pAmt) + 0.14f * pAmt;
                            outB = outB * (1f - pAmt) + 0.10f * pAmt;
                        }

                        dBuf[idx] = (byte)Math.Max(0, Math.Min(255, (int)(outB * 255f)));
                        dBuf[idx + 1] = (byte)Math.Max(0, Math.Min(255, (int)(outG * 255f)));
                        dBuf[idx + 2] = (byte)Math.Max(0, Math.Min(255, (int)(outR * 255f)));
                    }
                }

                Marshal.Copy(dBuf, 0, dData.Scan0, dBuf.Length);
                src.UnlockBits(sData);
                dst.UnlockBits(dData);
                using (Graphics g2 = Graphics.FromImage(dst)) {
                    using (Pen outerPen = new Pen(Color.FromArgb(140, 95, 76, 48), 3f))
                    using (Pen innerPen = new Pen(Color.FromArgb(160, 175, 138, 68), 1.5f)) {
                        g2.DrawRectangle(outerPen, 14, 14, w - 28, h - 28);
                        g2.DrawRectangle(innerPen, 20, 20, w - 40, h - 40);
                    }
                }
                dst.Save(outPath, ImageFormat.Jpeg);
                dst.Dispose();
            }
        }
    }
}
"@

function Fetch-PollinationsParchment($cardNum, $promptText, $seed) {
    $rawPath = Join-Path $ArtifactDir "scratch_raw_poll_$cardNum.jpg"
    $outJpg = Join-Path $CardsDir "card_$cardNum.jpg"
    $outPng = Join-Path $CardsDir "card_$cardNum.png"
    $url = 'https://image.pollinations.ai/prompt/' + [uri]::EscapeDataString($promptText) + "?width=640&height=528&seed=$seed&nologo=true"
    if ((Test-Path $rawPath) -and ((Get-Item $rawPath).Length -gt 15000)) {
        $len = (Get-Item $rawPath).Length
        [Fix7Filters]::ConvertToParchmentArtbook($rawPath, $outJpg, (New-Object System.Drawing.Rectangle(0, 0, 640, 480)), $seed)
        Copy-Item $outJpg $outPng -Force
        [Console]::Out.WriteLine(("[Cached Poll #{0:00}] raw={1} -> card_{0}.jpg ({2} bytes)" -f $cardNum, $len, (Get-Item $outJpg).Length))
        return
    }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $url -OutFile $rawPath -UseBasicParsing
            $len = (Get-Item $rawPath).Length
            if ($len -lt 15000) { throw "Image too small ($len bytes)" }
            [Fix7Filters]::ConvertToParchmentArtbook($rawPath, $outJpg, (New-Object System.Drawing.Rectangle(0, 0, 640, 480)), $seed)
            Copy-Item $outJpg $outPng -Force
            [Console]::Out.WriteLine(("[Parchment Poll #{0:00}] raw={1} -> card_{0}.jpg ({2} bytes)" -f $cardNum, $len, (Get-Item $outJpg).Length))
            return
        } catch {
            if ($attempt -eq 3) { throw }
            [Console]::Out.WriteLine("Retrying card #$cardNum after 50s: $($_.Exception.Message)")
            Start-Sleep -Seconds 50
        }
    }
}

Write-Output '1. Cleaning card_9 border seam with Fix7Filters::ConvertGengaClean...'
$raw9 = Join-Path $ArtifactDir 'scratch_raw_mecha_9_v2.png'
$out9Jpg = Join-Path $CardsDir 'card_9.jpg'
$out9Png = Join-Path $CardsDir 'card_9.png'
[Fix7Filters]::ConvertGengaClean($raw9, $out9Jpg, 3909)
Copy-Item $out9Jpg $out9Png -Force
[Console]::Out.WriteLine("[Clean Genga #09] Saved ($((Get-Item $out9Jpg).Length) bytes)")

Write-Output '2. Installing verified parchment cards 27, 31, 32, 37...'
foreach ($n in @(27, 31, 32, 37)) {
    $src = Join-Path $ArtifactDir "scratch_parch_$n.jpg"
    $dstJpg = Join-Path $CardsDir "card_$n.jpg"
    $dstPng = Join-Path $CardsDir "card_$n.png"
    Copy-Item $src $dstJpg -Force
    Copy-Item $src $dstPng -Force
    [Console]::Out.WriteLine(("[Copied Parch #{0:00}] -> card_{0}.jpg ({1} bytes)" -f $n, (Get-Item $dstJpg).Length))
}
Copy-Item (Join-Path $CardsDir 'card_27.jpg') (Join-Path $AvatarsDir 'avatar_7.png') -Force

Write-Output '3. Generating #34 and #36 via Pollinations + ParchmentFantasyFilter...'
$p34 = 'Japanese 2D anime manga lineart illustration, bold dark G-pen ink outlines, flat 2D cel shading, cute 2D anime girl scholar mage wearing round glasses and ornate emerald green and gold high-collared cloak with glowing runes on plain cream paper background'
Fetch-PollinationsParchment 34 $p34 3488

[Console]::Out.WriteLine('Waiting 50s for Pollinations free-tier cooldown before #36...')
Start-Sleep -Seconds 50

$p36 = 'Japanese 2D anime manga lineart illustration, bold dark G-pen ink outlines, flat 2D cel shading, cute 2D anime forest druid princess with large expressive anime eyes wearing a golden leaf-and-emerald crown and ornate green cloak on plain cream paper background'
Fetch-PollinationsParchment 36 $p36 3688

Write-Output '4. Updating cardMetadata.json (?v=fix7) and checking 70 unique hashes...'
$metaJson = Get-Content $MetaPath -Raw -Encoding UTF8 | ConvertFrom-Json
for ($n = 1; $n -le 70; $n++) {
    $entry = $metaJson.([string]$n)
    $entry.image = "/assets/cards/card_$n.jpg?v=fix7"
    if ($n -in @(27, 31, 32, 34, 36, 37)) {
        $entry.source = 'Parchment Fantasy Artbook Pipeline'
    }
}
$jsonStr = $metaJson | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($MetaPath, $jsonStr, [System.Text.UTF8Encoding]::new($false))

$hashes = @{}
for ($n = 1; $n -le 70; $n++) {
    $h = (Get-FileHash (Join-Path $CardsDir "card_$n.jpg") -Algorithm SHA256).Hash
    $hashes[$h] = $true
}
if ($hashes.Count -ne 70) {
    throw "Expected 70 unique hashes, got $($hashes.Count)"
}
Write-Output ("ALL DONE! Updated 9, 27, 31, 32, 34, 36, 37. UniqueHashes=" + $hashes.Count)
