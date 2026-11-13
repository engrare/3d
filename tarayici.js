/* Tarayıcı kimliği (portre büst + renkli figür): bu tarayıcıya özgü rastgele kimlik, `localStorage`da durur (hesap/kişi bilgisi içermez).
   Giriş yapmamış kişi bu kimlikle tanınır: sunucu geçmişi, günlük misafir hakkını (3) ve kişi başına aynı anda 1 üretimi bu kimliğe bağlar.
   Üye olunca/giriş yapılınca `portreUye` fonksiyonu kimliğe hesabı ve e-postayı ekler (eski üretimler hesaba geçer) ve üyelik jetonu verir (aşağıda).
   Depolama kapalıysa (özel mod) sayfa ömrü boyunca bellekteki kimlik kullanılır. Kimlik kullanıcı temizlerse yenilenir (eski işler listeden düşer). */
const ANAHTAR = 'engrare_tarayici';
let bellek = '';
function uret() {
    const b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export function tarayiciKimligi() {
    try {
        let k = localStorage.getItem(ANAHTAR);
        if (!k || !/^[a-z0-9-]{16,64}$/.test(k)) { k = uret(); localStorage.setItem(ANAHTAR, k); }
        return k;
    } catch (e) { return bellek || (bellek = uret()); }
}
/* Üyelik jetonu (X-Uye): giriş yapmış üyeyi portre sunucusuna tanıtır (sunucu Firebase'e bağlı değil; jetonu Cloud Functions `portreUye` imzalar, 12 saat geçerli).
   Jeton `myScript.js`teki kaynak işlevle alınır (`uyeKaynakKur`); bellekte tutulur, bitmeye 1 saatten az kalınca yenilenir. Alınamazsa boş döner: istek misafir sayılır. */
let kaynak = null, jeton = '', jetonBitis = 0, bekleyen = null;
export function uyeKaynakKur(fn) { kaynak = fn; }
export function uyeJetonuSifirla() { jeton = ''; jetonBitis = 0; bekleyen = null; }
export async function uyeJetonu() {
    if (jeton && jetonBitis - Date.now() > 3600000) return jeton;
    if (!kaynak || localStorage.getItem('engrare_uye') !== '1') return '';
    if (!bekleyen) bekleyen = (async () => {
        try { const r = await kaynak(); if (r && r.jeton) { jeton = r.jeton; jetonBitis = Number(r.bitis) || 0; } }
        catch (e) { /* jeton alınamadı: misafir gibi devam */ }
        finally { bekleyen = null; }
    })();
    await bekleyen;
    return jeton;
}
// Sunucu çağrısına eklenecek başlıklar: yalnız iş açma ve geçmiş uçlarında gerekir (öbür çağrılar ek ön kontrol istemesin)
export async function kimlikBasligi(yol, secenek) {
    const gerek = yol === '/gecmis' || ((secenek && secenek.method) === 'POST' && /^\/is(\?|$)/.test(yol));
    if (!gerek) return {};
    const h = { 'X-Tarayici': tarayiciKimligi() };
    const j = await uyeJetonu();
    if (j) h['X-Uye'] = j;
    return h;
}
/* Günlük misafir hakkı dolduğunda (sunucu 429 + uyeOl): hata kutusuna mesaj + "Giriş yap / Üye ol" düğmesi. Giriş yapmış kişide jeton alınamamıştır: yenilemesi söylenir. */
export function uyeOlGoster(kutu, e) {
    if (!kutu || !e || !e.uyeOl) return;
    if (localStorage.getItem('engrare_uye') === '1') { kutu.textContent = 'Hesabınız doğrulanamadı. Lütfen sayfayı yenileyip tekrar deneyin.'; return; }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'portre-uye-ol'; b.textContent = 'Giriş yap / Üye ol';
    b.addEventListener('click', () => { if (window.uyeOlGit) window.uyeOlGit(); });
    kutu.appendChild(document.createElement('br')); kutu.appendChild(b);
}
