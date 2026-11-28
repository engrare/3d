/* Güncel fiyat dosyası (site kökünde fiyat.js): Ürünler kaydedilince ya da görseller değişince panel,
   RTDB config/products değerlerini GitHub API ile doğrudan herkese açık `engrare/3d` reposuna yazar.
   Site bu dosyayı açılışta senkron okur (index.html), böylece ilk ziyarette bile fiyat Firebase'i
   beklemeden görünür; Firebase yine esastır ve yüklenince üzerine yazar. Dosya yalnızca gösterim içindir:
   tahsil edilen tutarı her zaman sunucu hesaplar. Anahtar görsel penceresindekiyle aynıdır
   (RTDB config/github_upload/token). deploy.sh/.cmd yayından önce bu dosyayı GitHub'dan yerele çeker. */

import { cleanDesign, designUsable } from '../products.js?v=24';

const REPO = 'engrare/3d';
const BRANCH = 'main';
const PATH = 'fiyat.js';

// Sitenin applyProductOverrides ile okuduğu alanlar (başkası dosyaya girmez)
const TEXT_KEYS = ['name', 'desc', 'customTextLabel', 'customTextPlaceholder', 'customTextPlaceholderPreview'];

export function buildFile(overrides) {
    const out = {};
    for (const id of Object.keys(overrides || {}).sort((a, b) => Number(a) - Number(b))) {
        const o = overrides[id];
        if (!o || typeof o !== 'object') continue;
        const p = {};
        // Satıştan kaldırılan panel ürünü dosyaya girmez; koddaki ürün işaretle girer (site koddakini listeden düşürsün)
        if (o.satisDisi === true && Number(id) >= 10) continue;
        if (o.satisDisi === true) p.satisDisi = true;
        if (Number.isFinite(Number(o.sira))) p.sira = Number(o.sira);
        // Panelden tasarlanan ürün (kimlik >= 10): taslak ya da eksikse dosyaya hiç girmez. Koddaki üründe tam tasarım
        // yalnız kullanılabilirse (yoksa site zaten koddakini kullanır) girer; yalnız renk tasarımı her zaman girer
        const design = cleanDesign(o.design);
        const full = !!(design && design.variants);
        if (Number(id) >= 10 && !(full && design.aktif && designUsable(design))) continue;
        if (design && (!full || designUsable(design))) p.design = design;
        for (const k of TEXT_KEYS) if (typeof o[k] === 'string' && o[k].trim()) p[k] = o[k];
        if (Number.isFinite(Number(o.price)) && Number(o.price) >= 0) p.price = Number(o.price);
        if (Number.isFinite(Number(o.oldPrice)) && Number(o.oldPrice) > 0) p.oldPrice = Number(o.oldPrice);
        if (Array.isArray(o.images)) p.images = o.images.filter(x => typeof x === 'string');
        if (typeof o.card === 'string' && o.card) p.card = o.card;
        out[id] = p;
    }
    return '/* Admin panelinden otomatik yazılır (Ürünler > Kaydet); elle düzenleme. Yalnızca gösterim içindir. */\n'
        + 'window.ENGRARE_FIYAT=' + JSON.stringify(out) + ';\n';
}

/* Yazıldığı an (products.js bunu tarayıcı önbelleğiyle karşılaştırır). İçerik karşılaştırmasına girmez */
const STAMP = /window\.ENGRARE_FIYAT_T=\d+;\n?$/;

async function gh(method, path, token, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
        method,
        cache: 'no-store', /* GitHub GET yanıtları tarayıcıda 60 sn önbelleklenir: eski sha ile yazım "does not match" verirdi */
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* gövde yok */ }
    if (!res.ok) {
        const err = new Error((data && data.message) || `GitHub ${res.status}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

const toBase64 = (text) => {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
};
const fromBase64 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

/* Yazımlar sırayla yapılır: sıra düğmeleri/Kaydet/görsel değişimi aynı anda çağırınca sha çakışırdı */
let kuyruk = Promise.resolve();
export function publish(token, overrides) {
    const is = kuyruk.then(() => publishNow(token, overrides));
    kuyruk = is.catch(() => {});
    return is;
}

/* 'yazildi' ya da (içerik zaten aynıysa) 'ayni' döner; hata fırlatır */
async function publishNow(token, overrides) {
    const content = buildFile(overrides);
    for (let deneme = 0; ; deneme++) {
        let sha;
        try {
            const info = await gh('GET', `contents/${PATH}?ref=${BRANCH}`, token);
            sha = info.sha;
            if (info.content && fromBase64(info.content).replace(STAMP, '') === content) return 'ayni';
        } catch (e) {
            if (e.status !== 404) throw e;
        }
        try {
            await gh('PUT', `contents/${PATH}`, token, {
                message: 'Panel: güncel fiyat dosyası', content: toBase64(content + 'window.ENGRARE_FIYAT_T=' + Date.now() + ';\n'), branch: BRANCH, ...(sha ? { sha } : {})
            });
            return 'yazildi';
        } catch (e) {
            // Eşzamanlı yazım (sha eskidi): bir kez daha dene
            if ((e.status === 409 || e.status === 422) && deneme < 2) continue;
            throw e;
        }
    }
}
