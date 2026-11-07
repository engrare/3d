/* Kimliksiz site ölçümü: çerez/localStorage yazmaz, kişi ya da oturum kimliği yoktur; yalnızca "şu sayfa açıldı, şu kadar kalındı,
   şuna basıldı" olayları edit sunucusuna (edit-api.engrare.com) toplu sayaç olarak gider (IP/tarayıcı bilgisi kaydedilmez).
   Sunucu kapalıysa hata yutulur, site aynen çalışır. GA4/Meta Pixel'den bağımsızdır (onay gerektirmez). Site sahibi (?ben=1) ve
   "İzlenmek istemiyorum" (DNT/GPC) gönderen tarayıcılar ölçülmez. Ana sayfa (tek sayfa uygulaması) sayfa değişimini window.olcumSayfa(ad),
   adlandırılmış olayları window.olcumOlay(ad) ile bildirir; diğer sayfalar adreslerinden otomatik adlanır. */
(function () {
    var URL_ = 'https://edit-api.engrare.com/api/site/e';
    var q = [], page = '', shown = 0, vis = 0, sentLeave = false, maxScroll = 0, lastField = '', done = false, typed = {};
    try { if (localStorage.getItem('engrare_kendim') === '1') return; } catch (e) {}
    if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl || (navigator.webdriver && !window.__olcumTest)) return;
    // Yerel geliştirmede canlı sayaca yazma (test için window.__olcumTest)
    if (location.hostname !== 'engrare.com' && !window.__olcumTest) return;

    function clean(s) { return String(s || '').toLowerCase().replace(/\d+/g, 'n').replace(/[^a-z0-9_\-\/:.]+/g, '_').slice(0, 48); }
    function short(p) { return p.split('/')[0]; }

    function flush() {
        if (!q.length) return;
        var body = JSON.stringify({ e: q.splice(0, 40) });
        try {
            if (navigator.sendBeacon) navigator.sendBeacon(URL_, body);   // metin gövdesi: ön kontrol (CORS preflight) gerektirmez
            else fetch(URL_, { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }).catch(function () {});
        } catch (e) { /* ölçüm siteyi etkilemez */ }
    }
    function push(ev) { q.push(ev); if (q.length >= 15) flush(); }
    setInterval(flush, 15000);

    function pct() {
        var d = document.documentElement, h = Math.max(d.scrollHeight, document.body ? document.body.scrollHeight : 0) - window.innerHeight;
        return h <= 20 ? 100 : Math.min(100, Math.round(((window.pageYOffset || d.scrollTop) / h) * 100));
    }
    window.addEventListener('scroll', function () { var p = pct(); if (p > maxScroll) maxScroll = p; }, { passive: true });

    function elapsed() { return vis + (shown ? Date.now() - shown : 0); }
    function leave(final) {
        if (!page) return;
        var s = Math.round(elapsed() / 1000);
        var p = pct(); if (p > maxScroll) maxScroll = p;
        var ev = { t: 'leave', p: page, s: s, sc: maxScroll };
        if (sentLeave) ev.r = 1;                       // aynı görüntülemenin devamı: yalnız süre
        else if (page === 'odeme' && !done && lastField) ev.f = clean(lastField);
        push(ev);
        sentLeave = true; vis = 0; shown = document.hidden ? 0 : Date.now();
        if (final) page = '';
    }

    window.olcumSayfa = function (ad) {
        ad = clean(ad);
        if (!ad || ad === page) return;
        leave(true);
        page = ad; vis = 0; shown = document.hidden ? 0 : Date.now(); sentLeave = false; maxScroll = 0; typed = {};
        push({ t: 'view', p: page });
        setTimeout(function () { var p = pct(); if (p > maxScroll) maxScroll = p; }, 800);   // kaydırması olmayan kısa sayfa = tamamı görüldü
    };
    window.olcumOlay = function (ad) {
        ad = clean(ad);
        if (!ad) return;
        if (ad === 'purchase' || ad === 'odeme_baslat') done = true;
        push({ t: 'ev', n: ad });
    };

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) { if (shown) { vis += Date.now() - shown; shown = 0; } leave(false); flush(); }
        else shown = Date.now();
    });
    window.addEventListener('pagehide', function () { leave(true); flush(); });

    document.addEventListener('click', function (e) {
        var el = e.target && e.target.closest && e.target.closest('[data-ol],button,a,input,select,label,summary,[role=button],.model-card,[class*=bubble],[class*=swatch],[id]');
        if (!el || !page) return;
        var k = el.getAttribute('data-ol') || el.id || el.classList[0] || el.tagName.toLowerCase();
        k = clean(k);
        if (k) push({ t: 'click', k: clean(short(page) + ':' + k) });
    }, true);
    document.addEventListener('focusin', function (e) {
        var t = e.target;
        if (page === 'odeme' && t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) lastField = t.id || t.name || '';
    });
    document.addEventListener('input', function (e) {   // yazmaya başlama: alan başına görüntülemede bir kez
        var t = e.target, k = t && (t.id || t.name);
        if (!k || !page || typed[k]) return;
        typed[k] = 1;
        push({ t: 'click', k: clean('yaz_' + short(page) + ':' + k) });
    }, true);

    // Kaynak + cihaz (açılış başına bir kez). Site içi geçişler (ödeme/sonuç sayfaları) ziyaret sayılmaz.
    var path = location.pathname, qs = new URLSearchParams(location.search);
    var inner = /^\/payment\//.test(path), host = '';
    try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    var src = (qs.get('utm_source') || '').toLowerCase();
    if (inner || (host && host === location.hostname)) src = 'ic';
    else if (/instagram|^ig$/.test(src) || /instagram\.com$/.test(host)) src = 'instagram';
    else if (/facebook|^fb$/.test(src) || /facebook\.com$|fb\.com$/.test(host)) src = 'facebook';
    else if (/google/.test(src) || /(^|\.)google\./.test(host)) src = 'google';
    else src = host || src ? 'diger' : 'direkt';
    push({ t: 'load', m: window.innerWidth < 768 ? 1 : 0, src: src, camp: (qs.get('utm_campaign') || '').toLowerCase().slice(0, 48) });

    // Tek sayfa uygulaması olmayan sayfalar adreslerinden adlanır; ana sayfa olcumSayfa ile bildirir.
    if (path !== '/' && !/^\/index\.html$/.test(path)) {
        var ad = /^\/payment\/result/.test(path) ? 'sonuc' : /^\/payment\//.test(path) ? 'odeme' : path.replace(/^\/+|\/+$|\/index\.html$/g, '');
        window.olcumSayfa(ad);
    }
})();
