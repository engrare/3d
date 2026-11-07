/* Ürün tasarımcısı (yalnız "Yeni Ürün Tasarla" / satırdaki "Tasarım" düğmesine basılınca import() ile yüklenir).
   Bir ürün "alanlar"dan kurulur: ürüne yazı, logo, sosyal medya QR ekle/kaldır, müşteriye sorulma SIRASINI belirle
   (▲▼), alan başlıklarını yaz, renk çiftlerini seç; her seçeneğin (görünümün) önizleme görselinde yerleşimi sürükle-bırak
   yapılır. Koddaki ürünler (1-3) de aynı pencereden tam düzenlenir: mevcut ayarları kodundan otomatik gelir ("Varsayılana
   dön" koda döndürür). Çıktı tek bir `design` nesnesidir (biçim ve doğrulama: products.js > cleanDesign):
     • RTDB config/products/<id>/design: sunucu fiyat, renk ve seçenekleri buradan doğrular,
     • siteye fiyat.js ile GitHub API üzerinden doğrudan gider (admin/fiyat-yayin.js): site Firebase'i beklemeden çizer.
   Görseller tarayıcıda WebP'ye çevrilip GitHub API ile `engrare/3d` reposunda content/panel/<ürünNo>/ altına yazılır
   (anahtar RTDB config/github_upload/token, görsel penceresiyle ortak). Yeni ürün TASLAK doğar (sitede görünmez);
   "Sitede yayında" işaretlenince satışa açılır. Yazı kutusu metinleri (başlık/örnek) ürünün eski alanlarına yazılır.
   Önizleme görseli kuralı (preview-engine.js): görseldeki koyu (siyah) pikseller yazı rengine boyanır, kalanı olduğu
   gibi kalır, kutunun arkası zemin rengidir; bu pencere önizlemeyi sitedekiyle aynı motorla çizer. */

import { paintPreview, clearPreview } from '../preview-engine.js?v=111';
import { cleanDesign, designUsable, SIRA_VARSAYILAN } from '../products.js?v=20';

const REPO = 'engrare/3d';
const BRANCH = 'main';
const SITE = 'https://engrare.com';
const PANEL_DIR = 'content/panel/';

// Alan kartları: başlık, simge, açıklama; `ac` = ürüne eklenip kaldırılabilir (yazı/logo/sosyal), diğerleri hep vardır
const ALAN = {
    secenek: { ad: 'Seçenekler', icon: 'fa-layer-group', not: 'Birden çok görünüm/model sunmak için seçenek ekleyin (her birinin kendi görseli ve yerleşimi olur). Tek seçenek varsa müşteriye seçici gösterilmez.' },
    yazi:    { ad: 'Yazı', icon: 'fa-font', ac: true, not: 'Müşteri ürüne yazılacak metni girer.' },
    logo:    { ad: 'Logo', icon: 'fa-image', ac: true, not: 'Müşteri hazır logolardan seçer ya da kendi logosunu yükler.' },
    sosyal:  { ad: 'Sosyal medya QR', icon: 'fa-qrcode', ac: true, not: 'Müşteri 1-2 sosyal medya hesabı girer; simge + QR kodu ürüne basılır.' },
    renk:    { ad: 'Renk', icon: 'fa-palette', not: 'Müşterinin seçebileceği yazı / zemin renk çiftleri (en çok 12). Sunucu yalnızca bunları kabul eder.' },
    miktar:  { ad: 'Miktar', icon: 'fa-hashtag', not: 'Adet seçimi her üründe vardır; yalnızca sırası ve başlığı değişir.' }
};
const ETIKET_VARSAYILAN = { secenek: 'Seçenek', logo: 'Logo Seç Veya Yükle', sosyal: 'Sosyal Medya QR', renk: 'Renk Seçimi', miktar: 'Miktar' };
const SLOT_ADI = {
    text: 'Yazı alanı', logo: 'Müşteri logosu',
    logo1: 'Simge (sol)', qr1: 'QR (sol)', logo2: 'Simge (sağ)', qr2: 'QR (sağ)'
};
const SLOT_RENK = { text: '#3B82F6', logo: '#10B981', logo1: '#F59E0B', qr1: '#EF4444', logo2: '#F59E0B', qr2: '#EF4444' };
const MAX_VARIANTS = 4;

const $ = (sel) => document.querySelector(sel);
const clone = (v) => JSON.parse(JSON.stringify(v));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const r1 = (v) => Math.round(v * 10) / 10;

/* ---- GitHub (gorsel.js ile aynı yöntem) ---- */
async function gh(method, path, token, body) {
    const res = await fetch(`https://api.github.com/repos/${REPO}${path ? '/' + path : ''}`, {
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
function errText(e) {
    if (e && (e.status === 401 || e.status === 403)) return 'GitHub anahtarı geçersiz ya da yetkisiz (Contents: Read and write gerekir).';
    if (e && e.status === 404) return 'Depo bulunamadı ya da anahtarın bu depoya erişimi yok.';
    return (e && e.message) || 'bilinmeyen hata';
}
const toBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Dosya okunamadı.'));
    r.readAsDataURL(blob);
});
async function putFile(token, path, blob, message) {
    await gh('PUT', `contents/${path}`, token, { message, content: await toBase64(blob), branch: BRANCH });
}
async function waitLive(path, onTick) {
    const until = Date.now() + 5 * 60 * 1000;
    for (let n = 0; Date.now() < until; n++) {
        try {
            const r = await fetch(`${SITE}/${path}?k=${Date.now()}`, { cache: 'no-store' });
            if (r.ok) return true;
        } catch (e) { /* ağ hatası: tekrar dene */ }
        onTick(n);
        await new Promise(r => setTimeout(r, 5000));
    }
    return false;
}

/* Önizleme görseli: saydamlığı koruyan WebP (en uzun kenar 1280, kalite 0,92: koyu piksel eşiği bozulmasın) */
async function toWebp(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k));
    c.height = Math.max(1, Math.round(bmp.height * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((resolve, reject) => {
        c.toBlob((b) => (!b || b.type !== 'image/webp')
            ? reject(new Error('Tarayıcı WebP üretemedi (güncel Chrome/Safari kullanın).'))
            : resolve(b), 'image/webp', 0.92);
    });
}


/* ---- Varsayılan yerleşimler (görselin yüzdesi) ---- */
const defRect = (slot) => slot === 'text' ? [20, 35, 60, 22] : [35, 12, 30, 22];
const defQuad = (slot) => {
    const [x, y, w, h] = { qr1: [8, 58, 22, 28], logo1: [8, 40, 22, 14], qr2: [38, 58, 22, 28], logo2: [38, 40, 22, 14] }[slot];
    return [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
};
// Her seçenek tüm yerleşimler için varsayılan taşır (alan sonradan eklenince hazır olsun); kayıtta yalnız açık alanlar yazılır
const newVariant = (name) => ({
    name, preview: null, textArea: defRect('text'), logoArea: defRect('logo'),
    slots: { logo1: defQuad('logo1'), qr1: defQuad('qr1') }
});

/* Kod tabanlı ürünün (products.js) mevcut ayarlarını tasarım biçimine çevirir: "%19" -> 19 */
const cssRect = (a) => a ? [parseFloat(a.left), parseFloat(a.top), parseFloat(a.width), parseFloat(a.height)] : null;
const pathOf = (u) => u ? String(u).replace(/^\.\//, '').replace(/\?.*$/, '') : null;
function designFromProduct(p) {
    const multi = !!p.isCustomObject;
    const alan = { yazi: !multi && p.isCustomText !== false && !p.disableTextInput, logo: !!p.allowLogo, sosyal: !!(multi && p.isCustomObject[0].previewSocialLogo1) };
    const variants = multi
        ? p.isCustomObject.map(o => ({
            name: o.objectName, preview: pathOf(o.src), mask: pathOf(o.mask), logoArea: cssRect(o.previewLogoArea), textArea: cssRect(o.previewTextArea),
            slots: { logo1: o.previewSocialLogo1, qr1: o.previewSocialQR1, logo2: o.previewSocialLogo2, qr2: o.previewSocialQR2 }
        }))
        : [{ name: 'Standart', preview: pathOf(p.preview && p.preview.src), mask: pathOf(p.preview && p.preview.mask), textArea: cssRect(p.previewTextArea), logoArea: cssRect(p.previewLogoArea) }];
    return { v: 2, aktif: true, alan, variants, fixedTextSize: p.fixedTextSize };
}

export function open(ctx) {
    const root = $('#product-designer-modal');
    // Her açılışta yeni gövde: önceki açılıştan kalan olay dinleyicileri birikmesin
    const body = $('#tsn-body').cloneNode(false);
    $('#tsn-body').replaceWith(body);
    const esc = ctx.esc;
    const ex = ctx.existing;                         // null: yeni ürün
    const isNew = !ex;
    const isBase = !!(ex && ex.isBase);              // koddaki ürün: ad/fiyat satırda, tasarım isteğe bağlı
    const id = isNew ? ctx.nextId : ex.id;

    // Başlangıç tasarımı: kayıtlı (eski biçim de v2'ye çevrilir) > koddaki ürün > yeni ürün
    const saved = ex && ex.design ? cleanDesign(ex.design) : null;
    const hasFull = !!(saved && saved.variants && saved.variants.length);
    const src0 = hasFull ? saved : (isBase ? cleanDesign({ ...designFromProduct(ex.baseProduct), colors: saved && saved.colors }) || designFromProduct(ex.baseProduct) : null);
    const mkImg = (path, mask) => path ? { path, mask: mask || null } : null;
    const st = {
        name: ex ? ex.name : '', desc: ex ? (ex.desc || '') : '', hours: ex && ex.hours ? ex.hours : '',
        textLabel: ex ? (ex.customTextLabel || '') : '', textPlaceholder: ex ? (ex.customTextPlaceholder || '') : '',
        textPreview: ex ? (ex.customTextPlaceholderPreview || '') : '',
        fixedTextSize: src0 && src0.fixedTextSize ? String(src0.fixedTextSize) : '',
        aktif: isBase ? true : !!(saved && saved.aktif),
        alan: src0 ? { ...src0.alan } : { yazi: true, logo: false, sosyal: false },
        sira: src0 && src0.sira ? [...src0.sira] : [...SIRA_VARSAYILAN],
        etiket: src0 && src0.etiket ? { ...src0.etiket } : {},
        variants: src0 && src0.variants && src0.variants.length
            ? src0.variants.map(v => {
                const n = newVariant(v.name);
                n.preview = mkImg(v.preview, v.mask);
                if (v.textArea) n.textArea = v.textArea;
                if (v.logoArea) n.logoArea = v.logoArea;
                if (v.slots && v.slots.logo1 && v.slots.qr1) {
                    n.slots = { logo1: v.slots.logo1, qr1: v.slots.qr1 };
                    if (v.slots.logo2 && v.slots.qr2) { n.slots.logo2 = v.slots.logo2; n.slots.qr2 = v.slots.qr2; }
                }
                return n;
            })
            : [newVariant('Standart')],
        vi: 0,
        colors: saved && saved.colors ? clone(saved.colors) : ctx.baseColors.map(c => ({ ...c })),
        ci: 0,
        sel: null
    };
    let token = '';
    let busy = false;
    let drag = null;
    let aspect = 16 / 9;

    $('#tsn-title').textContent = isNew ? 'Yeni ürün tasarla' : `${ex.name} · Tasarım`;
    root.classList.add('open');

    const setStatus = (t, bad) => {
        const el = $('#tsn-status');
        if (!el) return;
        el.textContent = t || '';
        el.style.color = bad ? '#c0392b' : 'var(--text-muted)';
    };

    /* ---- Durum yardımcıları ---- */
    const curVariant = () => st.variants[st.vi] || st.variants[0];
    const imgUrl = (im) => im ? (im.url || `../${im.path}`) : '';
    const maskUrl = (im) => im && !im.blob && im.mask ? `../${im.mask}` : null;
    const slotList = () => {
        const v = curVariant(), l = [];
        if (st.alan.yazi) l.push('text');
        if (st.alan.logo) l.push('logo');
        if (st.alan.sosyal) { l.push('logo1', 'qr1'); if (v.slots.logo2) l.push('logo2', 'qr2'); }
        return l;
    };
    const isQuad = (slot) => /^(logo|qr)[12]$/.test(slot);
    const shapeOf = (slot) => slot === 'text' ? curVariant().textArea : slot === 'logo' ? curVariant().logoArea : curVariant().slots[slot];
    const setShape = (slot, val) => {
        const v = curVariant();
        if (slot === 'text') v.textArea = val; else if (slot === 'logo') v.logoArea = val; else v.slots[slot] = val;
    };
    const color = () => st.colors[st.ci] || st.colors[0] || { c1: '#FBC02D', c2: '#222222' };

    /* ---- Biçim ---- */
    function tokenBox() {
        return token
            ? `<p class="pimg-token ok"><i class="fa-solid fa-key"></i> GitHub anahtarı kayıtlı <button type="button" class="btn-link" data-act="token-change">değiştir</button></p>`
            : `<div class="pimg-token">
                   <p style="margin:0 0 8px;font-size:.84rem;color:var(--text-muted);">Görselleri ve siteye giden dosyayı GitHub'a yazmak için <b>yalnızca engrare/3d</b> deposuna <b>Contents: Read and write</b> yetkili anahtar gerekir (bir kez; görsel penceresiyle ortaktır).</p>
                   <div style="display:flex;gap:8px;flex-wrap:wrap;">
                       <input type="password" id="tsn-token-input" class="input-box" placeholder="github_pat_..." autocomplete="off" style="flex:1;min-width:200px;">
                       <button type="button" class="btn primary" data-act="token-save">Kaydet ve doğrula</button>
                   </div>
               </div>`;
    }

    function infoSection() {
        if (isBase) return `<p class="section-desc" style="margin:0 0 10px;">Ad, fiyat ve görseller ürün satırından düzenlenir. Burada ürünün müşteriye sorduğu her şey (alanlar, sıra, renkler, yerleşim) düzenlenir; mevcut ayarlar koddan otomatik geldi.</p>`;
        return `<div class="tsn-sec">
            <h4>1. Ürün bilgisi</h4>
            <div class="tsn-grid2">
                <label>Ürün adı<input type="text" class="input-box" data-f="name" maxlength="120" value="${esc(st.name)}" autocomplete="off"></label>
                ${isNew ? `<label>Üretim süresi (saat) <small>fiyat buradan hesaplanır</small><input type="number" class="input-box" data-f="hours" min="0.1" step="0.1" value="${esc(st.hours)}" placeholder="Örn: 3.5" inputmode="decimal"><span class="tsn-price" id="tsn-price"></span></label>` : ''}
            </div>
            <label style="display:block;margin-top:10px;">Açıklama<input type="text" class="input-box" data-f="desc" maxlength="200" value="${esc(st.desc)}" autocomplete="off" placeholder="Ürün listesinde görünen kısa açıklama"></label>
        </div>`;
    }

    /* "Alanlar ve sıra": her alan bir kart; ▲▼ müşteriye sorulma sırasını, düğme alanı ekler/kaldırır */
    function fieldCards() {
        const et = (k) => esc(st.etiket[k] || '');
        const ph = (k) => `placeholder="${esc(ETIKET_VARSAYILAN[k])}"`;
        const inner = {
            secenek: () => `
                <label>Seçici başlığı<input type="text" class="input-box" data-et="secenek" maxlength="40" value="${et('secenek')}" ${ph('secenek')}></label>
                <div class="tsn-vlist">${st.variants.map((v, i) => `
                    <div class="tsn-vrow"><input type="text" class="input-box" data-vname="${i}" maxlength="60" value="${esc(v.name)}" placeholder="Seçenek adı" autocomplete="off">
                    ${st.variants.length > 1 ? `<button type="button" class="tsn-x" data-act="var-del" data-i="${i}" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>` : ''}</div>`).join('')}</div>
                ${st.variants.length < MAX_VARIANTS ? '<button type="button" class="btn" data-act="var-add" style="margin-top:8px;"><i class="fa-solid fa-plus"></i> Seçenek ekle</button>' : ''}`,
            yazi: () => `
                <label>Yazı kutusunun başlığı<input type="text" class="input-box" data-f="textLabel" maxlength="120" value="${esc(st.textLabel)}" placeholder="Ürün Üzerine Yazılacak Metin" autocomplete="off"></label>
                <div class="tsn-grid2" style="margin-top:8px;">
                    <label>Kutudaki örnek (yer tutucu)<input type="text" class="input-box" data-f="textPlaceholder" maxlength="80" value="${esc(st.textPlaceholder)}" placeholder="Örn: ENGRARE" autocomplete="off"></label>
                    <label>Önizlemede ilk görünen yazı<input type="text" class="input-box" data-f="textPreview" maxlength="40" value="${esc(st.textPreview)}" placeholder="ENGRARE" autocomplete="off"></label>
                </div>
                <label style="display:block;margin-top:8px;max-width:240px;">Sabit yazı boyutu (px) <small>boşsa kutuya sığar</small><input type="number" class="input-box" data-f="fixedTextSize" min="10" max="200" step="1" value="${esc(st.fixedTextSize)}" inputmode="numeric"></label>`,
            logo: () => `<label>Başlık<input type="text" class="input-box" data-et="logo" maxlength="40" value="${et('logo')}" ${ph('logo')}></label>`,
            sosyal: () => `<label>Başlık<input type="text" class="input-box" data-et="sosyal" maxlength="40" value="${et('sosyal')}" ${ph('sosyal')}></label>
                <p class="tsn-hint">Her seçenekte 1 ya da 2 simge + QR çifti: yerleşim bölümünde ayarlanır.</p>`,
            renk: () => `
                <label>Başlık<input type="text" class="input-box" data-et="renk" maxlength="40" value="${et('renk')}" ${ph('renk')}></label>
                <div class="tsn-colors">${st.colors.map((c, i) => `
                    <div class="tsn-color${i === st.ci ? ' on' : ''}" data-ci="${i}">
                        <label>Yazı<input type="color" data-ck="c1" value="${esc(c.c1.toLowerCase())}"></label>
                        <label>Zemin<input type="color" data-ck="c2" value="${esc(c.c2.toLowerCase())}"></label>
                        <input type="text" class="input-box" data-ck="name" maxlength="40" value="${esc(c.name || '')}" placeholder="Ad (örn. Sarı / siyah)" autocomplete="off">
                        <button type="button" class="tsn-x" data-act="color-del" title="Kaldır"><i class="fa-solid fa-xmark"></i></button>
                    </div>`).join('') || '<p class="tsn-hint">Renk yok.</p>'}</div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
                    ${st.colors.length < 12 ? '<button type="button" class="btn" data-act="color-add"><i class="fa-solid fa-plus"></i> Renk ekle</button>' : ''}
                    <button type="button" class="btn" data-act="color-defaults"><i class="fa-solid fa-rotate-left"></i> Ortak listeyi yükle</button>
                </div>`,
            miktar: () => `<label>Başlık<input type="text" class="input-box" data-et="miktar" maxlength="40" value="${et('miktar')}" ${ph('miktar')}></label>`
        };
        return st.sira.map((k, n) => {
            const a = ALAN[k];
            const on = !a.ac || st.alan[k];
            return `<div class="tsn-blk${on ? '' : ' off'}" data-blk="${k}">
                <div class="tsn-blk-h">
                    <span class="tsn-no">${n + 1}</span><i class="fa-solid ${a.icon}"></i><b>${a.ad}</b>
                    ${a.ac ? `<button type="button" class="tsn-sw${on ? ' on' : ''}" data-act="blk-toggle" data-k="${k}">${on ? 'Ekli' : '+ Ekle'}</button>` : ''}
                    <span class="tsn-mv">
                        <button type="button" data-act="blk-up" data-k="${k}" title="Yukarı" ${n === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                        <button type="button" data-act="blk-down" data-k="${k}" title="Aşağı" ${n === st.sira.length - 1 ? 'disabled' : ''}><i class="fa-solid fa-arrow-down"></i></button>
                    </span>
                </div>
                ${on ? `<div class="tsn-blk-b">${inner[k]()}</div>` : `<p class="tsn-hint" style="margin:4px 0 0;">${a.not}</p>`}
            </div>`;
        }).join('');
    }

    function fieldSection() {
        return `<div class="tsn-sec">
            <h4>${isBase ? '1' : '2'}. Alanlar ve sıra</h4>
            <p class="tsn-hint" style="margin:0 0 10px;">Müşteriye ürün sayfasında yukarıdan aşağıya bu sırayla sorulur. ▲▼ ile sırayı değiştirin; yazı, logo ve sosyal medya QR alanlarını ekleyip kaldırın.</p>
            ${fieldCards()}
        </div>`;
    }

    function layoutSection() {
        const v = curVariant();
        const im = v.preview;
        const multi = st.variants.length > 1;
        const bar = multi ? `<div class="tsn-variants">${st.variants.map((x, i) => `<button type="button" class="tsn-chip${i === st.vi ? ' on' : ''}" data-var="${i}">${esc(x.name || 'Seçenek ' + (i + 1))}</button>`).join('')}</div>` : '';
        const chips = slotList().map(s => `<button type="button" class="tsn-chip${st.sel === s ? ' on' : ''}" data-slot-chip="${s}" style="--c:${SLOT_RENK[s]}">${SLOT_ADI[s]}</button>`).join('')
            + (st.alan.sosyal ? (v.slots.logo2 ? '<button type="button" class="tsn-chip add" data-act="pair-del"><i class="fa-solid fa-minus"></i> Sağ çifti kaldır</button>'
                : '<button type="button" class="tsn-chip add" data-act="pair-add"><i class="fa-solid fa-plus"></i> Sağ simge + QR ekle</button>') : '');
        const sel = st.sel && !isQuad(st.sel) ? shapeOf(st.sel) : null;
        const nums = `<div class="tsn-nums"${sel ? '' : ' style="display:none"'}>${['x', 'y', 'w', 'h'].map((k, i) => `<label>${{ x: 'Sol %', y: 'Üst %', w: 'Genişlik %', h: 'Yükseklik %' }[k]}<input type="number" class="input-box" data-n="${i}" min="0" max="100" step="0.5" value="${sel ? sel[i] : ''}" inputmode="decimal"></label>`).join('')}</div>`;
        const nothing = !slotList().length;
        return `<div class="tsn-sec">
            <h4>${isBase ? '2' : '3'}. Önizleme görseli ve yerleşim</h4>
            ${bar}
            <div class="tsn-up">
                <button type="button" class="btn" data-act="pick"><i class="fa-solid fa-upload"></i> ${im ? 'Görseli değiştir' : 'Önizleme görseli yükle'}</button>
                <input type="file" id="tsn-file" accept="image/*" hidden>
                <span class="tsn-hint">PNG/WebP, tercihen saydam arka planlı ürün resmi. <b>Koyu (siyah) alanlar yazı rengine boyanır</b>, kalanı olduğu gibi görünür; kutunun arkası zemin rengidir.${multi ? ' Her seçenek için ayrı görsel ve yerleşim.' : ''}</span>
            </div>
            ${im ? `${nothing ? '' : `<div class="tsn-chips">${chips}</div>`}
            <div class="tsn-box" id="tsn-box"><div class="tsn-bg"></div><img class="tsn-img" alt=""><svg class="tsn-svg" viewBox="0 0 100 100" preserveAspectRatio="none"></svg><div class="tsn-ov"></div></div>
            <p class="tsn-hint">${nothing ? 'Ürüne yazı, logo ya da sosyal medya QR alanı eklerseniz yerleşimi burada ayarlarsınız.' : 'Kutuyu/köşe noktalarını sürükleyin. Simge ve QR alanları dörtgendir: köşeleri ürünün eğimine göre ayrı ayrı oynatın.'}</p>
            ${nums}` : '<p class="tsn-hint" style="margin-top:8px;">Önce önizleme görselini yükleyin; yerleşim bunun üstünde yapılır.</p>'}
        </div>`;
    }

    function publishSection() {
        return `<div class="tsn-sec">
            <h4>${isBase ? '3' : '4'}. Yayın</h4>
            ${isBase ? `<p class="tsn-hint" style="margin:0;">Kaydedince site ve sipariş doğrulaması hemen bu tasarımı kullanır. ${ex.design && cleanDesign(ex.design) && cleanDesign(ex.design).variants ? 'Tasarımı iptal edip kodundaki ilk haline dönebilirsiniz:' : ''}</p>
              ${ex.design && cleanDesign(ex.design) && cleanDesign(ex.design).variants ? '<button type="button" class="btn" data-act="reset" style="margin-top:8px;"><i class="fa-solid fa-rotate-left"></i> Varsayılana dön</button>' : ''}`
            : `<label class="tsn-check"><input type="checkbox" data-f="aktif" ${st.aktif ? 'checked' : ''}> Sitede yayında (kapalıysa taslak: müşteri görmez, sipariş alınmaz)</label>
               <p class="tsn-hint">Ürün fotoğrafları için kaydettikten sonra listede “Görseller”e basın; yüklenmezse ilk seçeneğin önizleme görseli kapak olur.</p>`}
        </div>`;
    }

    function render() {
        if (st.sel && !slotList().includes(st.sel)) st.sel = null;
        if (!st.sel) st.sel = slotList()[0] || null;
        body.innerHTML = `${tokenBox()}${infoSection()}${fieldSection()}${layoutSection()}${publishSection()}
            <div class="tsn-foot">
                <p id="tsn-status" class="tsn-status"></p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">
                    <button type="button" class="btn" data-act="cancel">Vazgeç</button>
                    <button type="button" class="btn primary" id="tsn-save" data-act="save"><i class="fa-solid fa-cloud-arrow-up"></i> Kaydet ve yayınla</button>
                </div>
            </div>`;
        updatePrice();
        mountEditor();
    }

    function updatePrice() {
        const el = $('#tsn-price');
        if (!el) return;
        const h = Number(String(st.hours).replace(',', '.'));
        el.textContent = h > 0 ? `Satış fiyatı: ₺${ctx.priceFor(h)}` : '';
    }

    /* ---- Düzenleyici (canlı önizleme + sürükle-bırak) ---- */
    function mountEditor() {
        const box = $('#tsn-box');
        if (!box) return;
        paintCurrent();
        box.style.aspectRatio = String(aspect);
        draw();

        box.onpointerdown = (e) => {
            const h = e.target.closest('[data-h]');
            const s = e.target.closest('[data-slot]');
            if (!h && !s) return;
            const slot = (h || s).dataset.slot;
            if (slot !== st.sel) { st.sel = slot; syncChips(); }
            const pt = pointOf(e);
            drag = { slot, h: h ? h.dataset.h : 'move', start: pt, orig: clone(shapeOf(slot)) };
            box.setPointerCapture(e.pointerId);
            e.preventDefault();
            draw();
        };
        box.onpointermove = (e) => {
            if (!drag) return;
            const p = pointOf(e);
            applyDrag(drag, p.x - drag.start.x, p.y - drag.start.y);
            draw();
        };
        const end = () => { if (drag) { drag = null; syncNums(); } };
        box.onpointerup = end;
        box.onpointercancel = end;
        box.addEventListener('lostpointercapture', end);
    }

    function pointOf(e) {
        const r = $('#tsn-box').getBoundingClientRect();
        return { x: (e.clientX - r.left) / r.width * 100, y: (e.clientY - r.top) / r.height * 100 };
    }

    function applyDrag(dr, dx, dy) {
        const o = dr.orig;
        if (!isQuad(dr.slot)) {
            let [x, y, w, h] = o;
            const MIN = 3;
            if (dr.h === 'move') { x = clamp(o[0] + dx, 0, 100 - w); y = clamp(o[1] + dy, 0, 100 - h); }
            else {
                if (dr.h.includes('e')) w = clamp(o[2] + dx, MIN, 100 - o[0]);
                if (dr.h.includes('s')) h = clamp(o[3] + dy, MIN, 100 - o[1]);
                if (dr.h.includes('w')) { x = clamp(o[0] + dx, 0, o[0] + o[2] - MIN); w = o[0] + o[2] - x; }
                if (dr.h.includes('n')) { y = clamp(o[1] + dy, 0, o[1] + o[3] - MIN); h = o[1] + o[3] - y; }
            }
            setShape(dr.slot, [r1(x), r1(y), r1(w), r1(h)]);
            return;
        }
        if (dr.h === 'move') {
            const xs = o.map(p => p[0]), ys = o.map(p => p[1]);
            const mx = clamp(dx, -Math.min(...xs), 100 - Math.max(...xs)), my = clamp(dy, -Math.min(...ys), 100 - Math.max(...ys));
            setShape(dr.slot, o.map(p => [r1(p[0] + mx), r1(p[1] + my)]));
        } else {
            const i = Number(dr.h);
            const q = clone(o);
            q[i] = [r1(clamp(o[i][0] + dx, 0, 100)), r1(clamp(o[i][1] + dy, 0, 100))];
            setShape(dr.slot, q);
        }
    }

    function paintCurrent() {
        const box = $('#tsn-box');
        if (!box) return;
        const im = curVariant().preview;
        const img = box.querySelector('.tsn-img');
        const c = color();
        box.querySelector('.tsn-bg').style.background = c.c2;
        if (!im) { clearPreview(img); return; }
        paintPreview(img, { src: imgUrl(im), mask: maskUrl(im) }, c.c1, (a) => {
            if (a && Math.abs(a - aspect) > 0.001) { aspect = a; box.style.aspectRatio = String(a); draw(); }
        });
    }

    function draw() {
        const box = $('#tsn-box');
        if (!box) return;
        const ov = box.querySelector('.tsn-ov');
        const svg = box.querySelector('.tsn-svg');
        const bh = box.clientHeight;
        const order = slotList().filter(s => s !== st.sel).concat(st.sel ? [st.sel] : []);
        let html = '', poly = '';
        for (const slot of order) {
            const sh = shapeOf(slot);
            if (!sh) continue;
            const on = slot === st.sel, col = SLOT_RENK[slot];
            if (!isQuad(slot)) {
                const [x, y, w, h] = sh;
                const sample = slot === 'text'
                    ? `<span class="tsn-sample" style="color:${esc(color().c1)};font-size:${Math.max(8, h / 100 * bh * 0.62)}px">${esc((st.textPreview || 'ENGRARE').slice(0, 12))}</span>` : '';
                html += `<div class="tsn-rect${on ? ' on' : ''}" data-slot="${slot}" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%;--c:${col}"><i>${SLOT_ADI[slot]}</i>${sample}</div>`;
                if (on) for (const k of ['nw', 'ne', 'sw', 'se']) {
                    html += `<div class="tsn-h" data-slot="${slot}" data-h="${k}" style="left:${k.includes('e') ? x + w : x}%;top:${k.includes('s') ? y + h : y}%"></div>`;
                }
            } else {
                const [a, b, c, d] = sh;   // sol üst, sağ üst, sol alt, sağ alt
                poly += `<polygon data-slot="${slot}" class="${on ? 'on' : ''}" points="${a[0]},${a[1]} ${b[0]},${b[1]} ${d[0]},${d[1]} ${c[0]},${c[1]}" style="--c:${col}"/>`;
                html += `<div class="tsn-qlabel" style="left:${a[0]}%;top:${a[1]}%;--c:${col}">${SLOT_ADI[slot]}</div>`;
                if (on) sh.forEach((p, i) => { html += `<div class="tsn-h" data-slot="${slot}" data-h="${i}" style="left:${p[0]}%;top:${p[1]}%"></div>`; });
            }
        }
        svg.innerHTML = poly;
        ov.innerHTML = html;
    }

    function syncChips() {
        body.querySelectorAll('[data-slot-chip]').forEach(b => b.classList.toggle('on', b.dataset.slotChip === st.sel));
        const sel = st.sel && !isQuad(st.sel) ? shapeOf(st.sel) : null;
        const wrap = body.querySelector('.tsn-nums');
        if (wrap) wrap.style.display = sel ? '' : 'none';
        syncNums();
    }
    function syncNums() {
        const sel = st.sel && !isQuad(st.sel) ? shapeOf(st.sel) : null;
        body.querySelectorAll('[data-n]').forEach(inp => { if (sel) inp.value = sel[Number(inp.dataset.n)]; });
    }

    /* ---- Olaylar ---- */
    async function loadToken() {
        try { token = (await ctx.getToken()) || ''; } catch (e) { token = ''; }
        render();
    }

    body.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.f) {
            if (t.type === 'checkbox') return;
            st[t.dataset.f] = t.value;
            if (t.dataset.f === 'hours') updatePrice();
            if (t.dataset.f === 'textPreview') draw();
        } else if (t.dataset.et) {
            st.etiket[t.dataset.et] = t.value;
        } else if (t.dataset.vname !== undefined) {
            const i = Number(t.dataset.vname);
            st.variants[i].name = t.value;
            const chip = body.querySelector(`[data-var="${i}"]`);
            if (chip) chip.textContent = t.value || 'Seçenek ' + (i + 1);
        } else if (t.dataset.n !== undefined) {
            const sh = st.sel && shapeOf(st.sel);
            if (!sh) return;
            const i = Number(t.dataset.n), v = Number(t.value);
            if (!Number.isFinite(v)) return;
            const n = sh.slice();
            n[i] = clamp(v, i < 2 ? 0 : 3, 100);
            if (n[0] + n[2] > 100) { if (i === 2) n[2] = 100 - n[0]; else n[0] = 100 - n[2]; }
            if (n[1] + n[3] > 100) { if (i === 3) n[3] = 100 - n[1]; else n[1] = 100 - n[3]; }
            setShape(st.sel, n);
            draw();
        } else if (t.dataset.ck) {
            const row = t.closest('[data-ci]');
            const i = Number(row.dataset.ci);
            st.colors[i][t.dataset.ck] = t.value;
            st.ci = i;
            body.querySelectorAll('[data-ci]').forEach(r => r.classList.toggle('on', Number(r.dataset.ci) === i));
            paintCurrent();
            draw();
        }
    });

    body.addEventListener('change', async (e) => {
        const t = e.target;
        if (t.dataset.f === 'aktif') {
            st.aktif = t.checked;
        } else if (t.id === 'tsn-file') {
            const f = t.files && t.files[0];
            if (!f || busy) return;
            try {
                const blob = await toWebp(f);
                const prev = curVariant().preview;
                if (prev && prev.url) URL.revokeObjectURL(prev.url);
                // Yeni görsel eski hazır maskeyi geçersiz kılar (tarayıcıda yeniden ayrılır)
                curVariant().preview = { path: null, mask: null, blob, url: URL.createObjectURL(blob) };
                aspect = 16 / 9;
                render();
            } catch (err) {
                setStatus(`${f.name}: ${err.message}`, true);
            }
        }
    });

    const move = (k, d) => {
        const i = st.sira.indexOf(k), j = i + d;
        if (j < 0 || j >= st.sira.length) return;
        [st.sira[i], st.sira[j]] = [st.sira[j], st.sira[i]];
    };

    body.addEventListener('click', async (e) => {
        const v = e.target.closest('[data-var]');
        if (v) { st.vi = Number(v.dataset.var); st.sel = null; aspect = 16 / 9; render(); return; }
        const chip = e.target.closest('[data-slot-chip]');
        if (chip) { st.sel = chip.dataset.slotChip; syncChips(); draw(); return; }
        const row = e.target.closest('[data-ci]');
        const btn = e.target.closest('button[data-act]');
        if (row && !btn && !e.target.closest('input')) {
            st.ci = Number(row.dataset.ci);
            body.querySelectorAll('[data-ci]').forEach(r => r.classList.toggle('on', Number(r.dataset.ci) === st.ci));
            paintCurrent(); draw();
            return;
        }
        if (!btn || busy) return;
        const act = btn.dataset.act;
        if (act === 'pick') { $('#tsn-file').click(); return; }
        if (act === 'cancel') { close(); return; }
        if (act === 'token-change') { token = ''; render(); return; }
        if (act === 'token-save') {
            const t = $('#tsn-token-input').value.trim();
            if (!t) return;
            busy = true; setStatus('Doğrulanıyor...');
            try {
                const r = await gh('GET', '', t);
                if (!r.permissions || !r.permissions.push) throw Object.assign(new Error('x'), { status: 403 });
                await ctx.setToken(t);
                token = t; busy = false; render();
                setStatus('Anahtar kaydedildi.');
            } catch (err) { busy = false; setStatus(errText(err), true); }
            return;
        }
        if (act === 'blk-up') { move(btn.dataset.k, -1); render(); }
        else if (act === 'blk-down') { move(btn.dataset.k, 1); render(); }
        else if (act === 'blk-toggle') { st.alan[btn.dataset.k] = !st.alan[btn.dataset.k]; st.sel = null; render(); }
        else if (act === 'var-add') {
            st.variants.push(newVariant(`Seçenek ${st.variants.length + 1}`));
            st.vi = st.variants.length - 1; st.sel = null; aspect = 16 / 9; render();
        } else if (act === 'var-del') {
            const i = Number(btn.dataset.i);
            if (!confirm(`“${st.variants[i].name || 'Seçenek ' + (i + 1)}” seçeneği kaldırılsın mı?`)) return;
            st.variants.splice(i, 1); st.vi = 0; st.sel = null; aspect = 16 / 9; render();
        } else if (act === 'pair-add') {
            curVariant().slots.logo2 = defQuad('logo2'); curVariant().slots.qr2 = defQuad('qr2'); st.sel = 'qr2'; render();
        } else if (act === 'pair-del') {
            delete curVariant().slots.logo2; delete curVariant().slots.qr2; st.sel = null; render();
        } else if (act === 'color-add') {
            st.colors.push({ c1: '#FFFFFF', c2: '#1976D2', name: '' }); st.ci = st.colors.length - 1; render();
        } else if (act === 'color-del') {
            const i = Number(btn.closest('[data-ci]').dataset.ci);
            st.colors.splice(i, 1); st.ci = 0; render();
        } else if (act === 'color-defaults') {
            st.colors = ctx.baseColors.map(c => ({ ...c })); st.ci = 0; render();
        } else if (act === 'reset') {
            if (!confirm('Bu ürünün tasarımı silinsin ve kodundaki ilk haline dönsün mü? (Renk seçimleri de sıfırlanır.)')) return;
            await save({ reset: true });
        } else if (act === 'save') {
            await save({});
        }
    });

    /* ---- Doğrulama ve kayıt ---- */
    function buildDesign(paths) {
        const alan = { ...st.alan };
        const etiket = {};
        for (const [k, v] of Object.entries(st.etiket)) if (String(v).trim()) etiket[k] = String(v).trim();
        const d = {
            v: 2, aktif: st.aktif, alan, sira: st.sira, etiket,
            colors: st.colors.map(c => ({ c1: c.c1.toUpperCase(), c2: c.c2.toUpperCase(), name: (c.name || '').trim() })),
            variants: st.variants.map((v, i) => ({
                name: v.name.trim(), preview: paths[i].preview, ...(paths[i].mask ? { mask: paths[i].mask } : {}),
                ...(alan.yazi ? { textArea: v.textArea } : {}), ...(alan.logo ? { logoArea: v.logoArea } : {}),
                ...(alan.sosyal ? { slots: v.slots } : {})
            }))
        };
        const fs = Number(st.fixedTextSize);
        if (alan.yazi && fs >= 10 && fs <= 200) d.fixedTextSize = Math.round(fs);
        return d;
    }

    function validate() {
        if (!st.colors.length) return 'En az bir renk çifti ekleyin.';
        if (!isBase) {
            if (!st.name.trim()) return 'Ürün adı gerekli.';
            if (isNew && !(Number(String(st.hours).replace(',', '.')) > 0)) return 'Geçerli bir üretim süresi (saat) girin: fiyat buradan hesaplanır.';
        }
        const names = new Set();
        for (const v of st.variants) {
            const n = v.name.trim();
            if (!n) return 'Her seçeneğin bir adı olmalı.';
            if (names.has(n)) return `“${n}” adı iki seçenekte var; adlar farklı olmalı.`;
            names.add(n);
            if (!v.preview) return `“${n}” için önizleme görseli yükleyin.`;
        }
        return '';
    }

    async function save({ reset }) {
        const bad = reset ? '' : validate();
        if (bad) { setStatus(bad, true); return; }
        const fresh = reset ? [] : st.variants.map(v => v.preview).filter(im => im && im.blob);
        if (fresh.length && !token) { setStatus('Önce GitHub anahtarını girin.', true); return; }
        busy = true;
        const btn = $('#tsn-save');
        if (btn) btn.disabled = true;
        try {
            const stamp = Date.now().toString(36);
            const msg = `Panel: ürün ${id} tasarımı`;
            let n = 0;
            const uploaded = [];
            for (const im of fresh) {
                const path = `${PANEL_DIR}${id}/onizleme-${stamp}-${++n}.webp`;
                setStatus(`Görsel yükleniyor: ${n}/${fresh.length}...`);
                await putFile(token, path, im.blob, msg);
                im.newPath = path;
                uploaded.push(path);
            }
            for (const p of uploaded) {
                const ok = await waitLive(p, (k) => setStatus(`Sitede yayınlanması bekleniyor... (${(k + 1) * 5} sn)`));
                if (!ok) throw new Error('Görsel sitede 5 dakikada yayınlanmadı; kaydedilmedi. Biraz sonra yeniden “Kaydet” deyin (yüklenen dosya yeniden kullanılmaz).');
            }
            let design = null;
            if (!reset) {
                design = cleanDesign(buildDesign(st.variants.map(v => ({
                    preview: v.preview.newPath || v.preview.path, mask: v.preview.blob ? null : v.preview.mask
                }))));
                if (!design || !design.variants || !designUsable(design) || design.variants.length !== st.variants.length) {
                    throw new Error('Tasarım eksik ya da geçersiz: görselleri ve yerleşimleri kontrol edin.');
                }
            }
            setStatus('Kaydediliyor...');
            const fields = (isBase && reset) ? {} : {
                ...(isBase ? {} : { name: st.name.trim().slice(0, 120), desc: st.desc.trim().slice(0, 200) }),
                customTextLabel: st.textLabel.trim() || null,
                customTextPlaceholder: st.textPlaceholder.trim() || null,
                customTextPlaceholderPreview: st.textPreview.trim() || null
            };
            // Eski yazılar (yazı boş bırakılınca) koddaki varsayılana dönsün: boş = sil
            await ctx.write({ id, design, fields, hours: isNew ? Number(String(st.hours).replace(',', '.')) : null });
            // Eski önizleme dosyaları bilerek silinmez: yayındaki eski fiyat.js (GitHub Pages 1-2 dk gecikir, tarayıcı önbelleği) hâlâ onlara bakıyor olabilir
            setStatus('Siteye gönderiliyor...');
            await ctx.publish();
            ctx.audit(reset ? 'Varsayılana döndü' : (isNew ? `Yeni ürün: ${st.name.trim()}` : 'Tasarım'), id);
            ctx.toast(reset ? 'Ürün kodundaki ilk haline döndü.' : (isNew ? 'Ürün oluşturuldu.' + (st.aktif ? '' : ' Taslak olarak duruyor; yayına almak için “Sitede yayında”yı işaretleyin.') : 'Kaydedildi.'), 'success');
            close();
        } catch (err) {
            console.error('Ürün tasarımı:', err);
            setStatus('Hata: ' + errText(err), true);
        } finally {
            busy = false;
            const b = $('#tsn-save');
            if (b) b.disabled = false;
        }
    }

    function close() {
        const box = $('#tsn-box');
        if (box) clearPreview(box.querySelector('.tsn-img'));
        root.classList.remove('open');
        body.innerHTML = '';
        for (const v of st.variants) if (v.preview && v.preview.url) URL.revokeObjectURL(v.preview.url);
    }
    $('#close-tsn-modal').onclick = () => { if (!busy) close(); };

    render();
    loadToken();
}
