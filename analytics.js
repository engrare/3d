/* GA4 + Meta Pixel: ödeme ve dönüş sayfaları için (ana sayfanın kendi satır içi yükleyicisi vardır). Yalnızca çerez onayıyla ("Kabul et") yüklenir;
   onay ana sayfadaki bantta verilir ve localStorage'ta tutulur. trackEvent onay yoksa hiçbir şey göndermez. */
(function () {
    var ID = 'G-NLSV32JMM2';
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    window.loadAnalytics = function () {
        // Site sahibi tarayıcısı (ana sayfada ?ben=1 ile işaretlenir): ölçüm yüklenmez
        try { if (localStorage.getItem('engrare_kendim') === '1') return; } catch (e) {}
        if (window.__gaLoaded) return;
        window.__gaLoaded = true;
        gtag('js', new Date());
        // Adres sorgusu (iyzico belirteci, sipariş no) Analytics'e gitmesin
        gtag('config', ID, { page_location: location.origin + location.pathname });
        var s = document.createElement('script');
        s.async = true;
        s.src = 'https://www.googletagmanager.com/gtag/js?id=' + ID;
        document.head.appendChild(s);
        loadPixel();
    };
    // Meta Pixel (ana sayfadaki loadPixel/fbTrack ile aynı mantık). Adres bilgisi: Pixel sayfa adresini kendisi okur;
    // sonuç sayfası bu betikten önce adresini temizler (payment/result.html), böylece sipariş no / iyzico belirteci gitmez.
    function loadPixel() {
        if (window.__fbLoaded) return;
        window.__fbLoaded = true;
        !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
        fbq('init', '992056656620910');
        fbq('track', 'PageView');
    }
    var FB_EVENTS = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' };
    function fbTrack(name, p) {
        if (!window.__fbLoaded || !FB_EVENTS[name]) return;
        p = p || {};
        var items = p.items || [], n = 0;
        items.forEach(function (i) { n += Number(i.quantity) || 1; });
        var data = { content_type: 'product', content_ids: items.map(function (i) { return String(i.item_id); }), currency: p.currency || 'TRY', value: Number(p.value) || 0 };
        if (name === 'view_item' && items[0]) data.content_name = items[0].item_name;
        if (name !== 'view_item') data.num_items = n;
        fbq('track', FB_EVENTS[name], data);
    }
    window.trackEvent = function (name, params) {
        if (window.__gaLoaded) gtag('event', name, params || {});
        fbTrack(name, params);
    };
    var consent = null;
    try { consent = localStorage.getItem('engrare_cerez'); } catch (e) {}
    if (consent === '1') window.loadAnalytics();
})();
