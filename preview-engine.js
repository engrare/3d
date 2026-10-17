/* ===========================================================================
   2D ÖNİZLEME MOTORU — ortak, önbellekli
   ---------------------------------------------------------------------------
   Ürün önizleme görsellerindeki koyu (yazı) pikseller seçilen yazı rengine
   boyanır.

   Önceden her renk için görselin tamamı piksel piksel boyanıp yeniden PNG'ye
   kodlanıyor, megabaytlarca data URL olarak <img>'e veriliyordu: telefonda
   ürün açılışı ve her renk değişimi sayfayı yarım saniye, büyük stand
   görselinde birkaç saniye donduruyordu.

   Şimdi görsel iki katman olarak gösterilir:
     • taban: koyu pikseller komşu renkle doldurulmuş görsel (<img>),
     • maske: yalnızca koyu pikseller; <img>'in üstündeki boya katmanının
       CSS maskesi, katmanın arka plan rengi yazı rengidir.
   Renk değişimi yalnızca bu arka plan rengini değiştirir: piksel işi,
   kodlama ya da yeniden yükleme yok.
   Katalogdaki önizlemelerin katmanları scripts/onizleme-katman.py ile hazır
   (products.js: src = taban, mask = maske); tarayıcı yalnızca indirir.
   Maskesi verilmeyen görsel bir kez, ayrı bir iş parçacığında (Worker)
   katmanlara ayrılır. Katmanlar görsel başına önbellekte.
   =========================================================================== */

/* Bundan büyük görseller işlenmeden önce küçültülür (önizleme kutusu ekranda
   en çok ~1000 cihaz pikseli genişliğinde). Yayındaki görseller bu sınırın altında. */
const MAX_PIXELS = 1000000;

const layerCache = new Map();   // src|mask -> Promise<{ base, mask, aspect, status } | null>
const aspectCache = new Map();  // src -> en-boy oranı (görsel hazır olunca)

/* Koyu pikselleri maskeye taşır; tabanda yerlerini en yakın koyu olmayan pikselin
   rengiyle doldurur. Tarayıcı küçültürken taban ve maskeyi ayrı ayrı harmanlıyor;
   boşluk saydam kalsa kenarlarda zemin rengi sızıp ince koyu çizgi oluşuyordu.
   px: taban pikselleri (yerinde değişir), m: boş maske. Koyu piksel sayısını döner.
   Worker'a metin olarak da gönderiliyor: dışarıdaki hiçbir şeye başvurmamalı.
   Koyu piksel kuralı scripts/onizleme-katman.py ile aynı olmalı. */
function splitPixels(px, m, w, h) {
    const n = w * h;
    /* durum: 0 koyu değil, 1 opak koyu (doldurulacak), 2 yarı saydam koyu (boş kalır),
              3 doldurma kuyruğuna girdi */
    const durum = new Uint8Array(n);
    let koyu = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        const a = px[i + 3];
        // Gri kenar yumuşatma pikselleri bilerek boyanmaz: beyaz yazı renginde ürünün
        // şeklini beyaz zeminde gösteren ince dış çizgi onlar.
        if (a > 0 && px[i] < 60 && px[i + 1] < 60 && px[i + 2] < 60) {
            m[i + 3] = a;                           // maskede yalnızca saydamlık önemli
            durum[p] = a === 255 ? 1 : 2;
            px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
            koyu++;
        }
    }
    if (!koyu) return 0;

    // Çok kaynaklı genişlik öncelikli arama: koyu bölgeye komşu her piksel bir kaynak
    const renk = new Uint32Array(px.buffer, px.byteOffset, n);   // piksel başına tek okuma/yazma
    const kuyruk = new Int32Array(n);
    let bas = 0, son = 0;
    for (let p = 0; p < n; p++) {
        if (durum[p] !== 1) continue;
        const x = p % w;
        if (x > 0 && durum[p - 1] === 0)     { durum[p - 1] = 3; kuyruk[son++] = p - 1; }
        if (x < w - 1 && durum[p + 1] === 0) { durum[p + 1] = 3; kuyruk[son++] = p + 1; }
        if (p >= w && durum[p - w] === 0)    { durum[p - w] = 3; kuyruk[son++] = p - w; }
        if (p < n - w && durum[p + w] === 0) { durum[p + w] = 3; kuyruk[son++] = p + w; }
    }
    while (bas < son) {
        const p = kuyruk[bas++], x = p % w, c = renk[p];
        if (x > 0 && durum[p - 1] === 1)     { renk[p - 1] = c; durum[p - 1] = 3; kuyruk[son++] = p - 1; }
        if (x < w - 1 && durum[p + 1] === 1) { renk[p + 1] = c; durum[p + 1] = 3; kuyruk[son++] = p + 1; }
        if (p >= w && durum[p - w] === 1)    { renk[p - w] = c; durum[p - w] = 3; kuyruk[son++] = p - w; }
        if (p < n - w && durum[p + w] === 1) { renk[p + w] = c; durum[p + w] = 3; kuyruk[son++] = p + w; }
    }
    return koyu;
}

/* İndirme, çözme, tarama ve PNG kodlama ayrı iş parçacığında: hazırlanırken de
   sayfa kilitlenmez. Sonuç: { aspect, base: Blob, mask: Blob } ya da { aspect, plain } */
const WORKER_SRC = `"use strict";
const MAX_PIXELS = ${MAX_PIXELS};
${splitPixels}
self.onmessage = async e => {
    const { id, url } = e.data;
    try {
        const res = await fetch(url, { priority: 'high' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const bmp = await createImageBitmap(await res.blob());
        const k = Math.min(1, Math.sqrt(MAX_PIXELS / (bmp.width * bmp.height)));
        const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
        const cv = new OffscreenCanvas(w, h), ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bmp, 0, 0, w, h);
        if (bmp.close) bmp.close();
        const data = ctx.getImageData(0, 0, w, h), mask = ctx.createImageData(w, h);
        if (!splitPixels(data.data, mask.data, w, h)) return self.postMessage({ id, aspect: w / h, plain: true });
        ctx.putImageData(data, 0, 0);
        const mc = new OffscreenCanvas(w, h);
        mc.getContext('2d').putImageData(mask, 0, 0);
        const [base, maske] = await Promise.all([cv.convertToBlob(), mc.convertToBlob()]);
        self.postMessage({ id, aspect: w / h, base, mask: maske });
    } catch (err) {
        self.postMessage({ id, error: String(err) });
    }
};`;

let worker = null;              // null: henüz kurulmadı, false: bu tarayıcıda kullanılamıyor
const isler = new Map();
let isNo = 0;

function splitInWorker(src) {
    if (worker === false || typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ||
        typeof createImageBitmap === 'undefined') return Promise.reject(new Error('worker yok'));
    if (!worker) {
        try { worker = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); }
        catch (e) { worker = false; return Promise.reject(e); }
        worker.onmessage = e => { const is = isler.get(e.data.id); if (is) { isler.delete(e.data.id); is(e.data); } };
        worker.onerror = () => { stopWorker(); };
    }
    const url = new URL(src, document.baseURI).href;   // blob'dan kurulan worker göreli adresi çözemez
    return new Promise((ok, fail) => {
        const id = ++isNo;
        isler.set(id, r => (r.error ? fail(new Error(r.error)) : ok(r)));
        worker.postMessage({ id, url });
    });
}

function stopWorker() {
    if (worker) worker.terminate();
    worker = false;
    isler.forEach(is => is({ error: 'worker' }));
    isler.clear();
}

function loadImage(src) {
    return new Promise((ok, fail) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        if ('fetchPriority' in img) img.fetchPriority = 'high';   // ürün galerisinden önce insin
        // decode(): çözme ana iş parçacığı dışında; drawImage'da sayfa kilitlenmesin
        img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(() => ok(img));
        img.onerror = fail;
        img.src = src;
    });
}

const toBlob = cv => new Promise((ok, fail) => cv.toBlob(b => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'));

/* Worker'ın işini sayfada yapar (OffscreenCanvas olmayan eski tarayıcılar) */
function splitOnPage(src) {
    return loadImage(src).then(img => {
        const w0 = img.naturalWidth, h0 = img.naturalHeight;
        const k = Math.min(1, Math.sqrt(MAX_PIXELS / (w0 * h0)));
        const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, w, h);

        let data;
        try { data = ctx.getImageData(0, 0, w, h); }
        catch (e) { return { aspect: w0 / h0, raw: true }; }      // CORS ile kirlenmiş canvas
        const mask = ctx.createImageData(w, h);
        if (!splitPixels(data.data, mask.data, w, h)) return { aspect: w / h, plain: true };
        ctx.putImageData(data, 0, 0);
        const mc = document.createElement('canvas');
        mc.width = w; mc.height = h;
        mc.getContext('2d').putImageData(mask, 0, 0);
        return Promise.all([toBlob(cv), toBlob(mc)]).then(([base, m]) => ({ aspect: w / h, base, mask: m }));
    });
}

const blobToDataUrl = b => new Promise((ok, fail) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = fail;
    fr.readAsDataURL(b);
});

/* Katmanları önceden çöz: ekrana verildiklerinde taban ve maske aynı karede görünsün */
function predecode(urls) {
    return Promise.all(urls.map(u => {
        const im = new Image();
        im.src = u;
        return (im.decode ? im.decode() : Promise.resolve()).catch(() => {}).then(() => im);
    }));
}

/* Taban: blob adresi (kısa; megabaytlık data URL dizgisi taşınmaz).
   Maske: data URL; CSS maskesinde her tarayıcıda güvenle çalışır, dosyası da küçük. */
function finish(src, r) {
    // Boyanacak piksel yok ya da canvas okunamadı (raw): ham görsel olduğu gibi
    if (r.plain || r.raw) return { base: src, mask: null, aspect: r.aspect, status: r.raw ? 'raw' : 'ok' };
    return blobToDataUrl(r.mask).then(mask => {
        const base = URL.createObjectURL(r.base);
        return predecode([base, mask]).then(tut => ({ base, mask, aspect: r.aspect, status: 'ok', tut }));
    });
}

/* Hazır katmanlar: yalnızca indir ve çöz. Taban <img>'de (CORS'suz), maske CSS'te
   (CORS kipinde iner) gösterileceği için aynı kiple yüklenip önbellekte kalıyorlar. */
function preloaded(base, mask) {
    const yukle = (u, cors) => new Promise((ok, fail) => {
        const im = new Image();
        if (cors) im.crossOrigin = 'anonymous';
        if ('fetchPriority' in im) im.fetchPriority = 'high';   // ürün galerisinden önce insin
        im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ok(im));
        im.onerror = fail;
        im.src = u;
    });
    return Promise.all([yukle(base, false), yukle(mask, true)]).then(([b, m]) =>
        ({ base, mask, aspect: b.naturalWidth / b.naturalHeight, status: 'ok', tut: [b, m] }));
}

function layers(src, mask) {
    const key = mask ? src + '|' + mask : src;
    let p = layerCache.get(key);
    if (p) return p;
    p = (mask
        ? preloaded(src, mask)
        : splitInWorker(src)
            // Worker yok ya da işi yapamadı: sayfada dene; orada olduysa sorun worker'daydı, bir daha kullanma
            .catch(() => splitOnPage(src).then(r => { stopWorker(); return r; }))
            .then(r => finish(src, r))
    ).catch(() => null);
    layerCache.set(key, p);
    p.then(L => {
        if (L) aspectCache.set(src, L.aspect);
        else layerCache.delete(key);                 // yüklenemedi: sonraki çağrı yeniden denesin
    });
    return p;
}

/* <img>'in hemen arkasında, aynı alanı kaplayan boya katmanı (bir kez oluşturulur) */
function tintLayer(img) {
    const next = img.nextElementSibling;
    if (next && next.classList.contains('onizleme-boya')) return next;
    const t = document.createElement('div');
    t.className = 'onizleme-boya';
    const cs = getComputedStyle(img), s = t.style;
    s.cssText = 'position:absolute;pointer-events:none;display:none;';
    /* Görsel <img>'in içerik kutusuna çiziliyor; kenarlık/dolgu varsa (ürün sayfasında
       .product-images img { border: 1px }) katman da o kadar içeriden başlasın, yoksa
       maske görselden büyük kalıp dış çizgileri örtüyordu. */
    ['Top', 'Right', 'Bottom', 'Left'].forEach(k => {
        s[k.toLowerCase()] = (parseFloat(cs['border' + k + 'Width']) || 0) + (parseFloat(cs['padding' + k]) || 0) + 'px';
    });
    s.zIndex = cs.zIndex;
    s.imageRendering = cs.imageRendering;            // <img> ile aynı ölçekleme
    // <img> object-fit: contain; maske de aynı alana oturur
    ['-webkit-mask-', 'mask-'].forEach(on => {
        s.setProperty(on + 'size', 'contain');
        s.setProperty(on + 'position', 'center');
        s.setProperty(on + 'repeat', 'no-repeat');
    });
    img.after(t);
    return t;
}

const whenDecoded = img => img.decode
    ? img.decode().catch(() => {})
    : new Promise(r => (img.complete ? r() : img.addEventListener('load', r, { once: true })));

/* previewOf() sonucu ({ src, mask }) ya da yalnızca görsel adresi */
const kaynak = pv => (typeof pv === 'string' ? { src: pv, mask: null } : pv);

/**
 * paintPreview(img, pv, color, cb)
 *   img   : önizleme <img> öğesi (taban); boya katmanı arkasına eklenir
 *   pv    : previewOf() sonucu { src, mask }; mask yoksa src tarayıcıda katmanlara ayrılır
 *   color : yazı rengi (CSS rengi); koyu pikseller bu renge boyanır
 *   cb(aspect, status)  görsel ekrandayken (naturalWidth okunabilir)
 *         status = 'ok'    -> boyalı önizleme
 *                  'raw'   -> canvas okunamadı, ham görsel
 *                  'error' -> görsel hiç yüklenemedi (öğe gizlendi)
 *   Aynı öğeye art arda istek gelirse yalnızca sonuncusu uygulanır.
 */
export function paintPreview(img, pv, color, cb) {
    if (!img) return;
    const { src, mask } = kaynak(pv);
    const st = img._onizleme || (img._onizleme = { tok: 0, src: null });
    const tok = ++st.tok;
    const tint = tintLayer(img);
    tint.style.backgroundColor = color;              // görsel hazırsa renk değişimi burada biter

    layers(src, mask).then(L => {
        if (st.tok !== tok) return;                  // yerine daha yeni bir istek geldi
        if (!L) {
            st.src = null;
            img.removeAttribute('src');
            img.style.display = tint.style.display = 'none';
            if (cb && img.isConnected) cb(null, 'error');
            return;
        }
        if (st.src !== L.base) {
            st.src = L.base;
            img.src = L.base;
            const url = L.mask ? `url("${L.mask}")` : 'none';
            tint.style.setProperty('-webkit-mask-image', url);
            tint.style.setProperty('mask-image', url);
        }
        img.style.display = 'block';
        tint.style.display = L.mask ? 'block' : 'none';
        whenDecoded(img).then(() => {
            if (st.tok === tok && cb && img.isConnected) cb(L.aspect, L.status);
        });
    });
}

/* Önizlemeyi boşalt (başka ürüne geçerken eski ürünün görseli görünmesin) */
export function clearPreview(img) {
    if (!img) return;
    const st = img._onizleme || (img._onizleme = { tok: 0, src: null });
    st.tok++;
    st.src = null;
    img.removeAttribute('src');
    img.style.display = 'none';
    const t = img.nextElementSibling;
    if (t && t.classList.contains('onizleme-boya')) t.style.display = 'none';
}

/* Görseli arka planda hazırla: ürün sayfası açılınca beklemeden çizilsin */
export function preloadPreview(pv) {
    const { src, mask } = kaynak(pv);
    return layers(src, mask);
}

/* Hazırlanmış görselin en-boy oranı (henüz hazır değilse null) */
export function knownAspect(src) {
    return aspectCache.get(src) || null;
}

/* --------------------------------------------------------------------------
   Sosyal medya ikonlarının dış beyaz zemini
   Bazı ikon dosyaları opak kare (beyaz köşeli). Koyu standın üstünde beyaz
   kutu gibi duruyorlardı. Kenardan içeri doğru yayılan beyaz bölgeyi silip
   saydam yapıyoruz; ikonun İÇİNDEKİ beyaza (örn. X harfi) dokunmuyoruz.
   İkon önizlemede birkaç onlu piksel; büyük dosyalar (telegram 1211 px)
   küçültülerek işleniyor, yoksa seçildiği an sayfa kilitleniyordu.
   -------------------------------------------------------------------------- */
const logoCache = new Map();    // src -> Promise<url>
const LOGO_MAX = 256;

function cleanLogo(img, src) {
    const k = Math.min(1, LOGO_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);

    let data;
    try { data = ctx.getImageData(0, 0, w, h); }
    catch (e) { return src; }                       // kirlenmiş canvas

    const px = data.data, n = w * h;
    const beyaz = i => px[i + 3] > 0 && px[i] > 205 && px[i + 1] > 205 && px[i + 2] > 205;
    const seen = new Uint8Array(n), yigin = new Int32Array(n);
    let sp = 0;
    const it = p => { if (!seen[p]) { seen[p] = 1; yigin[sp++] = p; } };
    for (let x = 0; x < w; x++) { it(x); it(x + (h - 1) * w); }
    for (let y = 0; y < h; y++) { it(y * w); it(w - 1 + y * w); }
    while (sp) {
        const p = yigin[--sp], i = p * 4;
        if (!beyaz(i)) continue;
        px[i + 3] = 0;
        const x = p % w;
        if (x > 0)     it(p - 1);
        if (x < w - 1) it(p + 1);
        if (p >= w)    it(p - w);
        if (p < n - w) it(p + w);
    }
    /* Silinen beyazın kenarında kalan açık gri kenar yumuşatma pikselleri
       koyu zeminde ince beyaz çizgi gibi duruyor; onları da temizle. */
    const acik = i => px[i + 3] > 0 && px[i] > 170 && px[i + 1] > 170 && px[i + 2] > 170;
    const bos = q => px[q * 4 + 3] === 0;
    const silinecek = [];
    for (let p = 0; p < n; p++) {
        const i = p * 4;
        if (px[i + 3] === 0 || !acik(i)) continue;
        const x = p % w;
        if ((x > 0 && bos(p - 1)) || (x < w - 1 && bos(p + 1)) ||
            (p >= w && bos(p - w)) || (p < n - w && bos(p + w))) silinecek.push(i);
    }
    for (const i of silinecek) px[i + 3] = 0;

    ctx.putImageData(data, 0, 0);
    return cv.toDataURL();
}

export function getSocialLogo(src, cb) {
    let p = logoCache.get(src);
    if (!p) {
        p = loadImage(src).then(img => cleanLogo(img, src), () => src);
        logoCache.set(src, p);
    }
    p.then(cb);
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
            // Her tuş vuruşunda, boyutlanmada ve renk tıklamasında çağrılıyor; QR yalnızca değişince üretilsin
            const qrKey = link + '|' + s.textColor;
            if (link && typeof QRious !== 'undefined' && qrImg._qr !== qrKey) {
                qrImg._qr = qrKey;
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
            const logoSrc = new URL(`./content/social/${plat}.png`, import.meta.url).href;
            // Platform art arda değişirse geç hazırlanan eski ikon yenisinin üstüne yazılmasın
            logoImg._logo = logoSrc;
            getSocialLogo(logoSrc, url => { if (logoImg._logo === logoSrc && logoImg.getAttribute('src') !== url) logoImg.src = url; });
            logoArea.style.backgroundColor = s.objColor;
            coverArtwork(logoArea, logoImg);
            applyPerspectiveTransform(logoArea, expandQuad(coordsLogo), fit.w, fit.h, fit.x, fit.y);
        }
    });
}

/* Ürünün (sepet/sipariş kaleminde seçili standın) önizleme görseli: { src, mask }
   (item yoksa ilk stand). Görsel yolları site köküne göre ("./content/..."). */
export function previewOf(p, item) {
    const o = customObjFor(p, item || {});
    if (o) return { src: o.src, mask: o.mask || null };
    if (p && p.preview) return { src: p.preview.src, mask: p.preview.mask || null };
    return { src: `./content/products/${p ? p.id : item && item.productId}/preview.png`, mask: null };
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
