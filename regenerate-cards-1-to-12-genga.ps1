$ErrorActionPreference = 'Stop'

$ArtifactDir = 'C:\Users\Frank\.gemini\antigravity\brain\89963a54-e141-403a-8542-bd6479effd7c'
$ProjectDir = $PSScriptRoot
$CardsDir = Join-Path $ProjectDir 'public\assets\cards'
$AssetsDir = Join-Path $ProjectDir 'public\assets'
$AvatarsDir = Join-Path $AssetsDir 'avatars'
$MetaPath = Join-Path $ProjectDir 'cardMetadata.json'

Add-Type -AssemblyName PresentationCore, WindowsBase
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class GengaFilterV4 {
    public static void ConvertToGenga(string inPath, string outPath, int seed) {
        using (Bitmap raw = new Bitmap(inPath)) {
            int w = 960;
            int h = 720;
            using (Bitmap src = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
                using (Graphics g = Graphics.FromImage(src)) {
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.DrawImage(raw, 0, 0, w, h);
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
    'Client-Agent' = 'modern-art-online:1.0:genga12'
}

function Invoke-HordeRawImage($cardNum, $promptText, $models, $seedOffset) {
    $webpPath = Join-Path $ArtifactDir "scratch_raw_mecha_$cardNum.webp"
    $pngPath  = Join-Path $ArtifactDir "scratch_raw_mecha_$cardNum.png"
    if ((Test-Path $pngPath) -and ((Get-Item $pngPath).Length -gt 50000)) {
        [Console]::Out.WriteLine(("[Cached RAW #{0:00}] Using existing {1}" -f $cardNum, $pngPath))
        return $pngPath
    }
    $body = @{
        prompt = $promptText
        params = @{
            width        = 512
            height       = 384
            steps        = 22
            cfg_scale    = 7.0
            sampler_name = 'k_euler_a'
            seed         = [string](22000 + $cardNum * 173 + $seedOffset * 701)
            n            = 1
        }
        nsfw        = $false
        censor_nsfw = $false
        slow_workers = $true
        models      = $models
    } | ConvertTo-Json -Depth 5

    $sub = Invoke-RestMethod -Uri 'https://stablehorde.net/api/v2/generate/async' -Method Post -Headers $HordeHeaders -Body $body
    if (-not $sub.id) {
        throw "Failed to submit card #$cardNum to AI Horde"
    }
    $id = $sub.id
    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt 55) {
        Start-Sleep -Seconds 2
        $chk = Invoke-RestMethod -Uri "https://stablehorde.net/api/v2/generate/check/$id"
        if ($chk.faulted) {
            throw "AI Horde job faulted for card #$cardNum"
        }
        if ($chk.done) {
            $st = Invoke-RestMethod -Uri "https://stablehorde.net/api/v2/generate/status/$id"
            $gen = $st.generations[0]
            if (-not $gen -or -not $gen.img -or $gen.censored -eq $true) {
                throw "Empty or censored generation for card #$cardNum"
            }
            Invoke-WebRequest -Uri $gen.img -OutFile $webpPath -UseBasicParsing
            $len = (Get-Item $webpPath).Length
            if ($len -lt 15000) {
                throw "Generated image too small ($len bytes) for card #$cardNum"
            }
            Decode-WebPToPng $webpPath $pngPath
            [Console]::Out.WriteLine(("[Horde RAW #{0:00}] model={1} bytes={2}" -f $cardNum, $gen.model, $len))
            return $pngPath
        }
    }
    try {
        Invoke-RestMethod -Uri "https://stablehorde.net/api/v2/generate/status/$id" -Method Delete -Headers $HordeHeaders | Out-Null
    } catch {}
    throw "Timed out waiting for card #$cardNum"
}

Write-Output '1. Preserving card_2 untouched as anchor...'
$anchorPath = Join-Path $ArtifactDir 'mecha_genga_keyframe_1795265067037.jpg'
Copy-Item $anchorPath (Join-Path $CardsDir 'card_2.jpg') -Force
Copy-Item $anchorPath (Join-Path $CardsDir 'card_2.png') -Force
Copy-Item $anchorPath (Join-Path $AssetsDir 'artist_0.png') -Force

Write-Output '2. Generating 7 base images for cards 4, 5, 7, 8, 9, 10, 12 via AI Horde...'
$PrimaryModels = @('Lyriel', 'NeverEnding Dream', 'Deliberate', 'Flat-2D Animerge', 'MeinaMix')
$FallbackModels = @('Flat-2D Animerge', 'MeinaMix', 'Deliberate', 'Dreamshaper', 'stable_diffusion')

$HordeItems = @(
    @{ Num = 4;  Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, Mobile Suit Gundam style heavy armored mecha bracing a shield and firing a shoulder railgun, intricate mechanical armor panels, crisp dark pencil outlines, yellow ochre crest accent ### dark background, neon, 3d render, blurry' },
    @{ Num = 5;  Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, battle-damaged giant robot mecha head and torso with broken V-fin antenna and exposed cables, intricate mechanical detail, crisp dark pencil outlines, yellow ochre visor ### dark background, neon, 3d render, blurry' },
    @{ Num = 7;  Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, close-up of a stoic female mecha bridge officer with short hair and tactical visor headset beside a retro monitor console, crisp dark pencil outlines, yellow ochre collar accent ### dark background, neon, 3d render, blurry' },
    @{ Num = 8;  Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, Macross Valkyrie style variable fighter-mecha banking in mid-air with thruster verniers and mechanical wing flaps, crisp dark pencil outlines, yellow ochre wing stripe ### dark background, neon, 3d render, blurry' },
    @{ Num = 9;  Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, female mecha pilot in armored flight suit holding her helmet under her arm beside a giant robot mechanical foot, crisp dark pencil outlines, yellow ochre shoulder pad ### dark background, neon, 3d render, blurry' },
    @{ Num = 10; Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, heavy sniper mecha unit kneeling and aiming a long high-energy rifle cannon with mechanical cooling fins, crisp dark pencil outlines, yellow ochre scope accent ### dark background, neon, 3d render, blurry' },
    @{ Num = 12; Prompt = '1980s Japanese anime mecha production lineart sketch on white paper, prototype commander mecha bust spreading geometric wing binders with open chest exhaust vents, intricate mechanical lineart, crisp dark pencil outlines, yellow ochre chest vent ### dark background, neon, 3d render, blurry' }
)

$RawInputs = @{
    1  = (Join-Path $ArtifactDir 'gen_card_01_1795268361973.jpg')
    3  = (Join-Path $ArtifactDir 'mecha_zero_card_art_1795264787916.jpg')
    6  = (Join-Path $ArtifactDir 'gen_card_06_1795268363761.jpg')
    11 = (Join-Path $ArtifactDir 'gen_card_11_1795268365953.jpg')
}

# Submit staggered and wait cleanly
foreach ($item in $HordeItems) {
    $cardNum = $item.Num
    $prompt = $item.Prompt
    try {
        $RawInputs[$cardNum] = Invoke-HordeRawImage $cardNum $prompt $PrimaryModels 0
    } catch {
        [Console]::Out.WriteLine("Retrying card #$cardNum with fallback models: $($_.Exception.Message)")
        Start-Sleep -Seconds 1
        $RawInputs[$cardNum] = Invoke-HordeRawImage $cardNum $prompt $FallbackModels 1
    }
    Start-Sleep -Milliseconds 800
}

Write-Output '3. Converting 11 cards (1, 3..12) to unified 1980s Studio Genga pencil style...'
foreach ($cardNum in @(1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12)) {
    $inFile = $RawInputs[$cardNum]
    $outJpg = Join-Path $CardsDir "card_$cardNum.jpg"
    $outPng = Join-Path $CardsDir "card_$cardNum.png"
    [GengaFilterV4]::ConvertToGenga($inFile, $outJpg, 3000 + $cardNum * 37)
    Copy-Item $outJpg $outPng -Force
    $bytes = (Get-Item $outJpg).Length
    [Console]::Out.WriteLine(("[Genga #{0:00}] Saved -> card_{0}.jpg ({1} bytes)" -f $cardNum, $bytes))
}

Write-Output '4. Updating avatars 0..3 and cardMetadata.json (?v=genga12)...'
Copy-Item (Join-Path $CardsDir 'card_2.jpg') (Join-Path $AvatarsDir 'avatar_0.png') -Force
Copy-Item (Join-Path $CardsDir 'card_1.jpg') (Join-Path $AvatarsDir 'avatar_1.png') -Force
Copy-Item (Join-Path $CardsDir 'card_3.jpg') (Join-Path $AvatarsDir 'avatar_2.png') -Force
Copy-Item (Join-Path $CardsDir 'card_6.jpg') (Join-Path $AvatarsDir 'avatar_3.png') -Force

$metaJson = Get-Content $MetaPath -Raw -Encoding UTF8 | ConvertFrom-Json
for ($n = 1; $n -le 70; $n++) {
    $key = [string]$n
    $entry = $metaJson.$key
    $entry.image = "/assets/cards/card_$n.jpg?v=genga12"
    if ($n -le 12) {
        $entry.style = '80年代手繪動畫原畫鉛筆線稿風 (Studio Genga)'
        if ($n -eq 2) {
            $entry.source = 'Gemini Studio Genga Reference (#02 Anchor)'
        } else {
            $entry.source = 'Studio Genga Production Key-Frame Pipeline'
        }
    }
}
$jsonStr = $metaJson | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($MetaPath, $jsonStr, [System.Text.UTF8Encoding]::new($false))

$hashes = @{}
for ($n = 1; $n -le 70; $n++) {
    $p = Join-Path $CardsDir "card_$n.jpg"
    $h = (Get-FileHash $p -Algorithm SHA256).Hash
    $hashes[$h] = $true
}
if ($hashes.Count -ne 70) {
    throw "Expected 70 unique hashes, got $($hashes.Count)"
}
Write-Output ("ALL DONE! card_1..card_12 unified with card_2 anchor. UniqueHashes=" + $hashes.Count)
