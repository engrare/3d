/* GA4: ödeme ve dönüş sayfaları için (ana sayfanın kendi satır içi yükleyicisi vardır). Yalnızca çerez onayıyla ("Kabul et") yüklenir;
   onay ana sayfadaki bantta verilir ve localStorage'ta tutulur. trackEvent onay yoksa hiçbir şey göndermez. */
(function () {
    var ID = 'G-NLSV32JMM2';
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    window.loadAnalytics = function () {
        if (window.__gaLoaded) return;
        window.__gaLoaded = true;
        gtag('js', new Date());
        // Adres sorgusu (iyzico belirteci, sipariş no) Analytics'e gitmesin
        gtag('config', ID, { page_location: location.origin + location.pathname });
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
        document.head.appendChild(s);
    };
    window.trackEvent = function (name, params) {
        if (window.__gaLoaded) gtag('event', name, params || {});
    };
    var consent = null;
    try { consent = localStorage.getItem('engrare_cerez'); } catch (e) {}
    if (consent === '1') window.loadAnalytics();
})();
