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

    const crop = false; // Disable dynamic cropping for coordinate stability
    const cw = crop ? (info.maxX - info.minX + 1) : w;
    const ch = crop ? (info.maxY - info.minY + 1) : h;

    const out = document.createElement('canvas');
    out.width = cw; out.height = ch;
    out.getContext('2d').putImageData(imageData, crop ? -info.minX : 0, crop ? -info.minY : 0);

    return { url: out.toDataURL('image/png'), aspect: cw / ch };
}

/* --------------------------------------------------------------------------
   Sosyal medya ikonlarının dış beyaz zemini
   Bazı ikon dosyaları opak kare (beyaz köşeli). Koyu standın üstünde beyaz
   kutu gibi duruyorlardı. Kenardan içeri doğru yayılan beyaz bölgeyi silip
   saydam yapıyoruz; ikonun İÇİNDEKİ beyaza (örn. X harfi) dokunmuyoruz.
   -------------------------------------------------------------------------- */
const logoCache = new Map();

export function getSocialLogo(src, cb) {
    const hit = logoCache.get(src);
    if (hit !== undefined) { cb(hit); return; }

    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function () {
        const w = img.naturalWidth, h = img.naturalHeight;
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);

        let data;
        try { data = ctx.getImageData(0, 0, w, h); }
        catch (e) { logoCache.set(src, src); cb(src); return; }   // kirlenmiş canvas

        const px = data.data;
        const beyaz = i => px[i + 3] > 0 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;
        const seen = new Uint8Array(w * h);
        const stack = [];
        for (let x = 0; x < w; x++) { stack.push(x, x + (h - 1) * w); }
        for (let y = 0; y < h; y++) { stack.push(y * w, w - 1 + y * w); }
        while (stack.length) {
            const p = stack.pop();
            if (seen[p]) continue;
            seen[p] = 1;
            const i = p * 4;
            if (!beyaz(i)) continue;
            px[i + 3] = 0;
            const x = p % w, y = (p / w) | 0;
            if (x > 0)     stack.push(p - 1);
            if (x < w - 1) stack.push(p + 1);
            if (y > 0)     stack.push(p - w);
            if (y < h - 1) stack.push(p + w);
        }
        /* Silinen beyazın kenarında kalan açık gri kenar yumuşatma pikselleri
           koyu zeminde ince beyaz çizgi gibi duruyor; onları da temizle. */
        const acik = i => px[i + 3] > 0 && px[i] > 170 && px[i + 1] > 170 && px[i + 2] > 170;
        const silinecek = [];
        for (let p = 0; p < w * h; p++) {
            const i = p * 4;
            if (px[i + 3] === 0 || !acik(i)) continue;
            const x = p % w, y = (p / w) | 0;
            const bos = (q) => px[q * 4 + 3] === 0;
            if ((x > 0 && bos(p - 1)) || (x < w - 1 && bos(p + 1)) ||
                (y > 0 && bos(p - w)) || (y < h - 1 && bos(p + w))) silinecek.push(i);
        }
        for (const i of silinecek) px[i + 3] = 0;

        ctx.putImageData(data, 0, 0);
        const url = cv.toDataURL();
        logoCache.set(src, url);
        cb(url);
    };
    img.onerror = function () { logoCache.set(src, src); cb(src); };
    img.src = src;
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
        if (cached === null) { 
            // Fallback to image aspect ratio if available
            const img = new Image();
            img.src = src;
            const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : null;
            cb(null, aspect, 'raw'); 
            return; 
        }
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
        if (!info) { 
            const aspect = (img.naturalWidth && img.naturalHeight) ? (img.naturalWidth / img.naturalHeight) : null;
            cb(null, aspect, 'raw'); 
            return; 
        }
        const out = render(info, rgb);
        urlCache.set(key, out); capMap(urlCache, URL_MAX);
        cb(out.url, out.aspect, 'ok');
    };
    img.onerror = function() { cb(null, null, 'error'); };
    img.src = src;
}


/* ===========================================================================
   QR STANDI KATMANLARI — ana sayfa ve ödeme sayfası ortak (önceden sadece ana
   sayfadaydı; ödeme özetinde QR/logo hiç çizilmiyordu).
   =========================================================================== */

const hexOr = (v, yedek) => /^#[0-9a-fA-F]{6}$/.test(v) ? v : yedek;

/* Sosyal medya: girilen kullanıcı adını seçili platformun gerçek profil linkine
   çevirir; QR bu linke gider. Tam link yazılırsa aynen kullanılır.
   backend/functions/index.js içindeki SOCIAL_BASE ile aynı olmalı. */
export const SOCIAL_BASE = {
    instagram: 'https://www.instagram.com/',
    twitter:   'https://x.com/',
    facebook:  'https://www.facebook.com/',
    linkedin:  'https://www.linkedin.com/in/',
    youtube:   'https://www.youtube.com/@',
    tiktok:    'https://www.tiktok.com/@',
    telegram:  'https://t.me/',
    web:       'https://'          // engrare.com -> https://engrare.com
};
export function socialUrl(platform, input) {
    const v = String(input || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;                          // https://... tam link
    if (/^[\w-]+(\.[\w-]+)+\/\S/.test(v)) return 'https://' + v;    // instagram.com/kaya
    const handle = v.replace(/^@+/, '').replace(/\s+/g, '');
    const base = SOCIAL_BASE[platform];
    return (base && handle) ? base + encodeURIComponent(handle) : '';
}

/* Görselde plakaların çevresinde açık renkli kenar çizgisi var; katmanı merkezinden
   biraz büyütüp o çizgiyi de zemin rengiyle kapatıyoruz. */
const ARTWORK_COVER = 0.10;      // %10 büyütme

export function expandQuad(coords, k) {
    const f = 1 + (k === undefined ? ARTWORK_COVER : k);
    const cx = (coords[0][0] + coords[1][0] + coords[2][0] + coords[3][0]) / 4;
    const cy = (coords[0][1] + coords[1][1] + coords[2][1] + coords[3][1]) / 4;
    return coords.map(p => [cx + (p[0] - cx) * f, cy + (p[1] - cy) * f]);
}

/* Katman büyüdü; içindeki görseli eski ölçüsünde tutmak için ortaya daraltıyoruz. */
export function coverArtwork(area, img) {
    if (!img) return;
    const f = 1 + ARTWORK_COVER;
    const boyut = 100 / f, kenar = (100 - boyut) / 2;
    img.style.width = boyut + '%';
    img.style.height = boyut + '%';
    img.style.left = kenar + '%';
    img.style.top = kenar + '%';
}

/* coords: köşe matrisi — [ [solÜst], [sağÜst], [solAlt], [sağAlt] ], her köşe [x%, y%]
   offX/offY: görselin kutu içindeki sol/üst boşluğu */
export function applyPerspectiveTransform(el, coords, w, h, offX, offY) {
    if (!el || !coords || coords.length !== 4) {
        if(el) { el.style.transform = ''; el.style.display = 'none'; }
        return;
    }
    const [tl, tr, bl, br] = coords;
    const ox = offX || 0, oy = offY || 0;
    const x0 = (tl[0] / 100) * w + ox, y0 = (tl[1] / 100) * h + oy;
    const x1 = (tr[0] / 100) * w + ox, y1 = (tr[1] / 100) * h + oy;
    const x2 = (br[0] / 100) * w + ox, y2 = (br[1] / 100) * h + oy;
    const x3 = (bl[0] / 100) * w + ox, y3 = (bl[1] / 100) * h + oy;

    let dx1 = x1 - x2, dy1 = y1 - y2;
    let dx2 = x3 - x2, dy2 = y3 - y2;
    let dx3 = x0 - x1 + x2 - x3;
    let dy3 = y0 - y1 + y2 - y3;

    let m11, m12, m13, m21, m22, m23, m31, m32, m33;
    if (Math.abs(dx3) < 0.001 && Math.abs(dy3) < 0.001) {
        m11 = x1 - x0; m21 = x2 - x1; m31 = x0;
        m12 = y1 - y0; m22 = y2 - y1; m32 = y0;
        m13 = 0;       m23 = 0;       m33 = 1;
    } else {
        let det1 = dx1 * dy2 - dy1 * dx2;
        if (det1 === 0) return; 
        let a13 = (dx3 * dy2 - dy3 * dx2) / det1;
        let a23 = (dx1 * dy3 - dy1 * dx3) / det1;

        m11 = x1 - x0 + a13 * x1; m21 = x3 - x0 + a23 * x3; m31 = x0;
        m12 = y1 - y0 + a13 * y1; m22 = y3 - y0 + a23 * y3; m32 = y0;
        m13 = a13;                m23 = a23;                m33 = 1;
    }

    /* Normalizasyon katmanın KENDİ ölçüsüyle: katman kutuyu kaplar, görsel ise
       kutunun içinde daha küçük olabilir. */
    const elW = el.offsetWidth || w, elH = el.offsetHeight || h;
    m11 /= elW; m12 /= elW; m13 /= elW;
    m21 /= elH; m22 /= elH; m23 /= elH;

    const mat = [ m11, m12, 0, m13, m21, m22, 0, m23, 0, 0, 1, 0, m31, m32, 0, m33 ];
    el.style.transformOrigin = '0 0';
    el.style.transform = `matrix3d(${mat.join(',')})`;
    el.style.display = 'block';
}

/* Sosyal QR/logo katmanları — ürün detayı, sepet, sipariş detayı ve ödeme sayfası ortak kullanır.
   Katman id'leri: `${pre}-social-{qr|logo}-{area|img}-{1|2}${suf}`
   s: { plat1, link1, plat2, link2, textColor, objColor }, fit: {x, y, w, h} */
export function placeSocialOverlays(obj, pre, suf, s, fit) {
    [1, 2].forEach(i => {
        const el = k => document.getElementById(`${pre}-social-${k}-${i}${suf}`);
        const qrArea = el('qr-area'), qrImg = el('qr-img');
        const logoArea = el('logo-area'), logoImg = el('logo-img');
        const plat = s['plat' + i], link = s['link' + i];
        const coordsQR = obj[`previewSocialQR${i}`];
        const coordsLogo = obj[`previewSocialLogo${i}`];

        /* Görseldeki hazır QR plakasının yüzü opak beyaz, logo kutusunda da hazır
           ikon var. Katmanın arkasını zemin rengiyle doldurup altta kalan çizimi
           kapatıyoruz. Link girilmese de plaka kapatılıyor; yoksa beyaz leke kalıyor. */
        if (qrArea && coordsQR) {
            if (link && typeof QRious !== 'undefined') {
                qrImg.src = new QRious({
                    value: link,
                    size: 300,
                    foreground: s.textColor,
                    background: 'transparent'
                }).toDataURL();
            }
            qrImg.style.visibility = link ? 'visible' : 'hidden';
            qrArea.style.backgroundColor = s.objColor;
            coverArtwork(qrArea, qrImg);
            applyPerspectiveTransform(qrArea, expandQuad(coordsQR), fit.w, fit.h, fit.x, fit.y);
        } else if (qrArea) {
            qrArea.style.display = 'none';
        }

        if (logoArea && coordsLogo && SOCIAL_BASE.hasOwnProperty(plat)) {   // plat sepetten gelir; yola yalnızca bilinen ad
            // Yol bu modüle göre çözülür: ana sayfa ve payment/ alt klasörü aynı ikonu bulur
            getSocialLogo(new URL(`./content/social/${plat}.png`, import.meta.url).href, url => { logoImg.src = url; });
            logoArea.style.backgroundColor = s.objColor;
            coverArtwork(logoArea, logoImg);
            applyPerspectiveTransform(logoArea, expandQuad(coordsLogo), fit.w, fit.h, fit.x, fit.y);
        }
    });
}

/* Sepet / sipariş kaleminin seçili stand objesi */
export function customObjFor(p, item) {
    if (!p || !p.isCustomObject) return null;
    const sel = (item.selectedObject || '').toLowerCase();
    return p.isCustomObject.find(o => {
        const oName = (o.objectName || '').toLowerCase();
        return oName === sel || oName.includes(sel) || sel.includes(oName);
    }) || p.isCustomObject[0];
}

/* Kayıtlı kalemden placeSocialOverlays girdisi */
export function itemSocialState(item) {
    return {
        plat1: item.socialPlatform1, link1: socialUrl(item.socialPlatform1, item.socialLink1),
        plat2: item.socialPlatform2, link2: socialUrl(item.socialPlatform2, item.socialLink2),
        textColor: hexOr(item.textColor, '#000000'),
        objColor: hexOr(item.objColor, '#FFFFFF')
    };
}
