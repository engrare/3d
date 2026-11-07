/* Sipariş kaynağı: ziyaretçi siteye hangi bağlantıyla geldi (reklam/Instagram/Google...). Yalnızca oturum süresince
   (sessionStorage) ve yalnızca kısa etiket olarak tutulur; sipariş verilirse siparişe yazılır, yoksa sekmeyle birlikte silinir.
   Ana site ve ödeme sayfası ortak kullanır. */

const KEY = 'engrare_kaynak';
const clean = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9ğüşıöç _.\-]/gi, '').slice(0, 48);

/* Adresteki utm_* ya da yönlendiren siteden kaynağı belirleyip saklar (oturumda ilk kaynak kalır; yeni utm_* onu ezer) */
export function captureSource() {
    try {
        const qs = new URLSearchParams(location.search);
        const utm = { s: clean(qs.get('utm_source')), m: clean(qs.get('utm_medium')), c: clean(qs.get('utm_campaign')), t: clean(qs.get('utm_content')) };
        const has = utm.s || utm.m || utm.c || utm.t;
        if (!has && sessionStorage.getItem(KEY)) return;
        let src = utm;
        if (!has) {
            let host = '';
            try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { /* geçersiz */ }
            if (host && host === location.hostname) return;   // site içi geçiş: kaynak değişmez
            const g = /instagram\.com$|^l\.instagram/.test(host) ? 'instagram' : /facebook\.com$|fb\.com$/.test(host) ? 'facebook'
                : /(^|\.)google\./.test(host) ? 'google' : host ? 'diger' : 'direkt';
            src = { s: g, m: g === 'direkt' ? '' : 'referans', c: '', t: '' };
        }
        sessionStorage.setItem(KEY, JSON.stringify(src));
    } catch (e) { /* depolama kapalı */ }
}

/* Siparişe eklenecek kaynak (yoksa null) */
export function readSource() {
    try {
        const v = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        return v && (v.s || v.m || v.c || v.t) ? v : null;
    } catch (e) { return null; }
}
