/* Kimliksiz site ölçümü: çerez/localStorage yazmaz, kişi ya da oturum kimliği yoktur; yalnızca "şu sayfa açıldı, şu kadar kalındı,
   şuna basıldı" olayları edit sunucusuna (edit-api.engrare.com) toplu sayaç olarak gider (IP/tarayıcı bilgisi kaydedilmez).
   Sunucu kapalıysa hata yutulur, site aynen çalışır. GA4/Meta Pixel'den bağımsızdır (onay gerektirmez). Site sahibi (?ben=1) ve
   "İzlenmek istemiyorum" (DNT/GPC) gönderen tarayıcılar ölçülmez. Ana sayfa (tek sayfa uygulaması) sayfa değişimini window.olcumSayfa(ad),
   adlandırılmış olayları window.olcumOlay(ad) ile bildirir; diğer sayfalar adreslerinden otomatik adlanır.
   Tekil ziyaretçi (2026-11-18): YALNIZ çerez onayı veren tarayıcıda (engrare_cerez=1) açılışa tarayıcı kimliği (tarayici.js ile aynı engrare_tarayici)
   eklenir ve ilk geliş kaynağı localStorage engrare_ilk_kaynak'a bir kez yazılır (siparişe "ilk geliş" olarak gider). Sunucu kimliği özetleyip kişiyi
   günler arasında bir kez sayar. Onay yoksa cihaza hiçbir şey yazılmaz; sunucu yalnız gün içinde tekilleştirir. Onay sayfa açıkken verilirse `kimlik` olayı gider. */
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

    function onayli() { try { return localStorage.getItem('engrare_cerez') === '1'; } catch (e) { return false; } }
    function kimlik() {   // tarayici.js tarayiciKimligi ile aynı anahtar ve biçim (yapay zekâ üretim geçmişiyle aynı tarayıcı kimliği)
        try {
            var k = localStorage.getItem('engrare_tarayici');
            if (!k || !/^[a-z0-9-]{16,64}$/.test(k)) {
                var b = new Uint8Array(16); crypto.getRandomValues(b);
                k = Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
                localStorage.setItem('engrare_tarayici', k);
            }
            return k;
        } catch (e) { return ''; }
    }
    function ilkKaydet(s, c) {   // ilk geliş kaynağı + günü: bir kez yazılır, siparişe eklenir (payment/myScript.js)
        try {
            if (localStorage.getItem('engrare_ilk_kaynak')) return;
            var d = new Date(), g = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
            localStorage.setItem('engrare_ilk_kaynak', JSON.stringify({ s: s, c: c, g: g }));
        } catch (e) { /* depolama kapalı */ }
    }

    // Kaynak + cihaz (açılış başına bir kez). Site içi geçişler (ödeme/sonuç sayfaları) ziyaret sayılmaz.
    var path = location.pathname, qs = new URLSearchParams(location.search);
    var inner = /^\/payment\//.test(path), host = '';
    try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
    // /urun/<ad>/ paylaşım sayfası ve /ig/ (Instagram biyografi kısa bağlantısı) ana sayfaya yönlendirir: yönlendiren o zaman site kendisi görünürdü (reklam/Instagram ziyareti "site içi" sayılıp
    // açılış hiç sayılmıyordu). Paylaşım sayfası asıl yönlendirenin alan adını sessionStorage'a bırakır ('-' = yönlendiren yok).
    try { if (host === location.hostname && /^\/(urun|ig)\//.test(new URL(document.referrer).pathname)) { var gr = sessionStorage.getItem('engrare_ref'); host = gr && gr !== '-' ? gr : ''; } } catch (e) {}
    var src = (qs.get('utm_source') || '').toLowerCase();
    if (inner || (host && host === location.hostname)) src = 'ic';
    else if (/instagram|^ig$/.test(src) || /instagram\.com$/.test(host)) src = 'instagram';
    else if (/facebook|^fb$/.test(src) || /facebook\.com$|fb\.com$/.test(host)) src = 'facebook';
    else if (/google/.test(src) || /(^|\.)google\./.test(host)) src = 'google';
    else src = host || src ? 'diger' : 'direkt';
    var camp = (qs.get('utm_campaign') || '').toLowerCase().slice(0, 48), yuk = { t: 'load', m: window.innerWidth < 768 ? 1 : 0, src: src, camp: camp };
    if (src !== 'ic' && onayli()) { yuk.v = kimlik(); ilkKaydet(src, camp); }
    push(Object.assign({}, yuk));   // kopya: onay sonradan verilirse yuk.v değişir, kuyruktaki açılış olayı kimliksiz kalmalı
    // Çerez onayı bu açılışta verilirse: bugünkü kimliksiz sayım kimliğe çevrilir (sunucuda aynı kişi iki kez sayılmaz)
    document.addEventListener('click', function (e) {
        var b = e.target && e.target.closest && e.target.closest('[data-cerez="1"]');
        if (!b || src === 'ic' || yuk.v) return;
        yuk.v = kimlik(); ilkKaydet(src, camp);
        if (yuk.v) { push({ t: 'kimlik', v: yuk.v, src: src, camp: camp }); flush(); }
    }, true);

    // Tek sayfa uygulaması olmayan sayfalar adreslerinden adlanır; ana sayfa olcumSayfa ile bildirir.
    if (path !== '/' && !/^\/index\.html$/.test(path)) {
        var ad = /^\/payment\/result/.test(path) ? 'sonuc' : /^\/payment\//.test(path) ? 'odeme' : path.replace(/^\/+|\/+$|\/index\.html$/g, '');
        window.olcumSayfa(ad);
    }
})();
