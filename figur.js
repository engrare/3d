/* Yapay zekâ ile renkli 3D figür paneli (ürün 5): tarif yaz (ya da görsel yükle) -> portre sunucusuna yolla (`POST /is?urun=figur`) -> işi yokla ->
   renkli döndürülebilir 3B önizleme (portre-viewer.js, köşe renkli). Firebase'e BAĞLI DEĞİL; sunucu portre-worker/ (figur.py). Sepet kalemi portre ürünüyle aynı
   `portreJob` alanını taşır (sunucu işi doğrular: attachPortre). Sunucu kapalıysa "stokta yok" mesajı. myScript.js `figurAc/figurKapat/figurSecim` çağırır. */
import { kimlikBasligi, uyeOlGoster } from './tarayici.js?v=2';
const API = (window.PORTRE_API || 'https://edit-api.engrare.com') + '/api/portre';
const KAPALI = 'Şu an stokta yok. Stoklar yarın yenilenecek.';
const SSKEY = 'engrare_figur';
const $ = (s) => document.querySelector(s);
let st = null;   // { jobId, tarif, dosya, uretim, bitti, t0, viewer, unsub, cizgiUrl, palet }
let sayac = null;

async function api(yol, secenek, sure) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), sure || 12000);
    try {
        const r = await fetch(API + yol, { ...(secenek || {}), headers: { ...((secenek && secenek.headers) || {}), ...(await kimlikBasligi(yol, secenek)) }, signal: ac.signal });
        let d = null; try { d = await r.json(); } catch (e) { /* JSON değil */ }
        if (!r.ok || !d) { const err = new Error((d && d.hata) || KAPALI); err.durum = r.status; if (d && d.hata) err.sunucu = true; else err.kapali = true; if (d && d.uyeOl) err.uyeOl = true; throw err; }
        return d;
    } catch (e) { if (e.sunucu || e.kapali) throw e; const err = new Error(KAPALI); err.kapali = true; throw err; }
    finally { clearTimeout(t); }
}
const dosyaUrl = (id, ad, v) => `${API}/dosya/${id}/${ad}?v=${v || 0}`;
const siraMetin = (j) => {   // sunucu `onunde`: çalışan iş + kuyrukta öncekiler; ~100 sn/iş ile tahmini bekleme
    const o = typeof j.onunde === 'number' ? j.onunde : Math.max(0, (j.sira || 1) - 1);
    return o > 0 ? `Sıradasınız: ${o + 1}. sıra · önünüzde ${o} üretim var · tahmini bekleme ~${Math.max(1, Math.round(o * 1.7))} dk` : 'Sıra size geldi, başlıyoruz…';
};
const sureYaz = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function hata(m) { const h = $('#figur-hata'); h.textContent = m || ''; h.hidden = !m; }
function gorunum(ad) {
    $('#figur-kapali').hidden = ad !== 'kapali'; $('#figur-giris').hidden = ad !== 'giris';
    $('#figur-surec').hidden = ad !== 'surec'; $('#figur-sonuc').hidden = ad !== 'sonuc';
}
function sayacDur() { if (sayac) { clearInterval(sayac); sayac = null; } }
function sayacBasla(t0) {
    sayacDur(); const bu = st; bu.t0 = t0 || Date.now();
    const tik = () => {
        if (st !== bu) return sayacDur();
        $('#figur-sure').textContent = sureYaz(Date.now() - bu.t0);
        const bar = $('#figur-bar-dolu'), cur = parseFloat(bar.style.width) || 0;
        if (bu.durum === 'calisiyor' && cur < 94) bar.style.width = (cur + (94 - cur) * 0.018).toFixed(1) + '%';
    };
    tik(); sayac = setInterval(tik, 1000);
}
const TARIF_MIN = 3;
/* Örnek vitrini: üretmeden önce gerçek sonucu döndürüp görmek için. Kendi denememizden (müşteri verisi değil) güncel hatla üretilmiş figürler;
   GLB'ler küçültülmüş önizlemedir (content/products/figur/ornek/, yalnız basılınca iner). Palet = o işin basılacak filament renkleri. */
const ORNEK_YOL = './content/products/figur/ornek/', ORNEK_V = 1;
const ORNEKLER = [     // { ad, baslik, tarif, palet }: portre-data işleri 22e71318, 1122b8c1, 362f7a4f, 2f6b01b3 (2026-11-11)
    { ad: 'ejderha', baslik: 'Ejderha', tarif: 'kırmızı pelerinli küçük ejderha', palet: [{ ad: 'Bordo', hex: '#6B1C23' }, { ad: 'Gri', hex: '#7A7B7A' }, { ad: 'Ten', hex: '#E8C4A0' }, { ad: 'Kırmızı', hex: '#CC0605' }] },
    { ad: 'tavsan', baslik: 'Tavşan', tarif: 'astronot kıyafetli tavşan', palet: [{ ad: 'Beyaz', hex: '#F4F4F4' }, { ad: 'Gümüş', hex: '#A5A9AD' }, { ad: 'Kahverengi', hex: '#5A3825' }, { ad: 'Sarı', hex: '#F7B500' }] },
    { ad: 'baykus', baslik: 'Baykuş', tarif: 'gözlüklü baykuş profesör', palet: [{ ad: 'Naturel', hex: '#E6E1D3' }, { ad: 'Siyah', hex: '#0E0E10' }, { ad: 'Kahverengi', hex: '#5A3825' }, { ad: 'Altın', hex: '#C9A24A' }] },
    { ad: 'panda', baslik: 'Panda', tarif: 'kasklı sevimli panda', palet: [{ ad: 'Beyaz', hex: '#F4F4F4' }, { ad: 'Gri', hex: '#7A7B7A' }, { ad: 'Siyah', hex: '#0E0E10' }, { ad: 'Kahverengi', hex: '#5A3825' }] }
];
let vitrin = null;     // { viewer, ad }
function olusturDurum() {
    const t = ($('#figur-tarif').value || '').trim();
    $('#figur-olustur').disabled = !(t.length >= TARIF_MIN || (st && st.dosya));
}
function girisTemizle() {
    $('#figur-file').value = ''; $('#figur-foto-onizleme').hidden = true; $('#figur-foto-onizleme').removeAttribute('src');
    $('#figur-drop').classList.remove('dolu'); $('#figur-drop-metin').hidden = false;
}
async function kucult(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) { bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); }); }
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('jpeg')), 'image/jpeg', 0.9));
}
async function dosyaSec(file) {
    hata(''); if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return hata('Lütfen bir görsel (JPEG, PNG) seçin.');
    try {
        const blob = await kucult(file);
        if (blob.size > 4 * 1024 * 1024) return hata('Görsel çok büyük. Daha küçük bir görsel deneyin.');
        st = st || {}; st.dosya = blob;
        const im = $('#figur-foto-onizleme'); im.src = URL.createObjectURL(blob); im.hidden = false;
        $('#figur-drop').classList.add('dolu'); $('#figur-drop-metin').hidden = true;
        $('#figur-tarif').value = '';   // görsel seçildi: tarif yok sayılır
        olusturDurum();
    } catch (e) { hata('Görsel okunamadı. Başka bir görsel deneyin.'); }
}

export function figurKur() {
    $('#figur-tarif').addEventListener('input', () => { if (st && st.dosya && $('#figur-tarif').value.trim()) { st.dosya = null; girisTemizle(); } olusturDurum(); });
    $('#figur-ornek').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (st) st.dosya = null; girisTemizle(); $('#figur-tarif').value = b.textContent; olusturDurum(); });
    $('#figur-file').addEventListener('change', (e) => dosyaSec(e.target.files[0]));
    const drop = $('#figur-drop');
    ['dragenter', 'dragover'].forEach(o => drop.addEventListener(o, (e) => { e.preventDefault(); drop.classList.add('surukle'); }));
    ['dragleave', 'drop'].forEach(o => drop.addEventListener(o, (e) => { e.preventDefault(); drop.classList.remove('surukle'); }));
    drop.addEventListener('drop', (e) => dosyaSec(e.dataTransfer.files[0]));
    $('#figur-olustur').addEventListener('click', () => baslat(false));
    $('#figur-yeniden').addEventListener('click', () => baslat(true));
    $('#figur-yeni').addEventListener('click', () => { vTemizle(); st = null; try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ } girisTemizle(); gorunum('giris'); olusturDurum(); window.figurDegisti && window.figurDegisti(); });
    $('#figur-iptal').addEventListener('click', iptalEt);
    vitrinKur();
    // Üretim sunucuda sürer: sayfa arka plana atılsa, kapansa ya da yenilense durmaz (iptal yalnız "Üretimi iptal et" ile); SSKEY kalır, sayfa dönünce yoklama sürer
}

function vitrinKur() {
    const l = $('#figur-vitrin-liste'); if (!l || !ORNEKLER.length) return;
    for (const o of ORNEKLER) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.ornek = o.ad; b.setAttribute('data-ol', 'figur-vitrin');
        b.setAttribute('aria-label', `Örnek figürü 3B incele: ${o.tarif}`);
        const im = document.createElement('img'); im.src = `${ORNEK_YOL}${o.ad}.webp?v=${ORNEK_V}`; im.alt = ''; im.width = 84; im.height = 84; im.loading = 'lazy'; im.decoding = 'async';
        const ad = document.createElement('span'); ad.textContent = o.baslik;
        b.append(im, ad); l.appendChild(b);
    }
    l.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) vitrinAc(ORNEKLER.find(o => o.ad === b.dataset.ornek)); });
    $('#figur-vitrin-kapat').addEventListener('click', vitrinKapat);
    $('#figur-vitrin-dene').addEventListener('click', () => {
        const o = vitrin && ORNEKLER.find(x => x.ad === vitrin.ad); if (!o) return;
        if (st) st.dosya = null; girisTemizle(); $('#figur-tarif').value = o.tarif; olusturDurum(); vitrinKapat();
        $('#figur-tarif').scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    $('#figur-vitrin').hidden = false;
}
async function vitrinAc(o) {
    if (!o) return;
    if (vitrin && vitrin.ad === o.ad) return vitrinKapat();   // aynı örneğe ikinci basış kapatır
    vitrinKapat(true);
    const bu = vitrin = { ad: o.ad, viewer: null };
    document.querySelectorAll('#figur-vitrin-liste button').forEach(b => b.classList.toggle('secili', b.dataset.ornek === o.ad));
    $('#figur-vitrin-tarif').textContent = `Tarif: “${o.tarif}”. Gerçek üretim çıktısıdır; her üretim farklı çıkar.`;
    paletCiz(o.palet, $('#figur-vitrin-palet'));
    $('#figur-vitrin-kutu').hidden = false;
    try {
        const vm = await import('./portre-viewer.js?v=7');
        if (vitrin !== bu) return;
        bu.viewer = vm.goster($('#figur-vitrin-viewer'), `${ORNEK_YOL}${o.ad}.glb?v=${ORNEK_V}`, '#ffffff', (err) => { if (err && vitrin === bu) hata('Örnek yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.'); }, true);
    } catch (e) { hata('3B önizleme bu cihazda açılamadı. Tarayıcınızı güncelleyin.'); }
}
function vitrinKapat(gecis) {
    if (vitrin && vitrin.viewer) { try { vitrin.viewer.yoket(); } catch (e) { /* kapalı */ } }
    vitrin = null; const v = $('#figur-vitrin-viewer'); if (v) v.innerHTML = '';
    if (gecis === true) return;
    const k = $('#figur-vitrin-kutu'); if (k) k.hidden = true;
    document.querySelectorAll('#figur-vitrin-liste button.secili').forEach(b => b.classList.remove('secili'));
}

function vTemizle() { if (st && st.viewer) { try { st.viewer.yoket(); } catch (e) { /* kapalı */ } st.viewer = null; } const v = $('#figur-viewer'); if (v) v.innerHTML = ''; }

async function baslat(yeniden) {
    hata(''); if (st && st.uretim) return;
    const tarif = ($('#figur-tarif').value || '').trim(), dosya = st && st.dosya, onceki = yeniden && st ? st.jobId : undefined;
    if (!yeniden && !dosya && tarif.length < TARIF_MIN) return hata('Lütfen figürünüzü birkaç kelimeyle anlatın.');
    vTemizle(); vitrinKapat(); if (st && st.unsub) st.unsub();
    st = { dosya, tarif: onceki ? (st.tarif || '') : tarif, uretim: true, bitti: false };
    $('#figur-bar-dolu').style.width = '2%'; $('#figur-durum').textContent = 'Figürünüz tasarlanıyor…';
    const ib = $('#figur-iptal'); ib.disabled = false; ib.textContent = 'Üretimi iptal et';
    gorunum('surec'); sayacBasla(); window.figurDegisti && window.figurDegisti();
    try {
        const r = onceki ? await api(`/is?urun=figur&kaynak=${onceki}`, { method: 'POST' })
            : dosya ? await api('/is?urun=figur', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: dosya }, 90000)
            : await api(`/is?urun=figur&tarif=${encodeURIComponent(tarif)}`, { method: 'POST' });
        st.jobId = r.id;
        if (st.iptalIstendi) return iptalEt();
        try { sessionStorage.setItem(SSKEY, JSON.stringify({ jobId: st.jobId })); } catch (e) { /* özel mod */ }
        izle(st.jobId);
    } catch (e) {
        sayacDur(); st.uretim = false; window.figurDegisti && window.figurDegisti();
        if (e.kapali) { gorunum('kapali'); return; }
        gorunum('giris'); olusturDurum(); hata(e.message || 'Yükleme başarısız. Tekrar deneyin.'); uyeOlGoster($('#figur-hata'), e);
    }
}

async function iptalEt() {
    const bu = st; if (!bu || bu.bitti) return;
    const btn = $('#figur-iptal'); btn.disabled = true; btn.textContent = 'İptal ediliyor…'; bu.iptalEdiliyor = true;
    if (!bu.jobId) { bu.iptalIstendi = true; return; }
    let r = null;
    try { r = await api(`/is/${bu.jobId}/iptal`, { method: 'POST' }, 15000); }
    catch (e) { if (st !== bu) return; bu.iptalEdiliyor = false; btn.disabled = false; btn.textContent = 'Üretimi iptal et'; return hata(e.kapali ? KAPALI : e.message); }
    if (st !== bu) return;
    if (!r.iptal) { bu.iptalEdiliyor = false; btn.disabled = false; btn.textContent = 'Üretimi iptal et'; return; }
    if (bu.unsub) bu.unsub(); sayacDur(); bu.uretim = false;
    try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
    st = { dosya: bu.dosya }; gorunum('giris'); olusturDurum(); window.figurDegisti && window.figurDegisti();
}

/* İşi sunucudan yoklar (1,5-3 sn). Ağ/sunucu hatası iş bırakma sebebi DEĞİLDİR: iş sunucuda sürer; sekme arka plandayken tarayıcı zamanlayıcıyı/ağı dondurabilir ya da
   telefon uyuyunca ağ geç gelir. Bu yüzden hatada yumuşak "bağlantı yeniden kuruluyor" mesajı + artan aralıkla sınırsız yeniden deneme yapılır, iş kaydı silinmez;
   sekme tekrar görünür olunca / ağ gelince hemen yoklanır. Yalnızca iş art arda 3 kez 404 (silinmiş) ya da sunucu işi "hata" derse üretim sonlanır. */
function izle(jobId) {
    const mevcut = st; let ilk = false, ardarda = 0, yok = 0, ilkHata = 0, zaman = null, dur = false, surerken = false;
    const uyan = () => { if (document.visibilityState === 'visible' && !dur && st === mevcut && !surerken) { clearTimeout(zaman); ardarda = 0; tur(); } };
    const olay = [[document, 'visibilitychange'], [window, 'online'], [window, 'pageshow'], [window, 'focus']];
    olay.forEach(([o, a]) => o.addEventListener(a, uyan));
    st.unsub = () => { dur = true; clearTimeout(zaman); olay.forEach(([o, a]) => o.removeEventListener(a, uyan)); };
    const hatali = (m) => {
        if (st !== mevcut || mevcut.iptalEdiliyor) return;
        st.unsub(); st.unsub = null; sayacDur(); st.uretim = false; try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
        window.figurDegisti && window.figurDegisti();
        gorunum('giris'); olusturDurum(); hata(m);
    };
    const tur = async () => {
        if (dur || st !== mevcut || surerken) return;
        surerken = true;
        let j;
        try { j = await api(`/is/${jobId}`, {}, 10000); ardarda = 0; yok = 0; ilkHata = 0; }
        catch (e) {
            surerken = false;
            if (dur || st !== mevcut) return;
            if (e.durum === 404) { if (++yok >= 3) return hatali('Önceki figürünüz bulunamadı (süresi dolmuş olabilir). Yeniden oluşturun.'); zaman = setTimeout(tur, 1500); return; }
            yok = 0; ardarda++; ilkHata = ilkHata || Date.now();
            if (ardarda >= 2) $('#figur-durum').textContent = Date.now() - ilkHata > 60000 ? 'Sunucuya ulaşılamıyor. Bağlantınızı kontrol edin; yeniden deneniyoruz, üretiminiz kaybolmaz…' : 'Bağlantı yeniden kuruluyor…';
            zaman = setTimeout(tur, Math.min(10000, 1500 + ardarda * 1500)); return;
        }
        surerken = false;
        if (dur || st !== mevcut) return;
        if (!ilk) { ilk = true; const fark = j.simdi ? j.simdi - Date.now() : 0; if (st.geriYuklendi && j.olusturma) sayacBasla(j.olusturma - fark); }
        st.durum = j.durum;
        if (j.tarif && !st.tarif) st.tarif = j.tarif;
        if (j.durum === 'sirada') { $('#figur-durum').textContent = siraMetin(j); $('#figur-bar-dolu').style.width = '4%'; }
        else if (j.durum === 'calisiyor') {
            $('#figur-durum').textContent = j.adim === 'model' || j.adim === 'cizgi_hazir' ? 'Renkli 3B modele dönüştürülüyor…' : 'Figürünüz tasarlanıyor…';
            const w = Math.max(5, Math.min(95, j.yuzde || 5)), bar = $('#figur-bar-dolu'); if (w > (parseFloat(bar.style.width) || 0)) bar.style.width = w + '%';
        } else if (j.durum === 'hata') return hatali(j.hata || 'Figür oluşturulamadı. Tekrar deneyin.');
        else if (j.durum === 'bitti' && j.modelVar) { st.unsub(); st.unsub = null; return bitti(j); }
        zaman = setTimeout(tur, j.durum === 'sirada' ? 3000 : 1500);
    };
    tur();
}

async function bitti(j) {
    const bu = st; sayacDur();
    bu.uretim = false; bu.bitti = true; bu.jobSurum = j.modelSurum; bu.palet = j.palet || []; bu.sureMs = (j.bitis && j.olusturma) ? j.bitis - j.olusturma : Date.now() - bu.t0;
    bu.cizgiUrl = j.cizgiVar ? dosyaUrl(j.id, 'cizgi.jpg', j.cizgiSurum) : null; bu.goruldu = !$('#figur-panel').hidden; bu.jobId = j.id;
    $('#figur-bar-dolu').style.width = '100%';
    $('#figur-bitti-sure').textContent = `Figürünüz ${sureYaz(bu.sureMs)} sürede hazırlandı.` + (bu.tarif ? ` “${bu.tarif}”` : '');
    paletCiz(bu.palet);
    gorunum('sonuc'); viewerAc();
    window.figurDegisti && window.figurDegisti();
}
function paletCiz(p, k = $('#figur-palet')) {
    k.innerHTML = '';
    for (const r of p || []) { if (!/^#[0-9a-fA-F]{6}$/.test(r.hex)) continue; const s = document.createElement('span'); const i = document.createElement('i'); i.style.background = r.hex; s.appendChild(i); s.appendChild(document.createTextNode(String(r.ad || '').replace(/^≈ /, ''))); k.appendChild(s); }
}
async function viewerAc() {
    const bu = st; if (!bu || !bu.bitti || $('#figur-panel').hidden || bu.viewer) return;
    try {
        const vm = await import('./portre-viewer.js?v=7');
        if (st !== bu || bu.viewer) return;
        $('#figur-viewer').innerHTML = '';
        bu.viewer = vm.goster($('#figur-viewer'), dosyaUrl(bu.jobId, 'model.glb', bu.jobSurum), '#ffffff', (err) => {
            if (!err) return hata('');
            if (!bu.yenidenDenendi && st === bu) { bu.yenidenDenendi = true; vTemizle(); setTimeout(viewerAc, 1500); return; }   // geçici ağ kesintisi: bir kez daha dene
            hata('3B önizleme yüklenemedi. Sayfayı yenilerseniz figürünüz yeniden açılır.');
        }, true);
    } catch (e) { hata('3B önizleme bu cihazda açılamadı. Tarayıcınızı güncelleyin.'); }
}

export async function figurAc() {
    $('#figur-panel').hidden = false;
    if (st && st.bitti) { st.goruldu = true; viewerAc(); return; }
    if (st) return;
    try { await api('/saglik', {}, 7000); } catch (e) { if (!st) gorunum('kapali'); return; }
    if (st) return;
    gorunum('giris'); olusturDurum();
    let kayit = null; try { kayit = JSON.parse(sessionStorage.getItem(SSKEY) || 'null'); } catch (e) { /* bozuk */ }
    if (kayit && kayit.jobId) {
        st = { jobId: kayit.jobId, uretim: true, geriYuklendi: true };
        gorunum('surec'); $('#figur-durum').textContent = 'Önceki figürünüz yükleniyor…'; sayacBasla(); izle(kayit.jobId);
    }
}
/* Geçmişten bir figürü aç: kayıt yazılır, ürün sayfası açılınca figurAc işi sunucudan geri getirir. Üretim sürüyorsa false */
export function figurIsYukle(id) {
    if (st && st.uretim) return false;
    if (st) { if (st.unsub) st.unsub(); sayacDur(); vTemizle(); st = null; }
    try { sessionStorage.setItem(SSKEY, JSON.stringify({ jobId: id })); } catch (e) { /* özel mod */ }
    return true;
}
/* Geçmişten silinen iş şu an ekrandaysa ekranı sıfırla */
export function figurIsSilindi(id) {
    if (!st || st.jobId !== id || st.uretim) return;
    vTemizle(); st = null; try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
    girisTemizle(); gorunum('giris'); olusturDurum();
}
/* Uzun süre arka planda kalan sekmede tarayıcı WebGL bağlamını bırakmış olabilir (özellikle telefon): görünür olunca önizleme yeniden kurulur (model önbellekten gelir) */
let gizliT = 0;
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { gizliT = Date.now(); return; }
    if (gizliT && Date.now() - gizliT > 30000 && st && st.bitti && st.viewer && !$('#figur-panel').hidden) { vTemizle(); viewerAc(); }
    gizliT = 0;
});
export function figurKapat() {
    const p = $('#figur-panel'); if (p) p.hidden = true;
    vitrinKapat();
    if (st && st.viewer) { vTemizle(); }   // WebGL bağlamı boşa tutulmasın; dönülünce figurAc yeniden açar
    if (st && st.jobId && (st.uretim || st.bitti)) return;   // üretim sürüyorsa yoklama sürer
    if (st && st.unsub) st.unsub(); sayacDur(); st = null;
}
export const figurSecim = () => (st && st.bitti ? { jobId: st.jobId, cizgiUrl: st.cizgiUrl, tarif: st.tarif || '' } : null);
export const figurBekliyor = () => !!st && !st.bitti && !!st.jobId;
