/* Ürün kataloğu — ana sayfa (myScript.js) ve ödeme sayfası (payment/myScript.js) ortak kullanır.
   Önceden ödeme sayfasında ayrı bir kopya vardı; eskiyip önizlemeleri bozuyordu.
   Görsel yolları site köküne göre ("./content/..."); ödeme sayfası resolveAssetPath ile çözüyor.
   2D önizleme: preview (standlarda src) = taban, mask = yazı rengine boyanan katman.
   İkisi asıl PNG'den scripts/onizleme-katman.py ile üretilir; PNG değişince yeniden üret, ?v= artır. */

/* Admin panelinden (RTDB config/products) düzenlenen ad/fiyat/açıklama/etiket değerlerini
   koddaki varsayılanların üzerine uygular. Fiyat yalnızca GÖSTERİM içindir; tahsil edilen
   tutarı her zaman sunucu (functions/index.js > loadProductCatalog) hesaplar.
   Metinler sayfaya HTML olarak da basıldığı için etiket/öznitelik açabilecek karakterler ayıklanır:
   yönetici hesabı ele geçirilse bile mağazaya (ödeme sayfası dahil) betik eklenemesin. */
/* Son görülen değerler tarayıcıda önbelleklenir: sonraki açılışta katalog Firebase'i beklemeden
   güncel fiyatla çizilir (eski varsayılan fiyat bir an görünüp değişmesin). Önbellek de aynı
   temizlemeden geçer; yalnızca gösterim içindir. İlk ziyarette fiyat yüklenene dek `overridesReady` false. */
const CACHE_KEY = 'engrare_urun_katalog2';
export let overridesReady = false;
export function markOverridesReady() { overridesReady = true; }
// { t: yazılma zamanı, d: Firebase config/products }: statik dosya (fiyat.js) daha yeniyse önbellek ona ezdirilmez
export function cacheOverrides(overrides) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: overrides })); } catch (e) { /* özel mod / kota */ }
}

// Panelden yüklenen/seçilen ürün görselleri (config/products/<id>/images, card): yalnızca bu biçimde yol kabul edilir
const IMG_PATH_RE = /^content\/(panel|products)\/\d+\/[A-Za-z0-9._-]+\.webp$/;

const plainText = (s) => s.trim().replace(/[<>]/g, '').replace(/"/g, '”').replace(/'/g, '’');

/* ---- Panelden tasarlanan ürünler (admin/tasarim.js) ----------------------------------------------
   config/products/<id>/design (RTDB + fiyat.js). Panel yalnızca bu alanları yazar; burada her değer yeniden
   doğrulanıp temizlenir (yönetici hesabı ele geçirilse bile mağazaya betik ya da dış adres sızmasın).
   Sunucu (functions/index.js > designNormalize) aynı kuralları uygular: ikisini birlikte tut.
   Biçim (v2):
     alan      { yazi, logo, sosyal }  açık/kapalı: müşteriden yazı / logo / sosyal medya QR istenir mi
     sira      müşteriye sorulma sırası: secenek, yazi, logo, sosyal, renk, miktar (hepsi bir kez)
     etiket    { secenek, logo, sosyal, renk, miktar }  alan başlıkları (boşsa varsayılan)
     variants  seçenekler (en az 1, en çok 4; 1 tane ise müşteriye seçici gösterilmez). Her biri: name, preview
               (önizleme görseli), mask (isteğe bağlı hazır maske), textArea / logoArea ([x, y, genişlik, yükseklik],
               görselin %'si), slots (logo1, qr1, logo2, qr2 dörtgenleri: [solÜst, sağÜst, solAlt, sağAlt] köşeleri)
     colors    [{ c1 yazı, c2 zemin, name }] en çok 12
     aktif     false = taslak (sitede yok, sunucu satmaz)
   Eski biçim (tip: yazi | yazi-logo | logo | sosyal) okunurken v2'ye çevrilir. Kimliği 10 ve üstü ürünler tamamen
   panelden gelir; 1-9 koddaki ürünlerdir (tasarım yoksa kodda kalır, varsa kodun yerine geçer).
   Yalnız `colors` taşıyan tasarım (variants yok) koddaki ürünün yalnız renklerini değiştirir. */
export const SIRA_VARSAYILAN = ['secenek', 'yazi', 'logo', 'sosyal', 'renk', 'miktar'];
const ETIKET_ANAHTAR = ['secenek', 'logo', 'sosyal', 'renk', 'renkAd', 'miktar'];
const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// RTDB dizileri düzgünse dizi, değilse sayı anahtarlı nesne döner
const asList = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]) : []);
const pct = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) * 10) / 10));
function cleanRect(v) {
    const a = asList(v).map(Number);
    if (a.length !== 4 || a.some(n => !Number.isFinite(n))) return null;
    return [pct(a[0], 0, 100), pct(a[1], 0, 100), pct(a[2], 1, 100), pct(a[3], 1, 100)];
}
function cleanQuad(v) {
    const pts = asList(v).map(p => asList(p).map(Number));
    if (pts.length !== 4 || pts.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n)))) return null;
    return pts.map(p => [pct(p[0], 0, 100), pct(p[1], 0, 100)]);
}
const cleanName = (v, max) => (typeof v === 'string' ? plainText(v).slice(0, max) : '');
const okPath = (v) => typeof v === 'string' && IMG_PATH_RE.test(v);

/* Eski (tip'li) tasarımı v2'ye çevirir */
function migrateDesign(d) {
    if (!d || typeof d !== 'object' || !d.tip || d.variants && d.alan) return d;
    const sos = d.tip === 'sosyal';
    const out = {
        aktif: d.aktif, colors: d.colors,
        alan: { yazi: d.tip === 'yazi' || d.tip === 'yazi-logo', logo: d.tip === 'yazi-logo' || d.tip === 'logo' || (sos && d.allowLogo === true), sosyal: sos },
        variants: sos ? asList(d.variants) : [{ name: 'Standart', preview: d.preview, textArea: d.textArea, logoArea: d.logoArea }]
    };
    if (d.fixedTextSize) out.fixedTextSize = d.fixedTextSize;
    return out;
}

export function cleanDesign(d0) {
    const d = migrateDesign(d0);
    if (!d || typeof d !== 'object') return null;
    const out = {};
    const colors = asList(d.colors)
        .filter(c => c && HEX_RE.test(c.c1) && HEX_RE.test(c.c2))
        .slice(0, 12)
        .map(c => ({ c1: c.c1.toUpperCase(), c2: c.c2.toUpperCase(), ...(cleanName(c.name, 40) ? { name: cleanName(c.name, 40) } : {}) }));
    if (colors.length) out.colors = colors;
    if (!d.variants) return Object.keys(out).length ? out : null;

    const al = d.alan && typeof d.alan === 'object' ? d.alan : {};
    out.v = 2;
    out.aktif = d.aktif === true;          // taslak (gizli) varsayılan: yayına almak açık bir karardır
    out.alan = { yazi: al.yazi === true, logo: al.logo === true, sosyal: al.sosyal === true };
    // Sıra: geçerli, tekrarsız adlar; eksikler varsayılan sırayla sona eklenir
    const sira = asList(d.sira).filter((k, i, a) => SIRA_VARSAYILAN.includes(k) && a.indexOf(k) === i);
    out.sira = [...sira, ...SIRA_VARSAYILAN.filter(k => !sira.includes(k))];
    const et = d.etiket && typeof d.etiket === 'object' ? d.etiket : {};
    out.etiket = {};
    for (const k of ETIKET_ANAHTAR) { const t = cleanName(et[k], 40); if (t) out.etiket[k] = t; }
    const fs = Number(d.fixedTextSize);
    if (Number.isFinite(fs) && fs >= 10 && fs <= 200) out.fixedTextSize = Math.round(fs);

    const seen = new Set();
    out.variants = asList(d.variants).slice(0, 4).map(v => {
        if (!v || typeof v !== 'object') return null;
        const name = cleanName(v.name, 60);
        if (!name || seen.has(name) || !okPath(v.preview)) return null;
        seen.add(name);
        const o = { name, preview: v.preview };
        if (okPath(v.mask)) o.mask = v.mask;
        const ta = cleanRect(v.textArea); if (ta) o.textArea = ta;
        const la = cleanRect(v.logoArea); if (la) o.logoArea = la;
        const sl = v.slots && typeof v.slots === 'object' ? v.slots : {};
        const slots = {};
        for (const k of ['logo1', 'qr1', 'logo2', 'qr2']) { const q = cleanQuad(sl[k]); if (q) slots[k] = q; }
        if (!(slots.logo2 && slots.qr2)) { delete slots.logo2; delete slots.qr2; }   // ikinci çift ya tam ya hiç
        if (!(slots.logo1 && slots.qr1)) { delete slots.logo1; delete slots.qr1; delete slots.logo2; delete slots.qr2; }
        if (Object.keys(slots).length) o.slots = slots;
        return o;
    }).filter(Boolean);
    // Bir seçenek bile geçersizse tasarım kullanılmaz (sunucu da böyle: yarım ürün sunulmaz)
    if (out.variants.length !== Math.min(asList(d.variants).length, 4)) out.variants = [];
    return out;
}

/* Tasarım ürün olarak kullanılabilir mi: her seçenekte açık alanların yerleşimi tamam mı */
export function designUsable(d) {
    if (!d || !d.variants || !d.variants.length || !d.alan) return false;
    return d.variants.every(v => (!d.alan.yazi || v.textArea) && (!d.alan.logo || v.logoArea) && (!d.alan.sosyal || (v.slots && v.slots.logo1 && v.slots.qr1)));
}

const cssArea = (r) => r ? { top: r[1] + '%', left: r[0] + '%', width: r[2] + '%', height: r[3] + '%' } : null;
export function parseColorLabels(v) {
    const raw = cleanName(v, 40);
    if (!raw) return { label1: 'Yazı', label2: 'Zemin' };
    const idx = raw.indexOf('/');
    if (idx === -1) return { label1: raw, label2: 'Zemin' };
    return { label1: raw.slice(0, idx).trim() || 'Yazı', label2: raw.slice(idx + 1).trim() || 'Zemin' };
}
const designColors = (d) => {
    const base = d && d.colors ? d.colors.map(c => ({ color1: c.c1, color2: c.c2, ...(c.name ? { name: c.name } : {}) })) : COLOR_COMBINATIONS;
    const { label1, label2 } = parseColorLabels(d && d.etiket && d.etiket.renkAd);
    return base.map(c => ({ ...c, label1, label2 }));
};
const src = (p) => './' + p;

let baseDefs = null;   // koddaki ürünler (tasarımla değiştirilince geri dönmek için asıl nesneler)

/* Temizlenmiş v2 tasarımdan ürün nesnesi (products dizisindekiyle aynı biçim). Koddaki ürünün yerine geçerken
   ad/açıklama/fiyat/görsel/metin varsayılanları koddan kalır, yerleşim alanları tasarımdan gelir.
   ?v= yok: dosya adı her yüklemede yenidir. */
export function designToProduct(id, d, base) {
    const p = base ? { ...base } : { id, name: 'Ürün ' + id, desc: '', price: 0, isDashedLine: false };
    for (const k of ['preview', 'previewTextArea', 'previewLogoArea', 'isCustomObject', 'isCustomText', 'allowLogo', 'fixedTextSize', 'disableTextInput']) delete p[k];
    const V = d.variants;
    p.designed = true;
    p.dynamic = !base;
    p.colors = designColors(d);
    p.allowLogo = d.alan.logo;
    p.allowText = d.alan.yazi;
    p.noText = !d.alan.yazi;
    p.sira = d.sira;
    p.etiket = d.etiket;
    if (d.fixedTextSize) p.fixedTextSize = d.fixedTextSize;
    if (!base) { p.card = src(V[0].preview); p.images = [{ src: p.card }]; }
    // Tek seçenekli, sosyal medyasız ürün: alanlar ürünün kendisinde. Aksi halde seçenek listesi (stand biçimi).
    if (V.length === 1 && !d.alan.sosyal) {
        p.preview = { src: src(V[0].preview), mask: V[0].mask ? src(V[0].mask) : null };
        if (V[0].textArea) p.previewTextArea = cssArea(V[0].textArea);
        if (V[0].logoArea) p.previewLogoArea = cssArea(V[0].logoArea);
        return p;
    }
    p.isCustomObject = V.map(v => {
        const o = { objectName: v.name, src: src(v.preview) };
        if (v.mask) o.mask = src(v.mask);
        if (d.alan.yazi && v.textArea) o.previewTextArea = cssArea(v.textArea);
        if (d.alan.logo && v.logoArea) o.previewLogoArea = cssArea(v.logoArea);
        if (d.alan.sosyal && v.slots) {
            o.previewSocialLogo1 = v.slots.logo1; o.previewSocialQR1 = v.slots.qr1;
            if (v.slots.logo2) { o.previewSocialLogo2 = v.slots.logo2; o.previewSocialQR2 = v.slots.qr2; }
        }
        return o;
    });
    return p;
}

/* Panelden tasarlanan ürünleri kataloğa ekler/günceller, kalkanları çıkarır; koddaki ürünün tasarımı varsa onun
   yerine geçer, yoksa (ya da silindiyse) asıl nesne geri gelir. Her kaynak (fiyat.js, önbellek, Firebase) tam
   kümedir; bu yüzden listede olmayan panel ürünü silinir. Fiyatı olmayan panel ürünü gösterilmez. */
function syncDesigned(overrides) {
    if (!baseDefs) baseDefs = new Map(products.map(p => [p.id, p]));
    const wanted = new Set();
    const put = (id, p) => { const i = products.findIndex(x => x.id === id); if (i >= 0) products[i] = p; else products.push(p); };
    for (const [key, o] of Object.entries(overrides)) {
        const id = Number(key);
        if (!Number.isInteger(id) || !o || typeof o !== 'object') continue;
        const d = cleanDesign(o.design);
        const full = d && d.variants && designUsable(d);
        const base = baseDefs.get(id);
        // Panelden "satıştan kaldırıldı" (satisDisi): ürün listeden, sepetten ve ödemeden düşer (sunucu da satmaz)
        if (o.satisDisi === true) { const i = products.findIndex(x => x.id === id); if (i >= 0) products.splice(i, 1); continue; }
        if (base) { put(id, full ? designToProduct(id, d, base) : base); continue; }
        if (id < 10 || !full || !d.aktif || !(Number(o.price) > 0)) continue;
        wanted.add(id);
        put(id, designToProduct(id, d, null));
    }
    for (const [id, base] of baseDefs) {
        const o = overrides[id];
        if (!o || typeof o !== 'object') put(id, base);
    }
    // Panelden verilen sıra (config/products/<id>/sira): sırası olmayan ürün sona, kimliğe göre dizilir
    const sirasi = (p) => { const n = Number(((overrides[p.id] || {}).sira)); return Number.isFinite(n) ? n : 1000 + p.id; };
    products.sort((a, b) => sirasi(a) - sirasi(b));
    for (let i = products.length - 1; i >= 0; i--) {
        if (products[i].dynamic && !wanted.has(products[i].id)) products.splice(i, 1);
    }
}

export function applyProductOverrides(overrides) {
    if (!overrides || typeof overrides !== 'object') return;
    syncDesigned(overrides);
    for (const p of products) {
        const o = overrides[p.id];
        if (!o || typeof o !== 'object') continue;
        for (const key of ['name', 'desc', 'customTextLabel', 'customTextPlaceholder', 'customTextPlaceholderPreview']) {
            const v = typeof o[key] === 'string' ? plainText(o[key]) : '';
            if (v) p[key] = v;
        }
        const price = Number(o.price);
        if (Number.isFinite(price) && price >= 0) p.price = price;
        // Üstü çizili eski fiyat (panelde indirim çarpanı): yalnızca güncel fiyattan büyükse gösterilir
        const old = Number(o.oldPrice);
        if (Number.isFinite(old) && old > p.price) p.oldPrice = old; else delete p.oldPrice;
        // Görseller: geçerli yol yoksa koddaki varsayılanlar kalır
        const imgs = (Array.isArray(o.images) ? o.images : []).filter(x => typeof x === 'string' && IMG_PATH_RE.test(x));
        if (imgs.length) p.images = imgs.map(x => ({ src: './' + x }));
        if (typeof o.card === 'string' && IMG_PATH_RE.test(o.card)) p.card = './' + o.card;
        // Yalnız renk değiştiren tasarım (koddaki ürün): yoksa ortak liste
        if (!p.designed) {
            const d = cleanDesign(o.design);
            p.colors = d && (d.colors || (d.etiket && d.etiket.renkAd)) ? designColors(d) : COLOR_COMBINATIONS;
        }
    }
}

// Yazı / zemin renk kombinasyonları (çapraz ikiye bölünmüş seçim balonları).
// Sunucu (functions/index.js > COLOR_COMBINATIONS) yalnızca bu çiftleri kabul eder.
export const COLOR_COMBINATIONS = [
    { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
    { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
    { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
    { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
];

// --- BASİTLEŞTİRİLMİŞ ÜRÜN DATASI ---
export const products = [
	{
        id: 3,
        name: "Sosyal Medya & Kartvizit Standı",
        desc: "Sosyal medya linkli profesyonel kartvizitlik.",
        price: 489,
        allowLogo: true,
        isDashedLine: false,
		/*  KÖŞE MATRİSİ — her alan 4 köşe, görseldeki yerleşimin aynısı.
		    Değerler önizleme kutusunun yüzdesi: [x, y]

		        ┌ sol üst     sağ üst ┐
		        └ sol alt     sağ alt ┘

		    Yukarı/aşağı kaydırmak: y değerlerini, sağa/sola: x değerlerini değiştirin.
		    Eğim vermek için tek bir köşeyi oynatmak yeterli.                        */
		isCustomObject: [
            {
                objectName: "1 Kartvizit Bölmeli",
                src: "./content/products/5/preview-1-bolme-taban.webp?v=1",
                mask: "./content/products/5/preview-1-bolme-maske.webp?v=1",
                previewLogoArea: { top: "19%", left: "47.8%", width: "30%", height: "21%" },
                previewSocialLogo1: [ /*┌*/ [16.9, 65.7], [25.3, 65.6], /*┐*/
                                      /*└*/ [16.6, 75.1], [25.3, 75.2]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [12.7, 78.4], [28.0, 78.4], /*┐*/
                                      /*└*/ [10.7, 92.2], [26.3, 92.3]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [32.2, 65.6], [41.0, 65.5], /*┐*/
                                      /*└*/ [32.2, 75.1], [41.0, 75.1]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [29.8, 78.4], [44.7, 78.4], /*┐*/
                                      /*└*/ [28.4, 92.2], [44.1, 92.5]  /*┘*/ ]
            },
            {
                objectName: "2 Kartvizit Bölmeli",
                src: "./content/products/5/preview-2-bolme-taban.webp?v=1",
                mask: "./content/products/5/preview-2-bolme-maske.webp?v=1",
                previewLogoArea: { top: "13%", left: "46%", width: "47%", height: "22%" },
                previewSocialLogo1: [ /*┌*/ [10.8, 62.5], [21.2, 62.5], /*┐*/
                                      /*└*/ [10.7, 73.4], [20.9, 73.8]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [ 5.8, 77.2], [25.1, 77.2], /*┐*/
                                      /*└*/ [ 2.8, 93.1], [23.0, 93.1]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [31.0, 62.5], [41.4, 62.5], /*┐*/
                                      /*└*/ [31.0, 73.4], [41.3, 73.4]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [27.5, 77.2], [46.5, 77.2], /*┐*/
                                      /*└*/ [25.7, 93.1], [45.7, 93.1]  /*┘*/ ]
            },
            {
                objectName: "3 Kartvizit Bölmeli",
                src: "./content/products/5/preview-3-bolme-taban.webp?v=1",
                mask: "./content/products/5/preview-3-bolme-maske.webp?v=1",
                previewLogoArea: { top: "15%", left: "49%", width: "40%", height: "25.5%" },
                previewSocialLogo1: [ /*┌*/ [13.1, 68.1], [21.1, 68.0], /*┐*/
                                      /*└*/ [12.7, 77.0], [21.1, 77.0]  /*┘*/ ],
                previewSocialQR1:   [ /*┌*/ [10.7, 78.4], [23.5, 78.4], /*┐*/
                                      /*└*/ [6.60, 92.1], [20.5, 92.4]  /*┘*/ ],
                previewSocialLogo2: [ /*┌*/ [28.5, 68.3], [37.2, 68.2], /*┐*/
                                      /*└*/ [28.5, 77.0], [37.2, 77.0]  /*┘*/ ],
                previewSocialQR2:   [ /*┌*/ [26.1, 78.4], [38.7, 79.3], /*┐*/
                                      /*└*/ [23.2, 91.7], [37.3, 91.4]  /*┘*/ ]
            }
        ],
        colors: COLOR_COMBINATIONS,
        card: "./content/products/5/kart.webp?v=1",   // liste kartı için küçük kopya (800x540)
        images: [
            { src: "./content/products/5/1.webp?v=1" },
            { src: "./content/products/5/2.webp?v=1" },
            { src: "./content/products/5/3.webp?v=1" },
            { src: "./content/products/5/4.webp?v=1" }
        ]
    },
    {
        id: 1,
        name: "Araba İçi Numaratör",
        desc: "Basarak aç kapa yapılabilen elegant numaratör.",
		customTextLabel: "araç içinde görünecek telefon numaranızı giriniz.",
		customTextPlaceholder: "Örn: 0541 555 55 55",
		customTextPlaceholderPreview: "0541 555 55 55",
		fixedTextSize: 48,
        price: 289,
        isDashedLine: false,
        card: "./content/products/1/kart.webp?v=1",   // liste kartı için küçük kopya (800x540)
        images: [
            { src: "./content/products/1/3.webp?v=1" },
            { src: "./content/products/1/2.webp?v=1" },
            { src: "./content/products/1/1.webp?v=1" },
            { src: "./content/products/1/4.webp?v=1" }
        ],
        preview: { src: "./content/products/1/preview-taban.webp?v=1", mask: "./content/products/1/preview-maske.webp?v=1" },
        previewTextArea: { top: '33.0%', left: '13%', width: '74.2%', height: '16.6%' },
        colors: COLOR_COMBINATIONS,
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 389,
        allowLogo: true,
        isDashedLine: false,
        card: "./content/products/2/kart.webp?v=1",   // liste kartı için küçük kopya (800x540)
        images: [
            { src: "./content/products/2/1.webp?v=1" },
            { src: "./content/products/2/2.webp?v=1" },
            { src: "./content/products/2/3.webp?v=1" },
            { src: "./content/products/2/4.webp?v=1" }
        ],
        preview: { src: "./content/products/2/preview-taban.webp?v=1", mask: "./content/products/2/preview-maske.webp?v=1" },
        previewLogoArea: { top: '20.6%', left: '22.3%', width: '54.8%', height: '30.0%' },
        previewTextArea: { top: '49.2%', left: '22.3%', width: '54.8%', height: '30.8%' },
        colors: COLOR_COMBINATIONS,
    },
    {
        // Fotoğraftan 3B büst: 2B önizleme yok, yerine fotoğraf yükle -> Oluştur -> döndürülebilir 3B önizleme (portre.js).
        // Sunucu karşılığı: functions/index.js PRODUCT_CATALOG[4] (portre: true; seçenek adları ve renkler birlikte tutulur).
        id: 4,
        name: "Kişiye Özel 3D Portre Büst",
        desc: "Fotoğrafınızdan kaideli, stilize 3D baskı büst. Önizlemesini siz görün, beğenirseniz üretelim.",
        price: 599,
        portre: true,
        isCustomText: false,
        isDashedLine: false,
        card: "./content/products/4/kart.webp?v=1",
        images: [
            { src: "./content/products/4/1.webp?v=1" },
            { src: "./content/products/4/2.webp?v=1" }
        ],
        colors: [
            { color1: "#EDE8DF", color2: "#EDE8DF", label1: "Kil Beyazı", name: "Kil Beyazı" },
            { color1: "#9AA0A6", color2: "#9AA0A6", label1: "Gri", name: "Gri" },
            { color1: "#C0714F", color2: "#C0714F", label1: "Terrakota", name: "Terrakota" },
            { color1: "#2B2B2B", color2: "#2B2B2B", label1: "Siyah", name: "Siyah" }
        ]
    },
    {
        // Yapay zekâ ile renkli 3D figür: tarif yaz (ya da görsel yükle) -> yapay zekâ figürü tasarlar -> renkli 3B önizleme (figur.js). Renkler filament paletine
        // (en çok 4) indirgenmiştir, önizleme basılacak renkleri gösterir. Sunucu karşılığı: functions/index.js PRODUCT_CATALOG[5] (portre: true: iş doğrulaması).
        id: 5,
        name: "Yapay Zekâ ile Renkli 3D Figür",
        desc: "Hayalindeki karakteri anlat, yapay zekâ tasarlasın: renkli, kaideli 3D baskı figürün önizlemesini gör, beğenirsen üretelim.",
        price: 699,
        figur: true,
        isCustomText: false,
        isDashedLine: false,
        // Görseller gerçek 3B önizleme çizimleridir (basılacak 4 renk; figur.js ORNEKLER ile aynı işler), yapay zekânın 2B çizimi değil: o çok renkli/geçişliydi, basılan ürünü yanlış gösteriyordu
        card: "./content/products/figur/kart.webp?v=2",
        images: [
            { src: "./content/products/figur/1.webp?v=2" },
            { src: "./content/products/figur/2.webp?v=2" },
            { src: "./content/products/figur/3.webp?v=2" },
            { src: "./content/products/figur/4.webp?v=2" },
            { src: "./content/products/figur/5.webp?v=2" }
        ],
        colors: [
            { color1: "#FFFFFF", color2: "#FFFFFF", label1: "Renkli", name: "Renkli (yapay zekâ paleti)" }
        ]
    }/*,
    {
        id: 3,
        name: "Araba Plaka Çerçevesi",
        desc: "Plakanızın dışına yüksek kalite ile basılmış logo ve yazı ekleyebildiğiniz çerçevenizi tasarlayın.",
        price: 180,
        images: [
            { src: "./content/products/3/1.jpg" },
            { src: "./content/products/3/2.jpg" },
            { src: "./content/products/3/3.jpg" },
            { src: "./content/products/3/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 4,
        name: "Masaüstü USB'li fan",
        desc: "Renklerini seçebildiğiniz size özel fan.",
        price: 180,
        images: [
            { src: "./content/products/4/1.jpg" },
            { src: "./content/products/4/2.jpg" },
            { src: "./content/products/4/3.jpg" },
            { src: "./content/products/4/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    },
    {
        id: 6,
        name: "Özet Tasarım Anahtarlık",
        desc: "Üzerine isim yazdırılabilen dekoratif anahtarlık.",
		isCustomText: false,
		CustomColorText1: "Üst Renk",   // Renk seçici 1'in etiketi
		CustomColorText2: "Alt Renk",    // Renk seçici 2'nin etiketi
        price: 180,
        images: [
            { src: "./content/products/6/1.jpg" },
            { src: "./content/products/6/2.jpg" },
            { src: "./content/products/6/3.jpg" },
            { src: "./content/products/6/4.jpg" }
        ],
        previewTextArea: { top: '15%', left: '10%', width: '80%', height: '70%' },
        previewLogoArea: { top: '15%', left: '10%', width: '80%', height: '70%' }
    }*/
];

// Önce site kökündeki statik fiyat dosyası (fiyat.js, panel yazar) uygulanır: ilk ziyarette de Firebase'i beklemeden
// fiyat ve panelden tasarlanan ürünler hazır. Önbellek (son Firebase değerleri) yalnızca dosyadan YENİ ise uygulanır
// (dosyanın yazıldığı an window.ENGRARE_FIYAT_T): eski önbellek taze dosyayı ezmesin. Dosya yoksa/bozuksa yok sayılır;
// Firebase yüklenince zaten üzerine yazar. Admin paneli koddaki varsayılanları taban olarak kullandığı için orada uygulanmaz.
// `gizli` ürün (yayında olmayan): site sahibi işaretli tarayıcıda (?ben=1 -> localStorage engrare_kendim) ve admin panelinde kalır, ziyaretçide listeden
// düşer; liste, ürün sayfası, sepet, çapraz satış ve ödeme sayfası bu diziyi kullandığından hiçbir yerde görünmez. Node'da (check-sync, sayfa üretimi) süzülmez.
if (typeof location !== 'undefined' && !location.pathname.includes('/admin')) {
    let sahip = false;
    try { sahip = localStorage.getItem('engrare_kendim') === '1'; } catch (e) { /* özel mod: ziyaretçi sayılır */ }
    if (!sahip) for (let i = products.length - 1; i >= 0; i--) if (products[i].gizli) products.splice(i, 1);
}
if (typeof location !== 'undefined' && !location.pathname.includes('/admin')) {
    try {
        if (window.ENGRARE_FIYAT) { applyProductOverrides(window.ENGRARE_FIYAT); overridesReady = true; }
    } catch (e) { /* bozuk dosya yok sayılır */ }
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
        if (cached && cached.d && !(window.ENGRARE_FIYAT_T > cached.t)) { applyProductOverrides(cached.d); overridesReady = true; }
    } catch (e) { /* bozuk önbellek yok sayılır */ }
}
