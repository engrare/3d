/* Fotoğraftan 3B büst paneli (ürün 4): fotoğraf seç -> tarayıcıda küçült -> portre sunucusuna yolla -> işi yokla ->
   çizgi film + döndürülebilir 3B önizleme (portre-viewer.js, tembel yüklenir). Firebase'e BAĞLI DEĞİL: her şey GPU sunucusunda
   (edit-api.engrare.com/api/portre/*, kaynak portre-worker/sunucu.py). Sunucu kapalıysa panel "bizden kaynaklı bir sorun" der.
   myScript.js `portreKur` ile yalnızca renk köprüsünü verir. Sepet/sipariş doğrulaması: functions/index.js (attachPortre). */
const API = (window.PORTRE_API || 'https://edit-api.engrare.com') + '/api/portre';
const KAPALI_MESAJ = 'Şu an stokta yok. Stoklar yarın yenilenecek.';
let K = null;                       // köprü: { renk }
let st = null;                      // { jobId, kisi, dosya (Blob), onceki, bitti, cizgiUrl, modelUrl, unsub, viewer, fark }
const $ = (s) => document.querySelector(s);
const SSKEY = 'engrare_portre';
const MODLAR = ['hizli', 'dengeli', 'kalite'];   // sunucu portre-worker/sunucu.py MODLAR ile aynı; kaydırıcı 1-3
const MOD_BILGI = {
    hizli: { ad: 'Hızlı', sure: 'yaklaşık 30-40 sn', not: 'Fotoğrafınızdan doğrudan 3B büst. En hızlısı; yüz ayrıntıları en sade olanıdır.' },
    dengeli: { ad: 'Dengeli', sure: 'yaklaşık 1 dk', not: 'Çizgi film karakterine çevrilip 3B büst yapılır; fotoğrafınıza uygunluğu otomatik denetlenir.' },
    kalite: { ad: 'En kaliteli', sure: 'tek kişi yaklaşık 1,5 dk · çift yaklaşık 2,5 dk (iki seçenek; ilki yaklaşık 40 sn içinde)', not: 'Yeni nesil yapay zekayla en ayrıntılı yüz.' }
};

const ADIM_METIN = {
    kadraj: 'Fotoğrafınız hazırlanıyor…',
    cizgi: 'Büstünüz tasarlanıyor…',
    cizgi_hazir: 'Büstünüz 3B modele dönüştürülüyor…',
    model: 'Büstünüz 3B modele dönüştürülüyor…'
};
// Çubuk, işçiden gelen yüzdeye (aşama başı) takılıp durmasın diye aşama içinde yavaşça ilerler: aşama -> en çok varacağı yüzde
const ADIM_TAVAN = { kadraj: 14, cizgi: 54, cizgi_hazir: 64, model: 96 };
/* Sunucu çağrısı. Ağ/sunucu hatası ya da Cloudflare hata sayfası (JSON değil) -> e.kapali; sunucunun kendi mesajı ({hata}) -> e.sunucu */
async function api(yol, secenek, sure) {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), sure || 12000);
    try {
        const r = await fetch(API + yol, { ...(secenek || {}), signal: ac.signal });
        let d = null;
        try { d = await r.json(); } catch (e) { /* JSON değil */ }
        if (!r.ok || !d) {
            const err = new Error((d && d.hata) || KAPALI_MESAJ); err.durum = r.status;
            if (d && d.hata) err.sunucu = true; else err.kapali = true;
            throw err;
        }
        return d;
    } catch (e) {
        if (e.sunucu || e.kapali) throw e;
        const err = new Error(KAPALI_MESAJ); err.kapali = true; throw err;
    } finally { clearTimeout(t); }
}
const dosyaUrl = (id, ad, surum) => `${API}/dosya/${id}/${ad}?v=${surum || 0}`;

const sureYaz = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let sayac = null;
function sayacBasla(t0) {
    sayacDur();
    st.t0 = t0 || Date.now();
    const bu = st;
    const tik = () => {
        if (st !== bu) return sayacDur();
        $('#portre-sure').textContent = sureYaz(Date.now() - bu.t0);
        const bar = $('#portre-bar-dolu'), cur = parseFloat(bar.style.width) || 0, tavan = ADIM_TAVAN[bu.adim];
        if (bu.durum === 'calisiyor' && tavan && cur < tavan) bar.style.width = (cur + (tavan - cur) * 0.025).toFixed(1) + '%';
        replikGuncelle(bu);
    };
    tik(); sayac = setInterval(tik, 1000);
}
function sayacDur() { if (sayac) { clearInterval(sayac); sayac = null; } }

/* Bekleme replikleri (portre-replik.js, sabit kütüphane): aşama ilerleme çubuğuyla ilerler, ~9 sn'de bir, aşamaya uygun rastgele bir replik */
let replikSoz = null;
const REPLIK_ARALIK = 9000;
function replikGuncelle(bu) {
    const kutu = $('#portre-replik'); if (!kutu) return;
    if (!replikSoz) { replikSoz = import('./portre-replik.js?v=2').catch(() => null); return; }
    replikSoz.then((m) => {
        if (!m || st !== bu || bu.bitti) return;
        const sira = !bu.jobId || bu.durum === 'sirada';
        const simdi = Date.now();
        // aşama süreye göre ilerler (çubuk model aşamasında 65'e sıçrayıp uzun süre orada kalır; esprilerin hepsi yine sırayla görünsün), çubuk ~bittiyse son söz gecikme replikleri
        const tahmin = bu.mod === 'kalite' ? (bu.kisi === 2 ? 140 : 80) : bu.mod === 'hizli' ? 40 : 65, gecen = (simdi - (bu.t0 || simdi)) / 1000;
        const yuzde = (parseFloat($('#portre-bar-dolu').style.width) || 0) >= 96 || gecen > tahmin * 1.15 ? 100 : Math.min(94, 100 * gecen / tahmin);
        const asama = sira ? 'sira' : m.asamaBul(yuzde);
        if (simdi - (bu.replikT || 0) < REPLIK_ARALIK) return;   // uzun aralık: söz okunabilsin, ekran kıpır kıpır olmasın
        const metin = m.sec(asama, bu.kisi === 2, bu.replikGosterilen || (bu.replikGosterilen = {}));
        bu.replikAsama = asama; bu.replikT = simdi;
        if (!metin) return;
        kutu.classList.remove('goster');
        setTimeout(() => { if (st === bu) { kutu.textContent = metin; kutu.classList.add('goster'); } }, 450);
    });
}

export function portreKur(kopru) {
    K = kopru;
    $('#portre-file').addEventListener('change', (e) => dosyaSec(e.target.files[0]));
    const drop = $('#portre-drop');
    ['dragenter', 'dragover'].forEach(o => drop.addEventListener(o, (e) => { e.preventDefault(); drop.classList.add('surukle'); }));
    ['dragleave', 'drop'].forEach(o => drop.addEventListener(o, (e) => { e.preventDefault(); drop.classList.remove('surukle'); }));
    drop.addEventListener('drop', (e) => dosyaSec(e.dataTransfer.files[0]));
    $('#portre-kisi').addEventListener('click', (e) => {
        const b = e.target.closest('[data-kisi]'); if (!b) return;
        document.querySelectorAll('#portre-kisi [data-kisi]').forEach(x => x.classList.toggle('active', x === b));
        if (st && st.bitti) bitenTemizle();   // kişi sayısı değişti: eski sonuç geçersiz, yeniden oluşturulmalı
    });
    modYaz('kalite');
    $('#portre-olustur').addEventListener('click', () => baslat(false));
    $('#portre-yeniden').addEventListener('click', () => baslat(true));
    $('#portre-iptal').addEventListener('click', iptalEt);
    $('#portre-yazi-uygula').addEventListener('click', yaziUygula);
    $('#portre-yazi').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (st && st.bitti) yaziUygula(); else e.target.blur(); } });
    $('#portre-kisi-duzelt-sonuc').addEventListener('click', () => kisiDuzelt());
    $('#portre-yeni-foto').addEventListener('click', () => { sifirla(); gorunum('giris'); });
    // üretim sürerken sayfadan çıkılırsa: tarayıcı uyarısı; yine de çıkılırsa üretim durur (GPU boşalsın)
    window.addEventListener('beforeunload', (e) => { if (st && st.uretim) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', () => {
        if (!st || !st.uretim) return;
        try { sessionStorage.removeItem(SSKEY); } catch (x) { /* özel mod */ }
        if (st.jobId) try { navigator.sendBeacon(`${API}/is/${st.jobId}/iptal`); } catch (x) { /* yok */ }
    });
    document.addEventListener('click', (e) => {
        if (e.target.closest('.diagonal-color-btn')) setTimeout(() => st && st.gor && Object.values(st.gor).forEach(g => g.viewer.renk(K.renk())), 0);
    });
}

const modSecili = () => 'kalite';   // kademe seçimi kaldırıldı (2026-11-07): herkes en kaliteli kademede üretir
function modYaz(mod) {
    const sn = $('#portre-sure-not');
    if (sn) sn.textContent = mod === 'kalite' ? (st && st.kisi === 2 ? '· yaklaşık 2,5 dk sürer' : '· yaklaşık 1,5 dk sürer') : `· ${MOD_BILGI[mod].sure} sürer`;
}
/* Kişi sayısı: durum + (gizli) seçici + sepet için tek doğru değer */
function kisiYaz(kisi) {
    if (st) st.kisi = kisi;
    document.querySelectorAll('#portre-kisi [data-kisi]').forEach(x => x.classList.toggle('active', Number(x.dataset.kisi) === kisi));
}
const kisiSecili = () => Number((document.querySelector('#portre-kisi .active') || {}).dataset?.kisi) === 2 ? 2 : 1;
const KISI_AD = { 1: 'tek kişilik büst', 2: 'çift büst' };
/* Fotoğrafın altındaki not: algılanan kişi sayısı + "yanlışsa tıklayın" (bağlantıya basınca özel pencere açılır) */
function kisiNotYaz(durum) {
    const n = $('#portre-kisi-not'); if (!n) return;
    n.hidden = durum === 'yok' || (durum !== 'bekle' && (!st || !st.kisi));
    n.classList.toggle('dogru', durum === 'algi' || durum === 'secim');
    if (durum === 'bekle') { n.textContent = 'Fotoğraftaki kişi sayısı anlaşılıyor…'; return; }
    if (durum === 'yok' || !st || !st.kisi) { n.textContent = ''; return; }
    const k = st.kisi, ad = KISI_AD[k];
    n.innerHTML = '';
    const metin = durum === 'secim' ? `Kişi sayısı olarak <b>${k === 2 ? 'iki kişi' : 'tek kişi'}</b> seçtiniz: ${ad}.`
        : durum === 'yuzyok' ? `Fotoğrafta yüz seçemedik; <b>${ad}</b> yapacağız.`
        : `Fotoğrafta <b>${k === 2 ? 'iki kişi' : 'tek kişi'}</b> algıladık: ${ad}.`;
    n.insertAdjacentHTML('beforeend', metin + ' ');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'portre-link';
    b.textContent = durum === 'secim' ? 'Değiştirmek için tıklayın' : 'Yanlışsa tıklayın';
    b.addEventListener('click', () => kisiDuzelt());
    n.appendChild(b);
}
/* Site tasarımına uygun pencere: tek mi çift mi. Seçilen değer döner (vazgeçilirse null). Seçimden sonra müşterinin sözüne güvenilir (sunucu `kesin=1`) */
function kisiSor(mevcut) {
    return new Promise((coz) => {
        const m = document.createElement('div');
        m.className = 'modal-overlay confirm-dialog'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Fotoğraftaki kişi sayısı');
        m.innerHTML = `<div class="modal-content confirm-box portre-kisi-sor">
            <h3>Fotoğrafta kaç kişi var?</h3>
            <p>Doğru seçerseniz büstünüz fotoğrafınıza uygun yapılır. Seçtiğinize göre devam ederiz.</p>
            <div class="portre-kisi-secenek">
                <button type="button" data-k="1" class="${mevcut === 1 ? 'secili' : ''}"><i class="fa-solid fa-user"></i>Tek kişi<small>Tek kişilik büst</small></button>
                <button type="button" data-k="2" class="${mevcut === 2 ? 'secili' : ''}"><i class="fa-solid fa-user-group"></i>İki kişi<small>Çift (sevgililer) büst</small></button>
            </div>
            <div class="confirm-actions"><button type="button" class="btn-sm" data-iptal>Vazgeç</button></div>
        </div>`;
        document.body.appendChild(m);
        const bitir = (v) => { document.removeEventListener('keydown', tus); m.classList.remove('open'); setTimeout(() => m.remove(), 300); coz(v); };
        const tus = (e) => { if (e.key === 'Escape') bitir(null); };
        m.addEventListener('click', (e) => {
            if (e.target === m || e.target.closest('[data-iptal]')) return bitir(null);
            const b = e.target.closest('[data-k]'); if (b) bitir(Number(b.dataset.k));
        });
        document.addEventListener('keydown', tus);
        requestAnimationFrame(() => { m.classList.add('open'); const sec = m.querySelector('.secili') || m.querySelector('[data-k]'); sec && sec.focus(); });
    });
}
/* "Yanlışsa tıklayın": seçim yapılmadan önce yalnız not değişir; iş bitmişse farklı seçimde aynı fotoğrafla yeniden oluşturulur */
async function kisiDuzelt() {
    if (!st) return;
    const yeni = await kisiSor(st.kisi === 2 ? 2 : 1);
    if (!yeni || !st) return;
    if (st.bitti || st.jobId) {
        if (yeni === st.kisi) { st.kisiTamam = true; return; }
        return baslat(true, yeni);
    }
    kisiYaz(yeni); st.kisiTamam = true; kisiNotYaz('secim');
}
/* Fotoğraf seçilir seçilmez (iş açmadan) sunucu tek/çift algılar */
async function kisiAlgila(bu) {
    kisiNotYaz('bekle');
    let r = null;
    try { r = await api('/kisi', { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: bu.dosya }, 20000); } catch (e) { /* algılanamadı: oluştururken sunucu yine algılar */ }
    if (st !== bu || bu.kisiTamam) return;   // başka fotoğraf seçildi ya da müşteri kendisi seçti
    if (r && (r.kisi === 1 || r.kisi === 2)) { kisiYaz(r.kisi); kisiNotYaz(r.yuz === 0 ? 'yuzyok' : 'algi'); }
    else kisiNotYaz('yok');
}
function gorunum(ad) {
    $('#portre-kapali').hidden = ad !== 'kapali';
    $('#portre-giris').hidden = ad !== 'giris';
    $('#portre-surec').hidden = ad !== 'surec';
    $('#portre-sonuc').hidden = ad !== 'sonuc';
    $('#portre-yazi-kutu').hidden = ad !== 'giris' && ad !== 'sonuc';   // kaide yazısı: üretimden önce ve sonra düzenlenir
    $('#portre-yazi-uygula').hidden = ad !== 'sonuc';
}
/* Kaide yazısı (≤24 karakter, serbest; kabartma olarak ağa sunucuda eklenir). Büst hazırsa "Uygula" önizlemeyi yeniden üretir */
const yaziDeger = () => ($('#portre-yazi').value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
async function yaziUygula() {
    const bu = st; if (!bu || !bu.bitti || !bu.jobId) return;
    const y = yaziDeger(), not = $('#portre-yazi-not'), btn = $('#portre-yazi-uygula');
    if (y === (bu.yazi || '')) { not.textContent = y ? 'Bu yazı zaten uygulandı.' : ''; return; }
    btn.disabled = true; not.textContent = 'Yazı kaideye işleniyor…'; hata('');
    try {
        const r = await api(`/is/${bu.jobId}/yazi?yazi=${encodeURIComponent(y)}`, { method: 'POST' }, 60000);
        if (st !== bu) return;
        bu.yazi = r.yazi || ''; bu.jobSurum = r.modelSurum || bu.jobSurum;
        not.textContent = bu.yazi ? 'Yazı kaideye eklendi; döndürüp kontrol edebilirsiniz.' : 'Yazı kaldırıldı.';
        viewerAc();
        window.portreDegisti && window.portreDegisti();
    } catch (e) { not.textContent = ''; if (st === bu) hata(e.sunucu ? e.message : 'Yazı eklenemedi. Lütfen tekrar deneyin.'); }
    finally { btn.disabled = false; }
}
function hata(m) { const h = $('#portre-hata'); h.textContent = m || ''; h.hidden = !m; }

function rastgeleId() {
    const a = new Uint8Array(15); crypto.getRandomValues(a);
    return Array.from(a, b => b.toString(36).padStart(2, '0')).join('').slice(0, 24);
}

/* Fotoğraf: EXIF yönü uygulanır, en uzun kenar 1280 px'e küçülür, JPEG'e çevrilir (EXIF/konum silinir; yükleme hızlı kalır) */
async function kucult(file) {
    let bmp;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch (e) {
        bmp = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(file); });
    }
    const w0 = bmp.width, h0 = bmp.height, k = Math.min(1, 1280 / Math.max(w0, h0));
    const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('jpeg')), 'image/jpeg', 0.9));
}

async function dosyaSec(file) {
    hata('');
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) return hata('Lütfen bir fotoğraf (JPEG, PNG) seçin.');
    try {
        const blob = await kucult(file);
        if (blob.size > 4 * 1024 * 1024) return hata('Fotoğraf çok büyük. Daha küçük bir fotoğraf deneyin.');
        sifirla();
        st = { dosya: blob };
        const im = $('#portre-foto-onizleme'); im.src = URL.createObjectURL(blob); im.hidden = false;
        $('#portre-drop').classList.add('dolu');
        $('#portre-olustur').disabled = false;
        kisiAlgila(st);
    } catch (e) { hata('Fotoğraf okunamadı. Başka bir fotoğraf deneyin (JPEG ya da PNG).'); }
}

function bitenTemizle() {
    if (!st) return;
    if (st.unsub) st.unsub();
    vTemizle(st);
    st.viewer = null; st.bitti = false; st.unsub = null;
    try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
    $('#portre-viewer').innerHTML = ''; $('#portre-secenek').hidden = true;
    gorunum('giris');
    window.portreDegisti && window.portreDegisti();
}
function sifirla() {
    bitenTemizle();
    st = null; hata('');
    $('#portre-file').value = ''; $('#portre-foto-onizleme').hidden = true; $('#portre-foto-onizleme').removeAttribute('src');
    $('#portre-drop').classList.remove('dolu'); $('#portre-olustur').disabled = true;
    $('#portre-bar-dolu').style.width = '0'; sayacDur();
    kisiNotYaz('yok');
}

/* Sunucu kapalı: yükleme alanı gizlenir, tek mesaj gösterilir (üretim de yapılamaz) */
function kapaliGoster() {
    sayacDur();
    if (st && st.unsub) { st.unsub(); st.unsub = null; }
    try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
    gorunum('kapali');
}
/* Panel açılırken sunucunun ayakta olduğunu denetler; kapalıysa kullanıcı boşuna fotoğraf seçmesin */
async function saglikKontrol() {
    try { await api('/saglik', {}, 7000); } catch (e) { if (!st) kapaliGoster(); return false; }
    if (!$('#portre-kapali').hidden && !st) gorunum('giris');   // sunucu geri geldi
    return true;
}

async function baslat(yeniden, kisiYeni) {
    hata('');
    if (!st) return;
    const kisi = kisiYeni || (st.kisi ? st.kisi : kisiSecili());
    const mod = yeniden && st.mod ? st.mod : modSecili();   // "başka bir tane dene" aynı kademede kalır
    const btn = $('#portre-olustur'); btn.disabled = true;
    const onceki = yeniden ? st.jobId : undefined;
    const dosya = st.dosya;
    if (st.unsub) st.unsub();
    vTemizle(st);
    const kesin = !!(kisiYeni || st.kisiTamam || st.kisi);   // algı gösterildi (ve düzeltme imkânı verildi): müşterinin onayladığı değere güvenilir
    st = { dosya, kisi, mod, onceki, bitti: false, kisiTamam: true, uretim: true };
    modYaz(mod); seritGuncelle();
    $('#portre-viewer').innerHTML = '';
    $('#portre-bar-dolu').style.width = '2%';
    $('#portre-durum').textContent = 'Fotoğraf yükleniyor…';
    const rk = $('#portre-replik'); rk.textContent = ''; rk.classList.remove('goster');
    const ib = $('#portre-iptal'); ib.disabled = false; ib.textContent = 'Üretimi iptal et';
    gorunum('surec'); sayacBasla();
    try {
        const r = onceki ? await api(`/is?kisi=${kisi}&mod=${mod}&kaynak=${onceki}&kesin=1&yazi=${encodeURIComponent(yaziDeger())}`, { method: 'POST' })
            : await api(`/is?kisi=${kisi}&mod=${mod}&kesin=${kesin ? 1 : 0}&yazi=${encodeURIComponent(yaziDeger())}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: dosya }, 90000);
        st.jobId = r.id;
        if (st.iptalIstendi) return iptalEt();   // yükleme sürerken iptale basılmıştı: iş açıldı, şimdi iptal edilir
        if (r.kisi === 1 || r.kisi === 2) kisiYaz(r.kisi);   // sunucu fotoğraftan tek/çift algıladı (seçici gizli, yalnız yedek)
        try { sessionStorage.setItem(SSKEY, JSON.stringify({ jobId: st.jobId, kisi, mod })); } catch (e) { /* özel mod */ }
        izle(st.jobId);
    } catch (e) {
        if (e.kapali) return kapaliGoster();
        gorunum('giris'); btn.disabled = false; sayacDur(); st.uretim = false; seritGuncelle();
        hata(e.message || 'Yükleme başarısız. İnternet bağlantınızı kontrol edip tekrar deneyin.');
    }
}

/* Üretimi iptal: sunucu bekleyen işi siler, çalışanı durdurur (GPU boşalır). Sonra aynı fotoğrafla yeniden başlanabilir.
   Yükleme sürerken basılırsa iş açılınca iptal edilir. Sunucu "iptal edilemedi" derse (iş tam bitti) normal akış sürer. */
async function iptalEt() {
    const bu = st; if (!bu || bu.bitti) return;
    const btn = $('#portre-iptal'); btn.disabled = true; btn.textContent = 'İptal ediliyor…';
    bu.iptalEdiliyor = true;
    if (!bu.jobId) { bu.iptalIstendi = true; return; }
    let r = null;
    try { r = await api(`/is/${bu.jobId}/iptal`, { method: 'POST' }, 15000); }
    catch (e) {
        if (st !== bu) return;
        bu.iptalEdiliyor = false; bu.iptalIstendi = false; btn.disabled = false; btn.textContent = 'Üretimi iptal et';
        if (bu.unsub) bu.unsub(); izle(bu.jobId);   // yoklama iptal sırasında susmuş olabilir
        return hata(e.kapali ? KAPALI_MESAJ : (e.sunucu ? e.message : 'İptal edilemedi. Lütfen tekrar deneyin.'));
    }
    if (st !== bu) return;
    if (!r.iptal) {   // iş bu arada bitti/başarısız oldu: normal akış devam
        bu.iptalEdiliyor = false; bu.iptalIstendi = false; btn.disabled = false; btn.textContent = 'Üretimi iptal et';
        if (bu.unsub) bu.unsub(); izle(bu.jobId);
        return;
    }
    if (bu.unsub) { bu.unsub(); bu.unsub = null; }
    sayacDur(); bu.uretim = false;
    try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
    if (bu.dosya) {   // fotoğraf hâlâ elimizde: giriş ekranına aynı fotoğrafla dön
        vTemizle(bu);
        st = { dosya: bu.dosya, kisiTamam: true };
        $('#portre-viewer').innerHTML = ''; $('#portre-secenek').hidden = true;
        $('#portre-bar-dolu').style.width = '0';
        gorunum('giris'); $('#portre-olustur').disabled = false;
    } else { sifirla(); gorunum('giris'); }
    seritGuncelle();
    window.portreDegisti && window.portreDegisti();
}

/* İşi sunucudan yoklar (1,5-3 sn). Art arda 5 başarısız yoklamada sunucu kapalı sayılır; iş bulunamazsa (404) süresi dolmuştur. */
function izle(jobId) {
    const mevcut = st;
    let ilk = false, ardarda = 0, zamanlayici = null, dur = false;
    st.unsub = () => { dur = true; clearTimeout(zamanlayici); };
    const hatali = (m, kapali) => {
        if (st !== mevcut || mevcut.iptalEdiliyor) return;   // iptal sürerken iş silinmiş olabilir (404): hata gösterme
        st.unsub(); st.unsub = null; sayacDur(); st.uretim = false; seritGuncelle();
        try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ }
        if (st.erken) { st.erken = false; eylemGizle(false); vTemizle(st); $('#portre-viewer').innerHTML = ''; $('#portre-secenek').hidden = true; }
        if (kapali) return kapaliGoster();
        gorunum('giris'); $('#portre-olustur').disabled = !(st && st.dosya); hata(m);
    };
    const tur = async () => {
        if (dur || st !== mevcut) return;
        let j;
        try { j = await api(`/is/${jobId}`, {}, 10000); ardarda = 0; }
        catch (e) {
            if (dur || st !== mevcut) return;
            if (e.durum === 404) return hatali('Önceki büstünüz bulunamadı (süresi dolmuş olabilir). Fotoğrafınızı yeniden yükleyin.');
            if (++ardarda >= 5) return hatali(KAPALI_MESAJ, true);
            zamanlayici = setTimeout(tur, 2000); return;
        }
        if (dur || st !== mevcut) return;
        if (!ilk) {
            ilk = true;
            // sayaç sunucu saatine göre (kullanıcının saati yanlış olabilir): fark = sunucu - yerel
            st.fark = j.simdi ? j.simdi - Date.now() : 0;
            if (!st.t0 || (j.olusturma && st.geriYuklendi)) sayacBasla(j.olusturma ? j.olusturma - st.fark : undefined);
        }
        st.durum = j.durum; st.adim = j.adim;
        if (j.durum === 'sirada') {
            $('#portre-durum').textContent = j.sira > 1 ? `Sıradasınız: ${j.sira}. sıra` : 'Sıra size geldi, başlıyoruz…';
            $('#portre-bar-dolu').style.width = '5%';
        } else if (j.durum === 'calisiyor') {
            $('#portre-durum').textContent = ADIM_METIN[j.adim] || 'Büstünüz hazırlanıyor…';
            const w = Math.max(5, Math.min(97, j.yuzde || 5)), bar = $('#portre-bar-dolu');
            if (w > (parseFloat(bar.style.width) || 0)) bar.style.width = w + '%';
            if (j.hazir && j.modelVar && !st.erken) erkenGoster(j);   // çift büst: 1. seçenek hazır, 2. seçenek sürerken gösterilir
        } else if (j.durum === 'hata') {
            return hatali(j.hata || 'Büst oluşturulamadı. Başka bir fotoğraf deneyin.');
        } else if (j.durum === 'bitti' && j.modelVar) {
            st.unsub(); st.unsub = null;
            st.sureMs = (j.bitis && j.olusturma && j.bitis > j.olusturma) ? j.bitis - j.olusturma : Date.now() - st.t0; sayacDur();
            return bitti(j);
        }
        zamanlayici = setTimeout(tur, j.durum === 'sirada' ? 3000 : 1500);
    };
    tur();
}

/* Çift büst, 1. seçenek hazır (iş sürüyor): sonuç ekranı açılır, 2. seçenek sekmesinde üretim animasyonu görünür */
/* 2. seçenek sürerken "Yeniden dene / Başka fotoğraf / kişi sayısı" gizli: çalışan işin fotoğrafı yeniden kullanılamaz */
function eylemGizle(g) { document.querySelectorAll('#portre-sonuc .portre-sonuc-eylem, #portre-sonuc .portre-kisi-not').forEach(x => { x.hidden = g; }); }
async function erkenGoster(j) {
    const bu = st; if (!bu || bu.erken) return;
    bu.erken = true; eylemGizle(true); bu.kisi = j.kisi === 2 ? 2 : 1; bu.secenekler = 2; bu.secili = 1; bu.jobSurum = j.modelSurum; bu.jobId = j.id;
    bu.cizgiUrl = j.cizgiVar ? dosyaUrl(j.id, 'cizgi.jpg', j.cizgiSurum) : null;
    $('#portre-bitti-sure').textContent = 'Çift büst (iki kişi). 1. seçenek hazır; 2. seçenek hazırlanıyor, hazır olunca sekmesinden görebilirsiniz.';
    try {
        bu.vm = await import('./portre-viewer.js?v=2');
        if (st !== bu) return;
        gorunum('sonuc'); secenekSekme(); viewerAc();
    } catch (e) { bu.erken = false; return; }
    seritGuncelle(); window.portreDegisti && window.portreDegisti();
}
async function bitti(j) {
    const erkendi = !!st.erken, bakilan = st.bakilan;
    st.uretim = false; st.erken = false; st.bakilan = null; eylemGizle(false);
    st.goruldu = !$('#portre-panel').hidden;   // "hazır" uyarısı yalnız sayfa dışındayken biten üretim için
    st.olusturma = j.olusturma; st.yazi = j.yazi || '';
    if (document.activeElement !== $('#portre-yazi')) $('#portre-yazi').value = st.yazi; $('#portre-yazi-not').textContent = '';
    st.bitti = true; st.kisi = j.kisi === 2 ? 2 : 1; if (MODLAR.includes(j.mod)) st.mod = j.mod;
    st.cizgiUrl = j.cizgiVar ? dosyaUrl(j.id, 'cizgi.jpg', j.cizgiSurum) : null;   // yalnız sepet/sipariş küçük resmi için; müşteriye gösterilmez
    $('#portre-bar-dolu').style.width = '100%';
    $('#portre-durum').textContent = 'Büstünüz hazır, önizleme açılıyor…';
    kisiYaz(st.kisi);
    $('#portre-bitti-sure').textContent = (st.sureMs ? `Büstünüz ${sureYaz(st.sureMs)} sürede hazırlandı. ` : '') + (st.kisi === 2 ? 'Çift büst (iki kişi).' : 'Tek kişilik büst.');
    st.secenekler = Math.max(1, Math.min(4, Number(j.secenekler) || 1)); st.secili = Math.max(1, Math.min(st.secenekler, Number(j.secili) || 1)); st.jobSurum = j.modelSurum; st.jobId = j.id;
    if (erkendi && st.gor && !j.yazi) Object.values(st.gor).forEach(g => { g.surum = st.jobSurum; });   // dosya aynı; yalnız önbellek numarası değişti, yeniden yükleme
    const bu = st;
    try {
        bu.vm = bu.vm || await import('./portre-viewer.js?v=2');
        if (st !== bu) return;
        gorunum('sonuc');
        secenekSekme();
        if (erkendi && bu.viewer && bu.secenekler > 1 && !bakilan) { /* 1. seçenek zaten ekranda */ }
        else if (bakilan === 2 && bu.secenekler > 1) { bu.secili = 1; bu.sec = false; secenekSec(2); }   // 2. seçeneğin başında bekleyen müşteriye hazır olunca açılır
        else viewerAc();
    } catch (e) { gorunum('sonuc'); hata('3B önizleme bu cihazda açılamadı. Tarayıcınızı güncelleyin.'); }
    seritGuncelle();
    if (K && K.kaydet) K.kaydet(j.id, j.olusturma);   // giriş yapmış üyenin hesabına
    window.portreDegisti && window.portreDegisti();
}
/* Seçilen seçeneğin 3B önizlemesi (tek seçenekte model.glb, çoklu seçenekte model-N.glb) */
function viewerAc() {
    const bu = st; if (!bu || !bu.vm) return;
    if ($('#portre-panel').hidden) return;   // sayfa dışındayken 3B bağlam açılmaz; portreAc döndüğünde açar
    const ad = bu.secenekler > 1 ? `model-${bu.secili}.glb` : 'model.glb';
    bu.gor = bu.gor || {};
    const kap = $('#portre-viewer');
    kap.querySelectorAll('.portre-bekle').forEach(x => x.remove());
    // her seçeneğin görüntüleyicisi bir kez kurulur; sekme değişince yalnız gösterilir/gizlenir (yeniden yüklenmez)
    for (const k in bu.gor) { const g = bu.gor[k]; const ac = k === ad; g.el.hidden = !ac; g.viewer.durdur(!ac); }
    const var_ = bu.gor[ad];
    if (var_ && var_.surum === bu.jobSurum) { bu.viewer = var_.viewer; return; }
    if (var_) { var_.viewer.yoket(); var_.el.remove(); delete bu.gor[ad]; }   // model sürümü değişti: yenisini yükle
    const el = document.createElement('div'); el.className = 'portre-view-alt'; kap.appendChild(el);
    const v = bu.vm.goster(el, dosyaUrl(bu.jobId, ad, bu.jobSurum), K.renk(), (err) => { if (err) hata('3B önizleme yüklenemedi. Sayfayı yenileyip tekrar deneyin.'); });
    bu.gor[ad] = { el, viewer: v, surum: bu.jobSurum }; bu.viewer = v;
}
/* Tüm seçeneklerin görüntüleyicilerini kapatır (WebGL bağlamları boşalsın) */
function vTemizle(s) {
    if (!s) return;
    for (const k in (s.gor || {})) { try { s.gor[k].viewer.yoket(); } catch (e) { /* kapalı */ } }
    s.gor = {}; if (s.viewer) { try { s.viewer.yoket(); } catch (e) { /* kapalı */ } } s.viewer = null;
}
/* Çift büstte iki seçenek: sekmeye basınca sunucuya seçim yazılır (sipariş bu seçenekten hazırlanır); yazılamazsa sekme değişmez */
function secenekSekme() {
    const kutu = $('#portre-secenek'), sekme = $('#portre-secenek-sekme');
    kutu.hidden = st.secenekler < 2; sekme.innerHTML = '';
    if (st.secenekler < 2) return;
    for (let i = 1; i <= st.secenekler; i++) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'custom-object-tab' + (i === st.secili ? ' active' : '');
        const gor = st.bakilan || st.secili;
        b.classList.toggle('active', i === gor);
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', i === gor ? 'true' : 'false'); b.textContent = `${i}. seçenek`; b.dataset.n = i;
        if (st.erken && i === 2) { b.classList.add('bekliyor'); b.insertAdjacentHTML('beforeend', ' <i class="fa-solid fa-spinner fa-spin"></i>'); }
        b.addEventListener('click', () => secenekSec(i));
        sekme.appendChild(b);
    }
}
/* 2. seçenek henüz üretilirken: görüntüleyicinin yerine yapay zeka animasyonu */
function bekleyenGoster() {
    const bu = st; if (!bu) return;
    const kap = $('#portre-viewer');
    for (const k in (bu.gor || {})) { bu.gor[k].el.hidden = true; bu.gor[k].viewer.durdur(true); }   // 1. seçenek bellekte kalır, yalnız gizlenir
    if (kap.querySelector('.portre-bekle')) return;
    const ai = document.querySelector('#portre-surec .portre-ai');
    kap.insertAdjacentHTML('beforeend', `<div class="portre-bekle">${ai ? ai.outerHTML : ''}<div class="portre-durum">2. seçenek hazırlanıyor…</div><p class="portre-replik goster">Hazır olunca burada kendiliğinden açılır.</p></div>`);
}
function sekmeVurgu(n) {
    document.querySelectorAll('#portre-secenek-sekme [data-n]').forEach(b => { const a = Number(b.dataset.n) === n; b.classList.toggle('active', a); b.setAttribute('aria-selected', a ? 'true' : 'false'); });
}
async function secenekSec(n) {
    const bu = st; if (!bu) return;
    if (bu.erken) {   // iş sürüyor: sunucuya seçim yazılmaz, yalnız hangi sekmeye bakıldığı değişir
        bu.bakilan = n === 2 ? 2 : null; sekmeVurgu(n);
        if (n === 2) bekleyenGoster(); else viewerAc();
        return;
    }
    if (bu.bakilan) { bu.bakilan = null; }
    if (n === bu.secili || bu.sec) return;
    bu.sec = true; hata('');
    try {
        const r = await api(`/is/${bu.jobId}/sec?v=${n}`, { method: 'POST' });
        if (st !== bu) return;
        bu.secili = n; bu.jobSurum = r.modelSurum || bu.jobSurum;
        sekmeVurgu(n);
        viewerAc();
    } catch (e) { if (st === bu) hata(e.sunucu ? e.message : 'Seçiminiz kaydedilemedi. Lütfen tekrar deneyin.'); }
    finally { bu.sec = false; }
}

/* Ürün sayfası açılınca/kapanınca (myScript.js) */
export async function portreAc() {
    if (!K) return;
    document.querySelector('#portre-panel').hidden = false;
    if (st && st.bitti) { st.goruldu = true; if (K.kaydet && st.jobId) K.kaydet(st.jobId, st.olusturma); }
    seritGuncelle();
    if (st) {
        if (st.viewer) Object.values(st.gor || {}).forEach(g => g.viewer.renk(K.renk()));
        else if (st.vm && (st.bitti || (st.erken && !st.bakilan))) viewerAc();   // sayfadan ayrılıkken biten/erken açılan sonuç
        else if (st.bakilan) bekleyenGoster();
        return;
    }
    if (!(await saglikKontrol()) || st) return;
    // sayfa yenilendiyse biten işi geri getir
    let kayit = null;
    try { kayit = JSON.parse(sessionStorage.getItem(SSKEY) || 'null'); } catch (e) { /* bozuk */ }
    if (kayit && kayit.jobId) {
        st = { jobId: kayit.jobId, kisi: kayit.kisi, mod: MODLAR.includes(kayit.mod) ? kayit.mod : undefined, bitti: false, geriYuklendi: true, uretim: true };
        if (st.mod) modYaz(st.mod);
        document.querySelectorAll('#portre-kisi [data-kisi]').forEach(x => x.classList.toggle('active', Number(x.dataset.kisi) === kayit.kisi));
        gorunum('surec'); $('#portre-durum').textContent = 'Önceki büstünüz yükleniyor…'; sayacBasla();
        izle(kayit.jobId);
    }
}
export function portreKapat() {
    const p = document.querySelector('#portre-panel'); if (p) p.hidden = true;
    // 3B bağlam (WebGL) boşa tutulmasın; ürüne dönülünce portreAc kayıtlı işi yeniden yükler
    vTemizle(st);
    $('#portre-viewer').innerHTML = '';
    // üretim sürüyorsa yoklama ve sayaç durmaz (üstteki şerit durumu gösterir, basılınca büst sayfasına dönülür)
    if (st && st.jobId && (st.uretim || (st.bitti && !st.goruldu))) { seritGuncelle(); return; }
    if (st && st.unsub) st.unsub();
    sayacDur();
    // kayıtlı iş (sessionStorage) varsa portreAc geri getirir; henüz işe dönmemiş seçili fotoğraf bu durumda sıfırlanır
    if (st && !st.jobId) sifirla(); else st = null;
    seritGuncelle();
}
/* Sepete eklemek için: biten iş yoksa null */
export function portreSecim() {
    return st && st.bitti ? { jobId: st.jobId, kisi: st.kisi, cizgiUrl: st.cizgiUrl, secenek: st.secili || 1, yazi: st.yazi || '' } : null;
}
/* Menüler arasında gezerken üstte üretim şeridi: sayfa dışındayken üretim sürüyorsa süre, bittiyse "hazır"; basınca büst sayfasına gider */
let serit = null, seritT = null;
function seritGuncelle() {
    const panel = document.querySelector('#portre-panel');
    const disarida = !!panel && panel.hidden;
    const goster = disarida && st && st.jobId && (st.uretim || (st.bitti && !st.goruldu));
    if (!goster) {
        if (serit) serit.hidden = true;
        document.body.classList.remove('portre-seritli');
        if (seritT) { clearInterval(seritT); seritT = null; }
        return;
    }
    if (!serit) {
        serit = document.createElement('button'); serit.type = 'button'; serit.className = 'portre-serit';
        serit.innerHTML = '<span class="portre-serit-nokta"></span><span class="portre-serit-metin"></span><b>Büste git ›</b>';
        serit.addEventListener('click', () => { window.portreGit && window.portreGit(); });
        document.body.appendChild(serit);
    }
    const yaz = () => {
        if (!st) return seritGuncelle();
        const m = serit.querySelector('.portre-serit-metin'), hazir = !st.uretim && st.bitti;
        serit.classList.toggle('hazir', hazir);
        m.textContent = hazir ? 'Büstünüz hazır!' : `Büstünüz hazırlanıyor · ${sureYaz(Date.now() - (st.t0 || Date.now()))}`;
        if (hazir && seritT) { clearInterval(seritT); seritT = null; }
    };
    serit.hidden = false; yaz();
    if (!seritT && st.uretim) seritT = setInterval(yaz, 1000);
}
export const portreBekliyor = () => !!st && !st.bitti && !!st.jobId;

/* Hesap geçmişinden bir işi aç: kayıt yazılır, ürün sayfası açılınca portreAc işi sunucudan geri getirir. Üretim sürüyorsa false */
export function portreIsYukle(id, kisi) {
    if (st && st.uretim) return false;
    if (st) { if (st.unsub) st.unsub(); vTemizle(st); st = null; }
    try { sessionStorage.setItem(SSKEY, JSON.stringify({ jobId: id, kisi: kisi === 2 ? 2 : 1, mod: 'kalite' })); } catch (e) { /* özel mod */ }
    return true;
}
/* Hesap > Büstlerim: kayıtlı işlerin durumunu sunucudan sorar; silinmiş işler (404) listeden ve hesaptan düşer */
const TARIH = (t) => new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
export async function portreIsSil(id) {
    await api(`/is/${id}/sil`, { method: 'POST' });
    K && K.unut && K.unut(id);
    if (st && st.jobId === id && !st.uretim) { vTemizle(st); st = null; try { sessionStorage.removeItem(SSKEY); } catch (e) { /* özel mod */ } $('#portre-viewer').innerHTML = ''; $('#portre-secenek').hidden = true; gorunum('giris'); }
}
const GECMIS_ADET = 3;
export async function gecmisCiz(kutu, kayit) {
    const idler = Object.keys(kayit || {}).sort((a, b) => kayit[b] - kayit[a]).slice(0, 30);
    kutu.innerHTML = '';
    if (!idler.length) return;
    let sira = 0;
    const daha = document.createElement('button'); daha.type = 'button'; daha.className = 'btn-sm bust-daha'; daha.textContent = 'Daha eskileri yükle';
    daha.addEventListener('click', async () => { daha.disabled = true; await ekle(); daha.disabled = false; });
    const kartCiz = (id, j) => {
        const kart = document.createElement('div'); kart.className = 'bust-kart';
        const hazir = j.durum === 'bitti' && j.modelVar;
        const kalan = Math.max(0, Math.ceil((j.silinme - (j.simdi || Date.now())) / 86400000));
        const img = j.cizgiVar ? `<img src="${dosyaUrl(id, 'cizgi.jpg', j.cizgiSurum)}" alt="" loading="lazy">` : '<img alt="">';
        const durum = !hazir ? '<small>Hazırlanıyor…</small>'
            : j.siparisli ? `<small class="tamam">Siparişe dönüştü · saklanma: ${TARIH(j.silinme)}</small>`
            : `<small class="${kalan <= 2 ? 'uyari' : ''}">Silinme: ${TARIH(j.silinme)} (${kalan > 0 ? kalan + ' gün kaldı' : 'bugün'})</small>`;
        kart.innerHTML = `${img}<div class="bust-kart-bilgi"><b>${j.kisi === 2 ? 'Çift büst' : 'Tek kişilik büst'}</b><small>${TARIH(j.olusturma)}</small>${durum}</div>`;
        const eylem = document.createElement('div'); eylem.className = 'bust-kart-eylem';
        if (hazir) {
            const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-sm bust-ac'; b.textContent = 'Aç';
            b.addEventListener('click', () => window.portreIsAc && window.portreIsAc(id, j.kisi));
            eylem.appendChild(b);
        }
        if (!j.siparisli && j.durum !== 'sirada' && j.durum !== 'calisiyor') {
            const s = document.createElement('button'); s.type = 'button'; s.className = 'btn-sm bust-sil'; s.textContent = 'Sil';
            s.addEventListener('click', () => window.portreIsSilSor && window.portreIsSilSor(id, kart));
            eylem.appendChild(s);
        }
        kart.appendChild(eylem);
        kutu.insertBefore(kart, daha.parentNode === kutu ? daha : null);
    };
    // her turda 3 kayıt gösterilir (sunucudan silinmiş olanlar atlanır)
    const ekle = async () => {
        let say = 0;
        while (say < GECMIS_ADET && sira < idler.length) {
            const grup = idler.slice(sira, sira + GECMIS_ADET - say); sira += grup.length;
            const sonuc = await Promise.all(grup.map(async (id) => {
                try { return { id, j: await api(`/is/${id}`, {}, 10000) }; }
                catch (e) { return { id, j: null, yok: e.durum === 404, kapali: !!e.kapali }; }
            }));
            if (sonuc.every(x => x.kapali)) { if (!kutu.querySelector('.bust-kart')) kutu.textContent = KAPALI_MESAJ; sira = idler.length; break; }
            for (const { id, j, yok } of sonuc) {
                if (yok || (j && j.durum === 'hata')) { K && K.unut && K.unut(id); continue; }   // sunucudan silinmiş / başarısız
                if (!j) continue;
                kartCiz(id, j); say++;
            }
        }
        if (sira < idler.length) kutu.appendChild(daha); else daha.remove();
    };
    await ekle();
}
