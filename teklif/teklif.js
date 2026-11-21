/* Müşteriye özel teklif sayfası (engrare.com/teklif/?t=<anahtar>; 2026-11-18). Yönetici WhatsApp'tan gelen müşteri için birkaç figür üretir,
   portre sunucusunda teklif kaydı açar (POST /api/portre/ic-teklif, X-Kopru) ve linki müşteriye verir. Müşteri seçenekleri 3B döndürür, birini ve boyunu
   seçer; sayfa ana sitenin sepetine (localStorage engrare_cart, addFigurToCart ile AYNI kalem biçimi) ekleyip ödeme sayfasına geçer. Tahsil edilen tutarı
   yine sunucu hesaplar (buildOrderItems + attachPortre: iş sunucuda doğrulanır, kaide yazısı işten okunur). Firebase'e bağlı değil.
   Site sahibi (?ben=1 ile işaretli tarayıcı) aynı linkte 3B önizlemeyi elle boyar (fırça/doldur/silgi; portre-viewer.js boyaAc) ve kaydeder
   (POST /api/portre/boya/<teklif>/<iş>, X-Boya anahtarı bu tarayıcıda bir kez girilir); kayıtlı boya müşteri dahil herkese önizlemede görünür
   (2026-11-19'dan beri boya baskı dosyasına da işlenir: indirilen renkli OBJ kayıtlı boyanın renklerini taşır, figur.boya_aktar). */
import { products, boyBul, boyFiyat } from '../products.js?v=25';

const API = (window.PORTRE_API || 'https://edit-api.engrare.com') + '/api/portre';
const $ = (s) => document.querySelector(s);
const fmt = (v) => '₺' + Math.round(Number(v) || 0).toLocaleString('tr-TR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BOY_ACIKLAMA = {   // myScript.js BOY_ACIKLAMA ile aynı
    5: 'yaklaşık bir kibrit kutusu boyu. Küçük boyda ince ayrıntılar sadeleşir.',
    8: 'yaklaşık bir kredi kartının uzun kenarı kadar; en dengeli boy.',
    10: 'yaklaşık bir çay bardağı boyu; ayrıntılar daha belirgin.',
    15: 'yaklaşık bir telefon boyu; raf ve vitrin için. Kargoya veriliş 1-2 iş günü uzayabilir.',
    20: 'yaklaşık A4 kağıdın kısa kenarı kadar; koleksiyon boyu. Kargoya veriliş 1-2 iş günü uzayabilir.'
};

// Site sahibi: ?ben=1 bir kez açılınca localStorage engrare_kendim=1 (ana sitedeki ile aynı; ?ben=0 kapatır). Boyama araçları yalnız bu tarayıcıda görünür.
const ben = (() => {
    const q = new URLSearchParams(location.search).get('ben');
    try { if (q === '1') localStorage.setItem('engrare_kendim', '1'); else if (q === '0') localStorage.removeItem('engrare_kendim'); return localStorage.getItem('engrare_kendim') === '1'; } catch (e) { return q === '1'; }
})();
// Adres sonundaki #boya=<anahtar>: anahtarı bu tarayıcıya yazar ve adresten siler (anahtar yalnız teklif önizlemesini boyamaya yarar)
if (ben) { try { const m = /(?:^|[#&])boya=([A-Za-z0-9]{16,80})/.exec(location.hash); if (m) { localStorage.setItem('engrare_boya_anahtar', m[1]); history.replaceState(null, '', location.pathname + location.search); } } catch (e) { /* yok */ } }
let boya = null, boyaKirli = false;   // boya: görüntüleyicinin boyama denetimi (yalnız site sahibi)
const BOYA_RENK = ['#c1121f', '#ff6b00', '#f5b800', '#111111', '#ffffff', '#6b3f1d', '#e8b99a', '#2563eb', '#16a34a'];
let teklif = null, secili = 0, boy = null, viewer = null, vm = null, yuklemeNo = 0;
const urun = () => products.find((p) => p.id === 5);
// Teklife özel boy fiyatı (teklif.fiyat = {cm: TL}); yalnız normal fiyattan düşükse geçerli (sunucu attachPortre de aynı kuralla uygular)
const fiyat = (p, cm) => { const v = teklif && teklif.fiyat ? teklif.fiyat[cm] : null; return Number.isInteger(v) && v > 0 && v <= boyFiyat(p, cm) ? v : boyFiyat(p, cm); };
const dosya = (s, ad) => `${API}/dosya/${s.id}/${ad}?v=${s.modelSurum || 0}`;

function hataGoster(m) {
    $('#tk-yukleniyor').hidden = true; $('#tk-icerik').hidden = true;
    const h = $('#tk-hata'); h.hidden = false;
    h.innerHTML = `${esc(m)}<br><a href="https://wa.me/905412989803" rel="noopener">WhatsApp'tan bize yazın</a>`;
}

async function yukle() {
    const t = new URLSearchParams(location.search).get('t') || '';
    if (!/^[A-Za-z0-9_-]{8,32}$/.test(t)) return hataGoster('Link eksik ya da hatalı.');
    let r;
    try { r = await fetch(`${API}/teklif/${t}`, { cache: 'no-store' }); } catch (e) { return hataGoster('Sunucumuza ulaşılamadı. Lütfen biraz sonra tekrar deneyin.'); }
    if (r.status === 404) return hataGoster('Bu link bulunamadı ya da süresi doldu.');
    if (!r.ok) return hataGoster('Bizden kaynaklı bir sorun oldu. Lütfen biraz sonra tekrar deneyin.');
    teklif = await r.json(); teklif.anahtar = t;
    const secenekler = (teklif.secenekler || []).filter((s) => s.urun === 'figur');
    teklif.secenekler = secenekler;
    if (!secenekler.length || !urun()) return hataGoster('Bu linkteki tasarımlar artık yok.');
    const p = urun();
    boy = boyBul(p, teklif.boy || p.boyVarsayilan).cm;
    if (teklif.baslik) { $('#tk-baslik').textContent = teklif.baslik; document.title = `${teklif.baslik} | Engrare`; }
    // elle boyanacak teklif (yönetici `boyama: "el"`): önizleme renkleri yalnız fikir verir; "basılacak renkler" metinleri değişir
    if (teklif.boyama === 'el') {
        $('#tk-boyama').hidden = false; $('#tk-palet-baslik').textContent = 'Önizleme renkleri';
        $('#tk-renk-bilgi').innerHTML = '<i class="fa-solid fa-circle-check"></i> Önizleme yapay zekâ çıktısıdır; son renkler elle boyamada verilir.';
    }
    if (teklif.not) { $('#tk-not').textContent = teklif.not; $('#tk-not').hidden = false; }
    $('#tk-secenek-sayi').textContent = `(${secenekler.length})`;
    $('#tk-secenekler').innerHTML = secenekler.map((s, i) => `
        <button type="button" class="tk-sec-kart" role="radio" aria-checked="false" data-i="${i}">
            ${s.cizgiVar ? `<img src="${esc(dosya(s, 'cizgi.jpg'))}" alt="Seçenek ${i + 1}" loading="lazy" decoding="async">` : '<span class="tk-sec-bos"><i class="fa-solid fa-cube"></i></span>'}
            <span class="tk-sec-no">Seçenek ${i + 1}</span>
        </button>`).join('');
    $('#tk-secenekler').addEventListener('click', (e) => { const b = e.target.closest('.tk-sec-kart'); if (b) sec(+b.dataset.i); });
    $('#tk-boylar').addEventListener('click', (e) => { const b = e.target.closest('.tk-boy'); if (b) { boy = +b.dataset.cm; fiyatCiz(); } });
    $('#tk-sec').addEventListener('click', sepeteEkle);
    if (teklif.silinme) $('#tk-sure').textContent = `Bu link ${new Date(teklif.silinme).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} tarihine kadar geçerlidir.`;
    $('#tk-yukleniyor').hidden = true; $('#tk-icerik').hidden = false;
    if (ben) boyaKur();
    fiyatCiz(); sec(0);
}

function fiyatCiz() {
    const p = urun();
    $('#tk-boylar').innerHTML = p.boylar.map((b) => `
        <button type="button" class="tk-boy${b.cm === boy ? ' secili' : ''}" role="radio" aria-checked="${b.cm === boy}" data-cm="${b.cm}">
            <strong>${b.cm} cm</strong><span>${fmt(fiyat(p, b.cm))}</span>
        </button>`).join('');
    $('#tk-boy-not').textContent = `${boy} cm: ${BOY_ACIKLAMA[boy] || ''}`;
    const f = fiyat(p, boy), normal = boyFiyat(p, boy);
    $('#tk-fiyat').textContent = fmt(f);
    // size özel fiyatta üstü çizili = sitedeki normal fiyat; yoksa panelin eski fiyatı
    $('#tk-eski-fiyat').textContent = f < normal ? fmt(normal) : p.oldPrice ? fmt(boyFiyat({ ...p, price: p.oldPrice }, boy)) : '';
    if (ben) baskiEtiketCiz();
}

async function sec(i) {
    if (boya && boyaKirli && i !== secili && !confirm('Bu seçenekte kaydedilmemiş boyama var. Kaydetmeden geçilsin mi?')) return;
    if (boya) { try { boya.kapat(); } catch (e) { /* kapalı */ } boya = null; }
    boyaKirli = false; boyaDurum('');
    secili = i;
    const s = teklif.secenekler[i];
    document.querySelectorAll('.tk-sec-kart').forEach((b, j) => { b.classList.toggle('secili', j === i); b.setAttribute('aria-checked', j === i); });
    $('#tk-secili-ad').textContent = `Seçenek ${i + 1}`;
    if (ben) { baskiEtiketCiz(); baskiDurum(''); }
    if (studyo) { $('#st-sec-ad').textContent = `Seçenek ${i + 1} / ${teklif.secenekler.length}`; renkleriCiz(); gecmisCiz(); }
    $('#tk-palet').innerHTML = s.boya ? '<span class="tk-renk-not">Bu önizleme ustamız tarafından elle boyanmıştır.</span>' : (s.palet || []).map((r) => `<span class="tk-renk"><i style="background:${/^#[0-9a-fA-F]{6}$/.test(r.hex) ? r.hex : '#888'}"></i>${esc(r.ad)}</span>`).join('');
    const yz = $('#tk-yazi'); yz.hidden = !s.yazi; if (s.yazi) yz.innerHTML = `Kaide yazısı: <strong>${esc(s.yazi)}</strong>`;
    $('#tk-sec').disabled = !!s.siparisli;
    $('#tk-sec-not').textContent = s.siparisli ? 'Bu seçenek için sipariş zaten verildi.' : 'Ödeme sayfasında adres bilgilerinizi girip kartla ya da havaleyle ödersiniz. Üyelik gerekmez.';
    // tek 3B görüntüleyici (telefonda çok sayıda WebGL bağlamı açmamak için): seçenek değişince eskisi kapanır
    const no = ++yuklemeNo, durum = $('#tk-viewer-durum');
    durum.hidden = false; durum.textContent = '3B model yükleniyor…';
    if (viewer) { try { viewer.yoket(); } catch (e) { /* kapalı */ } viewer = null; }
    $('#tk-viewer').innerHTML = '';
    try { vm = vm || await import('../portre-viewer.js?v=9'); } catch (e) { durum.textContent = '3B önizleme yüklenemedi. Sayfayı yenileyin.'; return; }
    if (no !== yuklemeNo) return;
    viewer = vm.goster($('#tk-viewer'), dosya(s, 'model.glb'), '#ffffff', (err) => {
        if (no !== yuklemeNo) return;
        if (err) { durum.textContent = '3B model yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.'; return; }
        durum.hidden = true; boyaYukle(s, no);
    }, true);
}

// ---- Elle boyama (kayıtlı boya herkese görünür; araçlar yalnız site sahibine) ------------------------------------------------------------------------
/* Boyama ekranı (2026-11-18): sayfadaki önizleme kutusu tam ekrana açılır (body.tk-studyo-acik; görüntüleyici yeniden kurulmaz), yanda/altta araç paneli.
   Ekran kapalıyken önizleme müşteriyle aynı davranır (boyama oturumu ve geri al geçmişi korunur: boya.aktif(false)). Fare: sol = araç, sağ = çevir,
   orta = kaydır, tekerlek = imlece yakınlaştır, Boşluk = geçici çevir, Alt+tık = renk al. Kısayollar KISAYOL'da. Ayarlar localStorage engrare_boya_ayar. */
const ayarOku = () => { try { return JSON.parse(localStorage.getItem('engrare_boya_ayar') || '{}') || {}; } catch (e) { return {}; } };
const ayar = Object.assign({ renk: '#c1121f', boyut: 35, tol: 34, koru: false, son: [] }, ayarOku());
const ayarYaz = () => { try { localStorage.setItem('engrare_boya_ayar', JSON.stringify(ayar)); } catch (e) { /* yok */ } };
let studyo = false, arac = 'firca', oncekiArac = 'firca';
const ikon = (ic) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg>`;
const IK = {
    don: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
    firca: '<path d="M18.5 2.5l3 3L12 15l-3-3z"/><path d="M9 12c-2.5 0-4 1.6-4 3.8 0 1.6-.8 2.7-2 3.2 2.6 1.6 7.6 1.4 8.6-1.6.5-1.6 0-2.9-2.6-5.4"/>',
    doldur: '<path d="M4.5 11.5L11 5l7 7-6.5 6.5a2 2 0 0 1-2.8 0L4.5 14.3a2 2 0 0 1 0-2.8z"/><path d="M4 12h14"/><path d="M20.5 15.5s1.8 2.2 1.8 3.5a1.8 1.8 0 0 1-3.6 0c0-1.3 1.8-3.5 1.8-3.5z"/><path d="M8 2.5l3 2.5"/>',
    silgi: '<path d="M7 21h13"/><path d="M3.6 14.6l9.2-9.2a2 2 0 0 1 2.8 0l4 4a2 2 0 0 1 0 2.8L12 20H8.4z"/><path d="M8.5 9.7l5.8 5.8"/>',
    damla: '<path d="M2.5 21.5l1-1h2.5l9-9"/><path d="M3.5 20.5V18l9-9"/><path d="M14.5 6.5l3.2-3.2a2.1 2.1 0 1 1 3 3l-3.2 3.2.5.5a1.5 1.5 0 0 1-2.1 2.1l-4-4a1.5 1.5 0 0 1 2.1-2.1z"/>',
    geri: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    ileri: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    sil: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>',
    kapat: '<path d="M18 6L6 18M6 6l12 12"/>', sol: '<path d="M15 18l-6-6 6-6"/>', sag: '<path d="M9 18l6-6-6-6"/>', kaydet: '<path d="M20 6L9 17l-5-5"/>'
};
const ARACLAR = [['don', 'Çevir', 'H'], ['firca', 'Fırça', 'B'], ['doldur', 'Doldur', 'G'], ['silgi', 'Silgi', 'E'], ['damla', 'Renk al', 'I']];
const KISAYOL = { h: 'don', b: 'firca', g: 'doldur', e: 'silgi', i: 'damla' };
const dokunmatik = matchMedia('(pointer: coarse)').matches;

function boyaDurum(m, hata) { for (const e of document.querySelectorAll('.tk-boya-durum')) { e.textContent = m; e.dataset.tur = hata ? 'hata' : m.startsWith('Kaydedilmemiş') ? 'kirli' : 'tamam'; } }

async function boyaYukle(s, no) {
    if (s.boya) {
        try {
            const r = await fetch(`${dosya(s, 'boya.bin').replace(/\?v=.*/, '')}?v=${s.boya}`);
            if (r.ok && no === yuklemeNo && viewer) viewer.boyaUygula(await r.arrayBuffer());   // köşe sayısı uymazsa (model yeniden üretildi) yok sayılır
        } catch (e) { /* boyasız göster */ }
    }
    if (ben && no === yuklemeNo && viewer && studyo) boyaBaslat();
}

// görüntüleyicide boyama oturumu (yoksa) açar ve ekran açıksa girdiyi boyamaya bağlar
function boyaBaslat() {
    if (!viewer || !viewer.boyaAc) return false;
    if (!boya) {
        boya = viewer.boyaAc(() => { boyaKirli = true; boyaDurum('Kaydedilmemiş değişiklik var.'); }, (tur, v) => {
            if (tur === 'renk') { renkSec(v, true); if (arac === 'damla') aracSec(oncekiArac); }
            if (tur === 'gecmis') gecmisCiz();
        });
        if (!boya) return false;
        boya.renk(ayar.renk); boya.boyut(ayar.boyut / 1000); boya.tol = ayar.tol; boya.koru = ayar.koru;
    }
    boya.aracSec(arac); boya.aktif(studyo); gecmisCiz();
    return true;
}

function gecmisCiz() {
    const g = boya ? boya.gecmis() : { geri: 0, ileri: 0 };
    const a = $('#st-geri'), b = $('#st-ileri'); if (a) a.disabled = !g.geri; if (b) b.disabled = !g.ileri;
}

function aracSec(ad) {
    if (ad !== 'damla') oncekiArac = ad;
    arac = ad; if (boya) boya.aracSec(ad);
    document.querySelectorAll('.st-arac').forEach((b) => b.classList.toggle('secili', b.dataset.a === ad));
}

function renkSec(hex, viewerdan) {
    ayar.renk = hex; if (!viewerdan && boya) boya.renk(hex);
    const r = $('#st-renk'); if (r) r.value = hex;
    const o = $('#st-renk-onu'); if (o) o.style.background = hex;
    ayar.son = [hex, ...ayar.son.filter((x) => x !== hex)].slice(0, 10); ayarYaz(); renkleriCiz();
}

function renkleriCiz() {
    const s = teklif && teklif.secenekler[secili];
    const sw = (c, ad) => `<button type="button" class="st-sw${c.toLowerCase() === ayar.renk.toLowerCase() ? ' secili' : ''}" data-c="${c}" style="background:${c}" title="${esc(ad || c)}" aria-label="${esc(ad || c)}"></button>`;
    const palet = ((s && s.palet) || []).filter((r) => /^#[0-9a-fA-F]{6}$/.test(r.hex));
    const grup = (baslik, html) => html ? `<div class="st-grup"><div class="st-grup-ad">${baslik}</div><div class="st-sw-satir">${html}</div></div>` : '';
    $('#st-renkler').innerHTML =
        grup('Modelin renkleri', palet.map((r) => sw(r.hex, r.ad)).join('')) +
        grup('Son kullanılanlar', ayar.son.map((c) => sw(c)).join('')) +
        grup('Hazır', BOYA_RENK.map((c, i) => sw(c, i < 9 ? `${c} (${i + 1})` : c)).join(''));
}

function studyoKur() {
    const d = document.createElement('div'); d.id = 'tk-studyo'; d.hidden = true;
    d.innerHTML = `
        <div class="st-ust">
            <button type="button" class="st-ik" id="st-kapat" title="Boyama ekranını kapat (Esc)" aria-label="Kapat">${ikon(IK.kapat)}</button>
            <div class="st-sec"><button type="button" class="st-ik" id="st-onceki" title="Önceki seçenek" aria-label="Önceki seçenek">${ikon(IK.sol)}</button>
                <span id="st-sec-ad">Seçenek 1</span>
                <button type="button" class="st-ik" id="st-sonraki" title="Sonraki seçenek" aria-label="Sonraki seçenek">${ikon(IK.sag)}</button></div>
            <span class="tk-boya-durum st-durum" aria-live="polite"></span>
            <div class="st-ust-sag">
                <button type="button" class="st-ik" id="st-geri" title="Geri al (Ctrl+Z)" aria-label="Geri al" disabled>${ikon(IK.geri)}</button>
                <button type="button" class="st-ik" id="st-ileri" title="Yinele (Ctrl+Y)" aria-label="Yinele" disabled>${ikon(IK.ileri)}</button>
                <button type="button" class="st-ik" id="st-sil" title="Bu seçenekteki tüm boyamayı sil" aria-label="Hepsini sil">${ikon(IK.sil)}</button>
                <button type="button" class="st-kaydet" id="st-kaydet" title="Kaydet (Ctrl+S)">${ikon(IK.kaydet)}<span>Kaydet</span></button>
            </div>
        </div>
        <div class="st-yan">
            <div class="st-araclar" role="radiogroup" aria-label="Araç">${ARACLAR.map(([a, ad, t]) => `
                <button type="button" class="st-arac" data-a="${a}" title="${ad} (${t})" aria-label="${ad}">${ikon(IK[a])}<span>${ad}</span></button>`).join('')}</div>
            <div class="st-ayar">
                <div class="st-renk-satir"><label class="st-renk-kutu" title="Renk seç"><span id="st-renk-onu"></span><input type="color" id="st-renk" aria-label="Renk"></label>
                    <div id="st-renkler" class="st-renkler"></div></div>
                <label class="st-kaydir"><span>Fırça <b id="st-boyut-d"></b></span><input type="range" id="st-boyut" min="4" max="150"></label>
                <div class="st-koru-satir"><label class="st-koru" title="Fırça yalnız ilk dokunduğun renge benzeyen yerleri boyar: sınırdan taşmaz"><input type="checkbox" id="st-koru"> Sınırdan taşma</label>
                    <label class="st-kaydir st-tol"><span>Benzerlik <b id="st-tol-d"></b></span><input type="range" id="st-tol" min="6" max="90"></label></div>
                <div class="st-yardim">${dokunmatik
                    ? 'Tek parmak: araç · İki parmak: çevir, sıkıştır: yakınlaştır · Çevir aracı: tek parmakla döndür'
                    : '<b>Sol tık</b> araç · <b>Sağ tık</b> çevir · <b>Orta tık</b> kaydır · <b>Tekerlek</b> imlece yakınlaştır · <b>Boşluk</b> basılı: çevir · <b>Alt+tık</b> renk al · <b>[ ]</b> fırça boyutu · <b>1-9</b> hazır renk · <b>Ctrl+Z / Ctrl+Y</b> · <b>Ctrl+S</b> kaydet · <b>Esc</b> kapat'}</div>
            </div>
        </div>`;
    document.body.appendChild(d);
    new ResizeObserver(() => { document.body.style.setProperty('--st-alt', d.querySelector('.st-yan').offsetHeight + 'px'); }).observe(d.querySelector('.st-yan'));
    d.querySelector('.st-araclar').addEventListener('click', (e) => { const b = e.target.closest('.st-arac'); if (b) aracSec(b.dataset.a); });
    $('#st-renkler').addEventListener('click', (e) => { const b = e.target.closest('.st-sw'); if (b) renkSec(b.dataset.c); });
    $('#st-renk').addEventListener('input', (e) => { ayar.renk = e.target.value; $('#st-renk-onu').style.background = e.target.value; if (boya) boya.renk(e.target.value); });
    $('#st-renk').addEventListener('change', (e) => renkSec(e.target.value));
    const boyutYaz = () => { $('#st-boyut').value = ayar.boyut; $('#st-boyut-d').textContent = ayar.boyut; if (boya) boya.boyut(ayar.boyut / 1000); };
    const tolYaz = () => { $('#st-tol').value = ayar.tol; $('#st-tol-d').textContent = ayar.tol; if (boya) boya.tol = ayar.tol; };
    $('#st-boyut').addEventListener('input', (e) => { ayar.boyut = +e.target.value; boyutYaz(); ayarYaz(); });
    $('#st-tol').addEventListener('input', (e) => { ayar.tol = +e.target.value; tolYaz(); ayarYaz(); });
    $('#st-koru').checked = ayar.koru;
    $('#st-koru').addEventListener('change', (e) => { ayar.koru = e.target.checked; if (boya) boya.koru = ayar.koru; ayarYaz(); });
    boyutYaz(); tolYaz(); $('#st-renk').value = ayar.renk; $('#st-renk-onu').style.background = ayar.renk;
    $('#st-kapat').addEventListener('click', studyoKapat);
    $('#st-onceki').addEventListener('click', () => secGec(-1));
    $('#st-sonraki').addEventListener('click', () => secGec(1));
    $('#st-geri').addEventListener('click', () => { if (boya) boya.geriAl(); });
    $('#st-ileri').addEventListener('click', () => { if (boya) boya.yinele(); });
    $('#st-sil').addEventListener('click', () => { if (boya && confirm('Bu seçenekteki tüm boyama silinsin mi? (Kaydedene kadar müşteri görmez; Geri al ile dönülür.)')) boya.sifirla(); });
    $('#st-kaydet').addEventListener('click', boyaKaydet);
    document.addEventListener('keydown', tus);
    document.addEventListener('keyup', (e) => { if (e.code === 'Space' && boya) boya.el(false); });
    window.addEventListener('blur', () => { if (boya) boya.el(false); });
}

function secGec(y) { const n = teklif.secenekler.length; if (n > 1) sec((secili + y + n) % n); }

function tus(e) {
    if (!studyo) return;
    const t = e.target; if (t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA')) return;
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (ctrl && k === 'z') { e.preventDefault(); if (boya) e.shiftKey ? boya.yinele() : boya.geriAl(); return; }
    if (ctrl && k === 'y') { e.preventDefault(); if (boya) boya.yinele(); return; }
    if (ctrl && k === 's') { e.preventDefault(); boyaKaydet(); return; }
    if (ctrl || e.altKey) return;
    if (e.code === 'Space') { e.preventDefault(); if (boya) boya.el(true); return; }
    if (e.key === 'Escape') { studyoKapat(); return; }
    if (KISAYOL[k]) { aracSec(KISAYOL[k]); return; }
    if (e.key === '[' || e.key === ']') { ayar.boyut = Math.max(4, Math.min(150, Math.round(ayar.boyut * (e.key === ']' ? 1.2 : 1 / 1.2)))); $('#st-boyut').value = ayar.boyut; $('#st-boyut-d').textContent = ayar.boyut; if (boya) boya.boyut(ayar.boyut / 1000); ayarYaz(); return; }
    if (/^[1-9]$/.test(e.key) && BOYA_RENK[+e.key - 1]) { renkSec(BOYA_RENK[+e.key - 1]); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { secGec(e.key === 'ArrowLeft' ? -1 : 1); }
}

function studyoAc() {
    if (!$('#tk-studyo')) studyoKur();
    studyo = true; $('#tk-studyo').hidden = false; document.body.classList.add('tk-studyo-acik');
    $('#st-sec-ad').textContent = `Seçenek ${secili + 1} / ${teklif.secenekler.length}`;
    $('#st-onceki').hidden = $('#st-sonraki').hidden = teklif.secenekler.length < 2;
    renkleriCiz(); aracSec(arac);
    if (dokunmatik && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { /* izin yok */ });
    if (!boyaBaslat()) boyaDurum('Model yüklenince boyayabilirsiniz.');
}

function studyoKapat() {
    studyo = false; if (boya) { boya.el(false); boya.aktif(false); }
    $('#tk-studyo').hidden = true; document.body.classList.remove('tk-studyo-acik');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => { /* yok */ });
}

function anahtarAl(durumFn) {
    let anahtar = ''; try { anahtar = localStorage.getItem('engrare_boya_anahtar') || ''; } catch (e) { /* yok */ }
    if (!anahtar) {
        anahtar = (prompt('Boya anahtarını yapıştırın (bir kez sorulur, bu tarayıcıda saklanır):') || '').trim();
        if (!/^[A-Za-z0-9]{16,80}$/.test(anahtar)) { durumFn('Anahtar girilmedi.', 'hata'); return ''; }
        try { localStorage.setItem('engrare_boya_anahtar', anahtar); } catch (e) { /* yok */ }
    }
    return anahtar;
}

function baskiDurum(m, tur) {
    const e = $('#tk-baski-durum');
    if (!e) return;
    e.textContent = m || '';
    e.dataset.tur = tur || 'tamam';
}

function baskiEtiketCiz() {
    const e = $('#tk-baski-etiket');
    if (!e || !teklif) return;
    e.textContent = `Seçenek ${secili + 1} · ${boy || 8} cm · Dilimleyiciye hazır (mm, Z yukarı, düz taban)`;
}

function slug(s) {
    const tr = { 'ç': 'c', 'Ç': 'c', 'ğ': 'g', 'Ğ': 'g', 'ı': 'i', 'İ': 'i', 'ö': 'o', 'Ö': 'o', 'ş': 's', 'Ş': 's', 'ü': 'u', 'Ü': 'u' };
    return String(s || '').replace(/[çÇğĞıİöÖşŞüÜ]/g, (c) => tr[c] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'teklif';
}

async function baskiIndir(tur) {
    const s = teklif && teklif.secenekler[secili];
    if (!s) return;
    // renkli dosya sunucudaki KAYITLI boyayla üretilir: kaydedilmemiş boyama varsa önce kaydedilir (yoksa dosya eski renklerle iner)
    if (tur === 'renkli' && boya && boyaKirli) {
        if (!confirm('Kaydedilmemiş boyama var. Baskı dosyası kayıtlı boyayla üretilir: önce kaydedilip öyle indirilsin mi?')) { baskiDurum('İndirilmedi: önce boyamayı kaydedin.', 'hata'); return; }
        if (!(await boyaKaydet())) { baskiDurum('Boyama kaydedilemediği için indirilmedi.', 'hata'); return; }
    }
    const anahtar = anahtarAl(baskiDurum);
    if (!anahtar) return;
    const b1 = $('#tk-baski-renkli'), b2 = $('#tk-baski-stl');
    if (b1) b1.disabled = true; if (b2) b2.disabled = true;
    const cm = boy || 8, mm = Math.round(cm * 10);
    baskiDurum(`Seçenek ${secili + 1} (${cm} cm) baskı dosyası hazırlanıyor (elle boya varsa dosyaya işlenir)…`, 'bekle');
    try {
        const r = await fetch(`${API}/teklif-baski/${teklif.anahtar}/${s.id}/${tur}?boy=${mm}`, { headers: { 'X-Boya': anahtar }, cache: 'no-store' });
        if (r.status === 401) { try { localStorage.removeItem('engrare_boya_anahtar'); } catch (e) { /* yok */ } throw new Error('Anahtar geçersiz; yeniden deneyince tekrar sorulur.'); }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).hata || 'Baskı dosyası indirilemedi.');
        const blob = await r.blob();
        const ek = tur === 'renkli' ? 'renkli.zip' : 'tekrenk.stl';
        const ad = `${slug(teklif.baslik)}-secenek-${secili + 1}-${cm}cm-${ek}`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = ad; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        baskiDurum(`İndirildi: ${ad}`);
    } catch (e) { baskiDurum(e.message || 'İndirilemedi.', 'hata'); }
    if (b1) b1.disabled = false; if (b2) b2.disabled = false;
}

function boyaKur() {
    $('#tk-boya').hidden = false;
    $('#tk-boya-ac').addEventListener('click', studyoAc);
    $('#tk-baski-renkli').addEventListener('click', () => baskiIndir('renkli'));
    $('#tk-baski-stl').addEventListener('click', () => baskiIndir('stl'));
    baskiEtiketCiz();
    // kaydedilmemiş boyamayla sayfadan çıkılırsa tarayıcı sorsun
    window.addEventListener('beforeunload', (e) => { if (boyaKirli) { e.preventDefault(); e.returnValue = ''; } });
}

async function boyaKaydet() {
    const s = teklif.secenekler[secili];
    if (!boya || !s) return false;
    const bos = boya.adet() === 0;
    if (bos && !s.boya) { boyaDurum('Önce modeli boyayın.', true); return false; }
    if (bos && !confirm('Hiç boyama kalmadı: kayıtlı boyama silinsin mi?')) return false;
    const anahtar = anahtarAl((m, t) => boyaDurum(m, t === 'hata'));
    if (!anahtar) return false;
    const btn = $('#st-kaydet'); if (btn) btn.disabled = true; boyaDurum('Kaydediliyor…');
    let ok = false;
    try {
        const r = await fetch(`${API}/boya/${teklif.anahtar}/${s.id}`, { method: 'POST', headers: { 'X-Boya': anahtar, 'Content-Type': 'application/octet-stream' }, body: bos ? new Uint8Array(0) : boya.veri() });
        if (r.status === 401) { try { localStorage.removeItem('engrare_boya_anahtar'); } catch (e) { /* yok */ } throw new Error('Anahtar geçersiz; yeniden deneyince tekrar sorulur.'); }
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).hata || 'Kaydedilemedi.');
        const j = await r.json();
        s.boya = j.boya || null; boyaKirli = false;
        $('#tk-palet').innerHTML = s.boya ? '<span class="tk-renk-not">Bu önizleme ustamız tarafından elle boyanmıştır.</span>' : (s.palet || []).map((x) => `<span class="tk-renk"><i style="background:${/^#[0-9a-fA-F]{6}$/.test(x.hex) ? x.hex : '#888'}"></i>${esc(x.ad)}</span>`).join('');
        boyaDurum(s.boya ? 'Kaydedildi: müşteri bu linkte boyalı önizlemeyi görür.' : 'Boyama silindi.');
        ok = true;
    } catch (e) { boyaDurum(e.message || 'Kaydedilemedi.', true); }
    if (btn) btn.disabled = false;
    return ok;
}

function sepeteEkle() {
    const p = urun(), s = teklif.secenekler[secili];
    if (!p || !s || s.siparisli) return;
    let sepet = [];
    try { sepet = JSON.parse(localStorage.getItem('engrare_cart') || '[]'); } catch (e) { sepet = []; }
    if (!Array.isArray(sepet)) sepet = [];
    sepet = sepet.filter((x) => x && x.portreJob !== s.id && !(x.teklif && x.teklif === teklif.anahtar));   // aynı teklifin başka seçeneği sepette kalmasın
    const cizgi = s.cizgiVar ? `${API}/dosya/${s.id}/cizgi.jpg` : null;
    sepet.push({   // myScript.js addFigurToCart ile aynı biçim
        id: Date.now(), productId: p.id, name: p.name, price: fiyat(p, boy), boy, ...(teklif.fiyat ? { teklifFiyat: teklif.fiyat } : {}),
        image: { src: cizgi || (p.images && p.images[0] && p.images[0].src) || '' },
        customText: '', font: "'AGENCYB', sans-serif", textColor: '#FFFFFF', objColor: '#FFFFFF',
        quantity: 1, textSize: 'Auto', textAlign: 'center', selectedObject: 'Renkli Figür',
        portreJob: s.id, portreKisi: 1, portreYazi: s.yazi || '', portreCizgi: cizgi, teklif: teklif.anahtar
    });
    try { localStorage.setItem('engrare_cart', JSON.stringify(sepet)); } catch (e) { alert('Tarayıcınız sepeti kaydedemedi (gizli sekme olabilir). Lütfen normal bir sekmede açın.'); return; }
    window.olcumOlay && window.olcumOlay('add_to_cart');
    location.href = '../payment/';
}

yukle().catch((e) => { console.error(e); hataGoster('Bizden kaynaklı bir sorun oldu. Lütfen biraz sonra tekrar deneyin.'); });
