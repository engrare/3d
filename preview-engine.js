/* ===========================================================================
   2D ÖNİZLEME MOTORU — ortak, önbellekli
   ---------------------------------------------------------------------------
   Ürün önizleme PNG'lerini okuyup:
     • beyaz kenar boşluğunu kırpar,
     • koyu (yazı) pikselleri istenen renge boyar,
     • sonucu bir data URL olarak döner.

   Bu kod daha önce dört ayrı yerde (ürün detayı, sepet, sipariş detayı ve
   ödeme sayfası) neredeyse birebir kopyalanmıştı ve HER renk / adet / obje
   değişiminde 1234x694 = ~856.000 piksel baştan taranıp yeniden PNG'ye
   kodlanıyordu — tarayıcıyı gözle görülür şekilde kilitleyen kısım buydu.

   Şimdi her görsel yalnızca BİR kez taranır; üretilen data URL'ler önbelleğe
   alınır, aynı görsel+renk tekrar istendiğinde iş yapılmadan anında döner.
   =========================================================================== */

const baseCache = new Map();   // src      -> { img, w, h, dark, minX... } | null
const urlCache  = new Map();   // src|renk -> { url, aspect }
const BASE_MAX  = 8;
const URL_MAX   = 48;

let scratchCanvas = null;
function scratch(w, h) {
    if (!scratchCanvas) scratchCanvas = document.createElement('canvas');
    if (scratchCanvas.width  !== w) scratchCanvas.width  = w;
    if (scratchCanvas.height !== h) scratchCanvas.height = h;
    return scratchCanvas;
}

function capMap(map, max) {
    while (map.size > max) map.delete(map.keys().next().value);
}

/* Görseli bir kez tara: kırpma sınırları + koyu piksellerin indeksleri */
function analyze(img) {
    const w = img.naturalWidth  || img.width;
    const h = img.naturalHeight || img.height;
    const ctx = scratch(w, h).getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0);

    let px;
    try { px = ctx.getImageData(0, 0, w, h).data; }
    catch (e) { return null; }                      // CORS ile kirlenmiş canvas

    let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
    const dark = [];
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            const i = (row + x) * 4;
            const r = px[i], g = px[i + 1], b = px[i + 2], a = px[i + 3];
            // Beyaz kenar boşluğu değilse kırpma sınırını genişlet
            if (!(r > 240 && g > 240 && b > 240 && a > 200)) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                found = true;
            }
            // Koyu (yazı) pikselleri sonradan boyayabilmek için indeksle
            if (r < 60 && g < 60 && b < 60 && a > 0) dark.push(i);
        }
    }
    return { img, w, h, dark: Uint32Array.from(dark), minX, minY, maxX, maxY, found };
}

/* Taranmış bilgiden istenen renkte, kırpılmış görseli üret */
function render(info, rgb) {
    const { w, h } = info;
    const ctx = scratch(w, h).getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(info.img, 0, 0);

    const imageData = ctx.getImageData(0, 0, w, h);
    if (rgb) {
        const d = imageData.data, dark = info.dark;
        for (let k = 0; k < dark.length; k++) {
            const i = dark[k];
            d[i] = rgb.r; d[i + 1] = rgb.g; d[i + 2] = rgb.b;
        }
    }

    const crop = info.found && info.maxX > info.minX && info.maxY > info.minY;
    const cw = crop ? (info.maxX - info.minX + 1) : w;
    const ch = crop ? (info.maxY - info.minY + 1) : h;

    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    const octx = out.getContext('2d');
    if (crop) octx.putImageData(imageData, -info.minX, -info.minY, info.minX, info.minY, cw, ch);
    else      octx.putImageData(imageData, 0, 0);

    return { url: out.toDataURL(), aspect: crop ? (cw / ch) : null };
}

/**
 * getPreviewImage(src, rgb, cb)
 *   rgb : { r, g, b } — koyu pikselleri bu renge boyar. null ise boyama yapılmaz
 *         (özel obje görselleri için).
 *   cb(url, aspect, status)
 *         status = 'ok'    -> url kullanılabilir
 *                  'raw'   -> canvas okunamadı, ham görsel kullanılmalı
 *                  'error' -> görsel hiç yüklenemedi
 */
export function getPreviewImage(src, rgb, cb) {
    const key = src + '|' + (rgb ? rgb.r + ',' + rgb.g + ',' + rgb.b : 'raw');

    const hit = urlCache.get(key);
    if (hit) { cb(hit.url, hit.aspect, 'ok'); return; }

    const cached = baseCache.get(src);
    if (cached !== undefined) {
        if (cached === null) { cb(null, null, 'raw'); return; }
        const out = render(cached, rgb);
        urlCache.set(key, out); capMap(urlCache, URL_MAX);
        cb(out.url, out.aspect, 'ok');
        return;
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        const info = analyze(img);
        baseCache.set(src, info); capMap(baseCache, BASE_MAX);
        if (!info) { cb(null, null, 'raw'); return; }
        const out = render(info, rgb);
        urlCache.set(key, out); capMap(urlCache, URL_MAX);
        cb(out.url, out.aspect, 'ok');
    };
    img.onerror = function() { cb(null, null, 'error'); };
    img.src = src;
}
