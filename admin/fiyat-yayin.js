/* Güncel fiyat dosyası (site kökünde fiyat.js): Ürünler kaydedilince ya da görseller değişince panel,
   RTDB config/products değerlerini GitHub API ile doğrudan herkese açık `engrare/3d` reposuna yazar.
   Site bu dosyayı açılışta senkron okur (index.html), böylece ilk ziyarette bile fiyat Firebase'i
   beklemeden görünür; Firebase yine esastır ve yüklenince üzerine yazar. Dosya yalnızca gösterim içindir:
   tahsil edilen tutarı her zaman sunucu hesaplar. Anahtar görsel penceresindekiyle aynıdır
   (RTDB config/github_upload/token). deploy.sh/.cmd yayından önce bu dosyayı GitHub'dan yerele çeker. */

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

async function gh(method, path, token, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
        method,
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

/* 'yazildi' ya da (içerik zaten aynıysa) 'ayni' döner; hata fırlatır */
export async function publish(token, overrides) {
    const content = buildFile(overrides);
    for (let deneme = 0; ; deneme++) {
        let sha;
        try {
            const info = await gh('GET', `contents/${PATH}?ref=${BRANCH}`, token);
            sha = info.sha;
            if (info.content && fromBase64(info.content) === content) return 'ayni';
        } catch (e) {
            if (e.status !== 404) throw e;
        }
        try {
            await gh('PUT', `contents/${PATH}`, token, {
                message: 'Panel: güncel fiyat dosyası', content: toBase64(content), branch: BRANCH, ...(sha ? { sha } : {})
            });
            return 'yazildi';
        } catch (e) {
            // Eşzamanlı yazım (sha eskidi): bir kez daha dene
            if ((e.status === 409 || e.status === 422) && deneme < 1) continue;
            throw e;
        }
    }
}
