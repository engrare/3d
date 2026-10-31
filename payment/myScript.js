import { paintPreview, previewOf, placeSocialOverlays, customObjFor, itemSocialState, logoLayerStyle } from "../preview-engine.js?v=111";
// Ürün kataloğu ana sayfayla ortak (önceden burada eskimiş bir kopyası vardı)
import { products, applyProductOverrides, cacheOverrides } from "../products.js?v=15";
import { shipEstimate } from "../delivery.js?v=1";
import { offerGuestAccount, rememberGuest } from "./guest-account.js?v=1";

// Config Sabit Tutuldu
const firebaseConfig = {
	apiKey: "AIzaSyBM7oB0EkTjGJiOHdo67ByXA6qxVcvPS8Y",
	authDomain: "engrar3d.firebaseapp.com",
	databaseURL: "https://engrar3d-default-rtdb.europe-west1.firebasedatabase.app",
	projectId: "engrar3d",
	storageBucket: "engrar3d.firebasestorage.app",
	messagingSenderId: "68298863793",
	appId: "1:68298863793:web:ba7ec7ded3424b4c779e90",
	measurementId: "G-NLSV32JMM2"
};
// reCAPTCHA Enterprise site key (gizli değil). Google Cloud > Security > reCAPTCHA > engrare-appcheck
const APPCHECK_SITE_KEY = "6LdZF8wtAAAAAGjU6iUcHZyLuErVbN4N7KK6vPx9";

/* --------------------------------------------------------------------------
   FIREBASE: TEMBEL (LAZY) YÜKLEME
   Önceden 4 Firebase SDK modülü (~450 KB) statik import ediliyordu; bu yüzden
   localStorage'dan okunan sipariş özeti bile SDK inip ayrıştırılmadan ekrana
   gelmiyordu. Artık SDK ilk çizimden sonra arka planda yükleniyor; Firebase'e
   ihtiyaç duyan her işleyici başında `await fbReady()` çağırıyor.
   -------------------------------------------------------------------------- */
let auth, db, functions;
let onAuthStateChanged, signInAnonymously;
let ref, set, push, onValue, get, update;
let httpsCallable, appCheckReady;

let _fbPromise = null;
function fbReady() {
    if (!_fbPromise) {
        _fbPromise = Promise.all([
            import("firebase/app"),
            import("firebase/auth"),
            import("firebase/database"),
            import("firebase/functions")
        ]).then(([appM, authM, dbM, fnM]) => {
            ({ onAuthStateChanged, signInAnonymously } = authM);
            ({ ref, set, push, onValue, get, update } = dbM);

            const app = appM.initializeApp(firebaseConfig);
            // Bot koruması: sipariş/ödeme fonksiyonları App Check belirteci olmayan istekleri reddeder.
            // reCAPTCHA (~350 KB) telefonda oturum isteğiyle yarışmasın diye oturumdan SONRA yüklenir;
            // her fonksiyon çağrısı önce onu bekler.
            let acPromise = null;
            appCheckReady = () => acPromise ||= import("firebase/app-check").then(acM => {
                acM.initializeAppCheck(app, { provider: new acM.ReCaptchaEnterpriseProvider(APPCHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
            });
            httpsCallable = (fns, name) => {
                const call = fnM.httpsCallable(fns, name);
                return async (data) => { await appCheckReady(); return call(data); };
            };
            auth      = authM.initializeAuth(app, { persistence: [authM.indexedDBLocalPersistence, authM.browserLocalPersistence, authM.browserSessionPersistence] });   // getAuth() giriş çerçevesini (~100 KB) indirir; açılır pencere girişi kullanılmıyor
            db        = dbM.getDatabase(app);
            functions = fnM.getFunctions(app, 'europe-west1');
        });
    }
    return _fbPromise;
}

/* GA4 satın alma olayı (yalnızca çerez onayıyla gider; aynı sipariş için bir kez) */
const gaItems = (list) => list.map(i => ({ item_id: String(i.productId), item_name: i.name, price: i.price, quantity: i.quantity || 1 }));
function trackPurchase(orderId, value, items) {
    try {
        if (localStorage.getItem('engrare_ga_' + orderId)) return;
        localStorage.setItem('engrare_ga_' + orderId, '1');
    } catch (e) { /* özel gezinti: yine de gönder */ }
    window.olcumOlay && window.olcumOlay('purchase');
    window.trackEvent && window.trackEvent('purchase', { transaction_id: String(orderId), currency: 'TRY', value, items });
}

let cart = [];
let selectedAddress = null;
let shippingCost = 0; // kargo ücretsiz; yalnızca seçilirse öncelikli üretim ücreti
let appliedDiscount = null;
let savedAddresses = {};
let isProcessingPayment = false;
let lastRejectedAddress = ''; // adres doğrulaması reddettiği son adres (aynı adresle ikinci basışta devam edilir)

/* --- XSS KORUMASI --- */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeColor(value, fallback) {
    return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

/* CSS url(...) içinde güvenle kullanılabilecek adres (tırnak/parantez içermez) */
function safeUrl(value) {
    return (typeof value === 'string' && /^[A-Za-z0-9\-._~:/?#@!$&+,=%;]+$/.test(value)) ? value : '';
}

/* Misafir formu mu, kayıtlı adresler mi (üst menüde de Giriş Yap / Profil). Firebase inene kadar son bilinen
   oturum tipiyle hemen gösterilir (engrare_uye, ana sayfa ve bu sayfa yazar); oturum çözülünce düzeltilir. */
function showCheckoutMode(registered) {
    localStorage.setItem('engrare_uye', registered ? '1' : '0');
    $('#guest-contact-section, #guest-address-section').toggle(!registered);
    $('#user-address-section').toggle(registered);
    if (!registered) $('#user-profile-header').hide();
    $('#nav-login-btn').css('display', registered ? 'none' : 'flex');
    $('#nav-user-profile').css('display', registered ? 'flex' : 'none');
}

/* Alan bilgi ipucu ("?" simgesi): masaüstünde fareyle gelince, telefonda dokununca açılır.
   Tek yüzen kutu kullanılır: sütunların kenarında taşmaz, kaydırılabilir alanlarda kırpılmaz. */
function initHelpTips() {
    const $pop = $('<div class="help-pop" role="tooltip"></div>').appendTo('body');
    const canHover = window.matchMedia('(hover: hover)').matches;
    let current = null;
    const hide = () => {
        $pop.removeClass('show');
        if (current) $(current).removeClass('active');
        current = null;
    };
    const show = (btn) => {
        hide();
        current = btn;
        $(btn).addClass('active');
        $pop.text(btn.dataset.tip).addClass('show');
        const r = btn.getBoundingClientRect(), w = $pop.outerWidth(), h = $pop.outerHeight();
        const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
        const top = r.bottom + 8 + h > window.innerHeight - 8 ? r.top - h - 8 : r.bottom + 8;
        $pop.css({ left, top });
    };
    $(document).on('click', '.help-tip', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (!canHover) current === this ? hide() : show(this);
    });
    if (canHover) {
        $(document).on('mouseenter focusin', '.help-tip', function() { show(this); });
        $(document).on('mouseleave focusout', '.help-tip', hide);
    }
    $(document).on('click touchstart', (e) => { if (current && !$(e.target).closest('.help-tip').length) hide(); });
    $(window).on('scroll resize', hide);
}

$(document).ready(function() {
    initHelpTips();
    $('.ship-est').each(function() { $(this).text(shipEstimate($(this).data('method'))); });
    loadCart();
    loadProductOverrides();
    // Boş sepetle ödeme formu gösterme: sepet sayfasına dön (orada "sepet boş" ekranı var)
    if (!cart.length) { location.replace('/?checkout'); return; }
    showCheckoutMode(localStorage.getItem('engrare_uye') === '1');

    // Auth State Yönetimi — SDK indikten sonra bağlanır (ilk çizimi bloklamaz)
    fbReady().then(() => onAuthStateChanged(auth, async (user) => {
        showCheckoutMode(!!user && !user.isAnonymous);
        appCheckReady().catch(() => {}); // formlar açıldı, reCAPTCHA artık arka planda insin
        if (user) {
            if (!user.isAnonymous) {
                // REGISTERED USER MODE

                // Adresler profilden bağımsız yüklensin: profil okunamazsa ödeme engellenmesin
                loadUserAddresses(user.uid);

                // Profil Bilgilerini Yükle
                let profile = null;
                try {
                    const snapshot = await get(ref(db, `users/${user.uid}/profile`));
                    profile = snapshot.val();
                } catch (error) {
                    console.warn("Profil okunamadı:", error);
                }
                // Veritabanında profil yoksa Auth verisine dön
                const displayName = (profile && (profile.fullname || profile.username)) || user.displayName || "Kullanıcı";
                $('#checkout-user-name').text(displayName);
                $('#checkout-user-email').text((profile && profile.email) || user.email || '');
                if (user.photoURL) {
                    $('#checkout-user-img').attr('src', user.photoURL);
                }
                $('#user-profile-header').css('display', 'flex');
            }
        }
        // Giriş yoksa misafir oturumu burada değil, ödeme anında açılır (processPayment)
    }));

    // Telefon Formatlama / Maskeleme Fonksiyonu (05XX XXX XX XX)
    function formatPhoneNumber(value) {
        let clean = (value || '').replace(/\D/g, '');
        if (clean.startsWith('90') && clean.length > 10) {
            clean = clean.slice(2);
        }
        if (clean.length > 0 && !clean.startsWith('0')) {
            clean = '0' + clean;
        }
        clean = clean.slice(0, 11);
        
        let formatted = '';
        if (clean.length > 0) formatted += clean.substring(0, 4);
        if (clean.length > 4) formatted += ' ' + clean.substring(4, 7);
        if (clean.length > 7) formatted += ' ' + clean.substring(7, 9);
        if (clean.length > 9) formatted += ' ' + clean.substring(9, 11);
        return formatted;
    }

    $('#contact-phone, #new-addr-phone').on('input', function() {
        const formatted = formatPhoneNumber(this.value);
        if (this.value !== formatted) {
            this.value = formatted;
        }
    });

    // Özet: masaüstünde sağ sütun, telefonda 3. adım (max-width: 768px, CSS ile aynı)
    // Yalnızca hedef kapsayıcı değiştiğinde taşı: mobilde klavye açılınca tetiklenen resize'da
    // DOM'dan sökülüp yeniden eklenirse içindeki indirim kodu alanı odağını (focus) kaybedip klavyeyi kapatır.
    function handleSummaryPosition() {
        const $summary = $('.checkout-summary');
        if (!$summary.length) return;
        if (window.innerWidth <= 768) {
            if (!$summary.parent().is('#mobile-summary-placeholder')) {
                $summary.appendTo('#mobile-summary-placeholder');
            }
        } else {
            if (!$summary.parent().is('.checkout-wrapper')) {
                $('.checkout-wrapper').append($summary);
            }
        }
    }
    handleSummaryPosition();
    $(window).resize(handleSummaryPosition);

    // Kargo Seçimi Değişimi
    $('input[name="shipping-method"]').change(function() {
        $('input[name="shipping-method"]').closest('.delivery-option').removeClass('active');
        $(this).closest('.delivery-option').addClass('active');
        updateTotals();
    });

    // Ödeme Sekmeleri Geçişleri
    $('.pay-tab').click(function() {
        $('.pay-tab').removeClass('active');
        $(this).addClass('active');
        const method = $(this).data('method');
        $('.payment-content').hide();
        $(`#pay-${method}`).fadeIn();
    });

    // Ön bilgilendirme onay kutusu işaretlenince kırmızı uyarıyı kaldır
    $('#preinfo-check').on('change', function() {
        if (this.checked) {
            $(this).closest('.preinfo-check').removeClass('preinfo-error');
        }
    });

    // Yeni Adres Ekleme Tetikleyici
    $('#btn-add-address').click(() => {
        if ($('#new-address-form').is(':visible') && !$('#edit-addr-id').val()) {
            $('#new-address-form').slideUp();
            $('#new-address-form input, #new-address-form select').val('');
            return;
        }
        $('#edit-addr-id').val('');
        $('#new-addr-title').val('');
        $('#new-addr-name').val('');
        $('#new-addr-surname').val('');
        $('#new-addr-full').val('');
        $('#new-addr-city').val('');
        $('#new-addr-district').val('');
        $('#new-addr-phone').val('');
        $('#new-address-form').slideDown();
    });
        
    // Adres Kaydetme
    $('#btn-save-address').click(async () => {
        await fbReady();
        const user = auth.currentUser;
        if(!user) return;

        const name = $('#new-addr-name').val().trim();
        const surname = $('#new-addr-surname').val().trim();
        const fullAddress = $('#new-addr-full').val().trim();
        // Ana sayfadaki "Adreslerim" de bu adresi okuyabilsin diye iki formatın alanları birlikte yazılıyor
        const addr = {
            title: $('#new-addr-title').val().trim(),
            name: name,
            surname: surname,
            fullname: `${name} ${surname}`.trim(),
            address: fullAddress,
            details: fullAddress,
            city: $('#new-addr-city').val().trim(),
            district: ($('#new-addr-district').val() || '').trim(),
            phone: $('#new-addr-phone').val().trim()
        };

        const phoneDigits = addr.phone.replace(/\D/g, '');
        const isPhoneValid = (phoneDigits.length === 11 && phoneDigits.startsWith('05')) || (phoneDigits.length === 10 && phoneDigits.startsWith('5'));
        if(!addr.title || !addr.address || !addr.name || !addr.surname || !addr.city || !addr.district || !isPhoneValid) {
            showToast(!isPhoneValid ? "Lütfen geçerli bir cep telefonu numarası girin (Örn: 05xx xxx xx xx)." : "Lütfen zorunlu alanları doldurun.", "error");
            return;
        }

        const editId = $('#edit-addr-id').val();
        const $btn = $('#btn-save-address');
        $btn.prop('disabled', true);

        try {
            if (editId) {
                const editRef = ref(db, `users/${user.uid}/addresses/${editId}`);
                window.lastSavedAddressId = editId;
                await update(editRef, addr);
                showToast("Adres başarıyla güncellendi ve seçildi.", "success");
            } else {
                const newRef = push(ref(db, `users/${user.uid}/addresses`));
                window.lastSavedAddressId = newRef.key;
                await set(newRef, addr);
                showToast("Adres kaydedildi ve seçildi.", "success");
            }

            $('#new-address-form').slideUp();
            $('#new-address-form input, #new-address-form select').val(''); // Temizle
            $('#edit-addr-id').val('');
        } catch (error) {
            console.error("Adres kaydedilemedi:", error);
            window.lastSavedAddressId = null;
            showToast("Adres kaydedilemedi. Lütfen bilgileri kontrol edip tekrar deneyin.", "error");
        } finally {
            $btn.prop('disabled', false);
        }
    });

    // Adres Düzenleme Butonu (satır içi onclick yerine: adres verisi HTML'e gömülmüyor)
    $(document).on('click', '.btn-addr-edit', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const id = String($(this).attr('data-id'));
        if ($('#new-address-form').is(':visible') && $('#edit-addr-id').val() === id) {
            $('#new-address-form').slideUp();
            $('#new-address-form input, #new-address-form select').val('');
            $('#edit-addr-id').val('');
            return;
        }
        const addr = savedAddresses[id];
        if (!addr) return;
        const fallbackName = (addr.fullname || '').split(/\s+/);
        $('#edit-addr-id').val(id);
        $('#new-addr-title').val(addr.title || '');
        $('#new-addr-name').val(addr.name || fallbackName[0] || '');
        $('#new-addr-surname').val(addr.surname || fallbackName.slice(1).join(' '));
        $('#new-addr-full').val(addr.address || addr.details || '');
        $('#new-addr-city').val(addr.city || '');
        $('#new-addr-district').val(addr.district || '');
        $('#new-addr-phone').val(addr.phone || '');
        $('#new-address-form').slideDown();
    });

    // Adres Seçimi Değişimi
    $(document).on('change', 'input[name="shipping-address"]', function() {
        $('.address-option').removeClass('active');
        $(this).closest('.address-option').addClass('active');
        const id = String($(this).attr('data-id'));
        window.currentSelectedAddressId = id;
        if (savedAddresses[id]) selectedAddress = savedAddresses[id];
    });

    // İndirim Kodu Uygulama Butonu
    $('#btn-apply-discount').click(async function() {
        const code = $('#discount-code-input').val().trim();
        const $msg = $('#discount-message');
        $msg.text('').removeClass('success error');
                
        if(!code) return;

        $(this).prop('disabled', true).text('Kontrol...');

        try {
            await fbReady();
            const verifyDiscount = httpsCallable(functions, 'verifyDiscount');
            const result = await verifyDiscount({ code: code });
            const data = result.data;

            if (data.valid) {
                appliedDiscount = data;
                sessionStorage.setItem('engrare_coupon', code);
                                
                // Başarılı Arayüz Güncellemeleri
                $('#discount-input-container').hide();
                $('#discount-applied-container').css('display', 'flex'); 
                $('#applied-code-text').text(code);
                updateTotals();

                const cartSubtotal = roundMoney(cart.reduce((sum, i) => sum + i.price * (parseInt(i.quantity) || 1), 0));
                if (calculateDiscount(cartSubtotal, shippingCost).isBulk) {
                    // Kupon ve toplu alım indirimi birleşmez; sunucu da daha avantajlı olanı uygular
                    $msg.text('Toplu alım indiriminiz (%15) bu koddan daha avantajlı olduğu için kod uygulanmadı.').addClass('success');
                } else {
                    $msg.text(`İndirim uygulandı: ${code}`).addClass('success');
                    showToast("İndirim kodu uygulandı.", "success");
                }
            } else {
                appliedDiscount = null;
                sessionStorage.removeItem('engrare_coupon');
                $msg.text(data.message || "Geçersiz kod.").addClass('error');
                updateTotals();
            }
        } catch (error) {
            console.error(error);
            $msg.text("Bir hata oluştu.").addClass('error');
        } finally {
            $('#btn-apply-discount').prop('disabled', false).text('Uygula');
        }
    });

    // İndirim Kodunu Kaldırma Butonu
    $('#btn-remove-discount').click(function() {
        appliedDiscount = null;
        sessionStorage.removeItem('engrare_coupon');
        $('#discount-code-input').val('');
        $('#discount-applied-container').hide();
        $('#discount-input-container').show();
        $('#discount-message').text('');
        updateTotals();
        showToast("İndirim kaldırıldı.", "success");
    });

    // F5 / "Sepete Dön" sonrası kupon kaybolmasın: sunucuda yeniden doğrulanır
    const savedCoupon = sessionStorage.getItem('engrare_coupon');
    if (savedCoupon) {
        $('#discount-code-input').val(savedCoupon);
        $('#btn-apply-discount').click();
    }

    // Siparişi Tamamla Butonu Tetikleyicisi
    $('#btn-complete-order').click(processPayment);

    // Geri tuşu ile gelindiğinde (bfcache) butonun takılı kalmasını önleme
    $(window).on('pageshow', function(e) {
        if (e.originalEvent && e.originalEvent.persisted) {
            renderCheckoutButton(false);
            updateTotals();
        }
    });
});

function loadCart() {
    let stored = null;
    try {
        stored = JSON.parse(localStorage.getItem('engrare_cart') || 'null');
    } catch (e) {
        console.error("Sepet verisi okunamadı:", e);
    }
    const initialLen = Array.isArray(stored) ? stored.length : 0;
    // Yalnızca güncel katalogda bulunan ürünleri tut (yayından kalkan ürünler sepeti bozmasın)
    cart = Array.isArray(stored) ? stored.filter(item => item && typeof item === 'object' && products.some(p => p.id === item.productId)) : [];
    if (cart.length !== initialLen) {
        localStorage.setItem('engrare_cart', JSON.stringify(cart));
    }
    // Fiyat ve ad her zaman güncel katalogdan (sunucu da aynı şekilde yeniden hesaplıyor)
    cart.forEach(item => {
        const p = products.find(prod => prod.id === item.productId);
        if (p) { item.price = p.price; item.name = p.name; }
        // Artık sunulmayan renk çiftleri ilk kombinasyona çekilir (sunucu da yalnızca bu çiftleri kabul ediyor)
        if (p && p.colors && !p.colors.some(c => c.color1 === item.textColor && c.color2 === item.objColor)) {
            item.textColor = p.colors[0].color1;
            item.objColor = p.colors[0].color2;
        }
    });
    $('#cart-badge').text(cart.length);
    renderCartSummary();
}

/* Admin panelinden (RTDB config/products) düzenlenen ürün ad/fiyat değerlerini yükler ve
   sepeti güncel fiyatlarla yeniden çizer. Tahsil edilen tutarı yine sunucu hesaplar. */
async function loadProductOverrides() {
    try {
        await fbReady();
        const snap = await get(ref(db, 'config/products'));
        if (!snap.exists()) return;
        applyProductOverrides(snap.val());
        cacheOverrides(snap.val());
        loadCart(); // fiyat/adları güncel katalogdan yeniden eşitler ve sepeti çizer
    } catch (e) {
        console.warn("Ürün geçersiz kılmaları yüklenemedi, varsayılanlar kullanılıyor:", e.message);
    }
}

function resolveAssetPath(src) {
    if (!src || typeof src !== 'string') return '';
    // Varsayılan logo content/images/ altına taşınmadan önce sepete eklenen ürünler eski yolu taşır (sunucu: cleanLogoUrl)
    if (src === './content/engrare_logo_elegant.svg') src = './content/images/engrare_logo_elegant.svg';
    if (src.startsWith('./')) return '../' + src.slice(2);
    if (src.startsWith('content/')) return '../' + src;
    return src;
}

/* Önizleme kutusunun en-boy oranı */
function previewAspectFor(p, item) {
    /* Görsel yüklenene kadarki ilk tahmin; yüklenince kutu gerçek orana göre boyutlanıyor. */
    if (!p) return 16 / 9;
    if (p.id === 1 || p.id === 2) return 16 / 9;
    if (p.isCustomObject) {
        const sel = (item.selectedObject || "").toLowerCase();
        if (sel.includes("fenerbahçe") || sel.includes("fb")) return 0.894;
        if (sel.includes("galatasaray") || sel.includes("gs")) return 0.653;
        if (sel.includes("trabzon")) return 0.678;
        if (sel.includes("beşiktaş") || sel.includes("bjk")) return 0.699;
        return 0.75;
    }
    return 16 / 9;
}

function renderCartSummary() {
    const $list = $('#order-items-list');
    let subtotal = 0;
    const rows = [];

    cart.forEach((item, index) => {
        const qty = parseInt(item.quantity || item.configuration?.quantity || 1) || 1;
        subtotal += item.price * qty;

        const p = products.find(prod => prod.id === item.productId);
        const textColor = safeColor(item.textColor, '#FBC02D');
        const objColor = safeColor(item.objColor, textColor);
        // "./content/..." gibi göreli logolar bu sayfada bir üst klasörden çözülmeli
        const logoUrl = safeUrl(resolveAssetPath(item.logoUrl));

        const aspect = previewAspectFor(p, item);
        const maxBox = paymentPreviewMax();
        let innerW, innerH;
        if (aspect >= 1) {
            innerW = maxBox;
            innerH = Math.max(22, Math.round(maxBox / aspect));
        } else {
            innerH = maxBox;
            innerW = Math.max(22, Math.round(maxBox * aspect));
        }

        const textArea = (p && p.previewTextArea) ? p.previewTextArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
        const isCustomObj = p && p.isCustomObject;
        const selObj = customObjFor(p, item);
        const logoArea = (selObj && selObj.previewLogoArea) || (p && p.previewLogoArea) || { top: '15%', left: '10%', width: '80%', height: '70%' };
        // QR standı: ana sayfadaki sepetle aynı katman id düzeni (payment-social-{qr|logo}-{area|img}-{1|2}-index)
        const socialLayers = isCustomObj ? [1, 2].map(i => `
                        <div id="payment-social-qr-area-${i}-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                            <img id="payment-social-qr-img-${i}-${index}" src="" style="position:absolute; width:100%; height:100%; object-fit:fill;">
                        </div>
                        <div id="payment-social-logo-area-${i}-${index}" style="position: absolute; top:0; left:0; width:100%; height:100%; z-index: 3; display: none; transform-origin: 0 0;">
                            <img id="payment-social-logo-img-${i}-${index}" src="" style="position:absolute; width:100%; height:100%; object-fit:contain;">
                        </div>`).join('') : '';

        rows.push(`
            <div class="summary-item">
                <!-- 2D Canlı Önizleme Kutusu (Salt Okunur) -->
                <div class="payment-2d-box">
                    <div class="payment-preview-inner" id="payment-preview-inner-${index}" style="position: relative; overflow: hidden; border-radius: 4px; width: ${innerW}px; height: ${innerH}px; background: #ffffff;">
                        <!-- Zemin Renk Katmanı -->
                        <div class="payment-obj-layer" id="payment-obj-layer-${index}" style="position: absolute; inset: 0; background-color: ${objColor}; z-index: 1;"></div>
                        
                        <!-- Kırpılmış PNG Görseli -->
                        <img class="payment-overlay-img" id="payment-overlay-img-${index}" src="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; z-index: 2; display: none;">
                        
                        <!-- Canlı Metin Alanı -->
                        ${isCustomObj ? '' : `
                        <div class="payment-printable-area" id="payment-print-area-${index}" style="position: absolute; top: ${textArea.top}; left: ${textArea.left}; width: ${textArea.width}; height: ${textArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <span class="payment-dynamic-text" id="payment-dynamic-text-${index}" style="color: ${textColor}; font-family: 'AGENCYB', sans-serif; font-size: 13px; font-weight: 700; text-align: center; width: auto; word-break: break-word; display: inline-block; line-height: 1;">${escapeHtml(item.customText || '')}</span>
                        </div>
                        `}

                        <!-- Canlı Logo Alanı -->
                        ${logoUrl ? `
                        <div class="payment-logo-area" id="payment-logo-area-${index}" style="position: absolute; top: ${logoArea.top}; left: ${logoArea.left}; width: ${logoArea.width}; height: ${logoArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <div class="payment-dynamic-logo" id="payment-dynamic-logo-${index}" style="${logoLayerStyle(logoUrl, textColor)}"></div>
                        </div>
                        ` : ''}
                        ${socialLayers}
                    </div>
                </div>

                <!-- Bilgi Alanı (Düzenleme Yok) -->
                <div class="item-info">
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    ${item.selectedObject ? `<div class="item-meta">${item.productId === 3 ? 'Stand Tipi' : 'Seçenek'}: <span style="font-weight:600; color:var(--text-main);">${escapeHtml(item.selectedObject)}</span></div>` : ''}
                    ${item.customText ? `<div class="item-meta">Yazı: <span style="font-weight:600; color:var(--text-main);">"${escapeHtml(item.customText)}"</span></div>` : ''}
                    <div class="item-meta">Adet: <span style="font-weight:600; color:var(--text-main);">${escapeHtml(qty)}</span></div>
                </div>
                <div class="item-price">${formatTL(item.price * qty)}</div>
            </div>
        `);
    });

    // Tek DOM yazımı, ardından önizlemeler
    $list.html(rows.join(''));
    for (let i = 0; i < cart.length; i++) renderPaymentItemPreview(i);
    // Önizleme yazıları yazı tipi (AGENCYB) inmeden ölçülürse yanlış boyutta kalıyor: inince yeniden sığdır
    if (document.fonts && document.fonts.load) {
        document.fonts.load("1em 'AGENCYB'").then(() => cart.forEach((_, i) => fitPaymentItemText(i)), () => {});
    }

    $('#summ-subtotal').text(formatTL(subtotal));
    updateTotals();
}

function fitPaymentItemText(index) {
    const $container = $(`#payment-print-area-${index}`);
    const $text = $(`#payment-dynamic-text-${index}`);
    if (!$container.length || !$text.length) return;

    const textVal = $text.text().trim();
    if (!textVal) return;

    const containerW = $container.width();
    const containerH = $container.height();
    if (containerW <= 0 || containerH <= 0) return;

    let fontSize = containerH * 0.92;
    $text.css({
        'font-size': fontSize + 'px',
        'white-space': 'nowrap',
        'display': 'inline-block'
    });

    const textW = $text.outerWidth(true);
    if (textW > containerW && textW > 0) {
        const scale = containerW / textW;
        fontSize = fontSize * scale;
        $text.css('font-size', fontSize + 'px');
    }
}

/* Önizleme kutusunun iç ölçüsü CSS'ten (--payment-preview-max; dar ekranda küçük) */
const paymentPreviewMax = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--payment-preview-max')) || 82;

function renderPaymentItemPreview(index) {
    const item = cart[index];
    if (!item) return;
    const p = products.find(prod => prod.id === item.productId);

    const obj = customObjFor(p, item);
    const pv = previewOf(p, item);

    // Ortak, önbellekli motor. Ana sayfadaki sepet gibi stand görseli de yazı rengine boyanır.
    // Görsel yolları site köküne göre; bu sayfa bir alt klasörde.
    paintPreview(document.getElementById(`payment-overlay-img-${index}`),
        { src: resolveAssetPath(pv.src), mask: pv.mask && resolveAssetPath(pv.mask) },
        safeColor(item.textColor, '#FBC02D'), function(aspect, status) {
        if (status === 'error') return;
        const box = document.getElementById(`payment-preview-inner-${index}`);
        if (!box) return;
        if (aspect) {
            const maxBox = paymentPreviewMax(), minSide = 22;
            box.style.width = (aspect >= 1 ? maxBox : Math.max(minSide, Math.round(maxBox * aspect))) + 'px';
            box.style.height = (aspect >= 1 ? Math.max(minSide, Math.round(maxBox / aspect)) : maxBox) + 'px';
        }
        // Kutu görselin oranında (boşluk yok); ölçü stilden okunur
        if (obj) {
            placeSocialOverlays(obj, 'payment', `-${index}`, itemSocialState(item),
                { x: 0, y: 0, w: parseFloat(box.style.width), h: parseFloat(box.style.height) });
        }
        setTimeout(() => fitPaymentItemText(index), 40);
    });
}

/* İndirim hesabı — functions/index.js > calculateTotals ile birebir aynı:
   kupon, öncelikli üretim ücreti dahil son fiyat (ara toplam + öncelikli ücret) üzerinden hesaplanır
   ve en fazla o tutar kadar düşer; 3+ adette ara toplamın %15'i (toplu alım) kuponla birleşmez,
   hangisi daha avantajlıysa o uygulanır. */
const BULK_DISCOUNT_MIN_QTY = 3;
const BULK_DISCOUNT_RATE = 0.15;
const PRIORITY_RATE = 0.15; // Öncelikli üretim: ara toplamın %15'i (backend: index.js ile aynı olmalı)

function roundMoney(value) {
    return Math.round(value * 100) / 100;
}

function calculateDiscount(subtotal, priorityFee = 0) {
    const totalQty = cart.reduce((sum, i) => sum + (parseInt(i.quantity || i.configuration?.quantity || 1) || 1), 0);
    let couponAmount = 0;
    if (appliedDiscount) {
        const couponBase = roundMoney(subtotal + priorityFee);
        if (appliedDiscount.type === 'percent') {
            couponAmount = couponBase * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            couponAmount = appliedDiscount.value;
        }
        couponAmount = roundMoney(Math.min(couponAmount, couponBase));
    }
    const bulkAmount = totalQty >= BULK_DISCOUNT_MIN_QTY ? roundMoney(subtotal * BULK_DISCOUNT_RATE) : 0;
    const useBulk = bulkAmount > 0 && bulkAmount >= couponAmount;
    return { amount: useBulk ? bulkAmount : couponAmount, isBulk: useBulk };
}

function updateTotals() {
    let subtotal = 0;
    cart.forEach(i => {
        const qty = parseInt(i.quantity || i.configuration?.quantity || 1) || 1;
        subtotal += i.price * qty;
    });
    subtotal = roundMoney(subtotal);

    const priorityFee = roundMoney(subtotal * PRIORITY_RATE);

    // Hazırlama Seçenekleri Kart Fiyat Etiketleri
    $('#standard-shipping-price').text('Ek ücret yok');
    $('#express-shipping-price').text('+' + formatTL(priorityFee));

    const selectedShipping = $('input[name="shipping-method"]:checked').val() || 'standard';
    const isExpress = selectedShipping === 'express';
    // Kargo her siparişte ücretsiz (özette sabit "Ücretsiz"); sunucu da yalnızca öncelikli üretim ücretini ekler
    shippingCost = isExpress ? priorityFee : 0;

    const discount = calculateDiscount(subtotal, shippingCost);
    const discountAmount = discount.amount;

    // Sipariş Özeti Satırları: Kargo ve Üretim Hızı Ayrımı
    $('#summ-subtotal').text(formatTL(subtotal));

    // Öncelikli üretim isteğe bağlı bir ek: özette yalnızca seçilince görünür
    $('#summ-production-row').toggle(isExpress);
    $('#summ-production-speed').text('+' + formatTL(priorityFee));
        
    if (discountAmount > 0) {
        $('#summ-discount-row').show();
        $('#summ-discount-row > span').first().text(discount.isBulk ? 'Toplu Alım İndirimi (%15)' : 'İndirim');
        $('#summ-discount').text('-' + formatTL(discountAmount));
    } else {
        $('#summ-discount-row').hide();
    }

    const total = Math.max(0, subtotal + shippingCost - discountAmount);
        
    // Buton ve genel ara yüz fiyatlarını eşitle
    $('#summ-total').text(formatTL(total));
    renderCheckoutButton(false, '', total);
}

function renderCheckoutButton(isLoading = false, loadingText = 'İşleniyor...', amount = null) {
    const $btn = $('#btn-complete-order');
    if (!$btn.length) return;
    
    let priceText = '';
    if (amount !== null && typeof amount !== 'undefined') {
        priceText = formatTL(amount);
    } else {
        const existingPrice = $('#final-price-btn').text();
        priceText = existingPrice || '₺0,00';
    }

    if (isLoading) {
        $btn.prop('disabled', true).css('opacity', '0.85');
        $btn.html(`
            <span class="btn-checkout-left"><i class="fa-solid fa-circle-notch fa-spin"></i> ${loadingText}</span>
            <span class="btn-checkout-price" id="final-price-btn">${priceText}</span>
        `);
    } else {
        $btn.prop('disabled', false).css('opacity', '1');
        $btn.html(`
            <span class="btn-checkout-left"><i class="fa-solid fa-lock"></i> Güvenle Öde</span>
            <span class="btn-checkout-price" id="final-price-btn">${priceText}</span>
        `);
    }
}

function formatTL(price) {
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

// Adres alanlarında her kelimenin ilk harfi yazarken büyütülür (Türkçe i -> İ); imleç yerinde kalır
$(document).on('input', '#ship-name, #ship-surname, #ship-address, #ship-district, #new-addr-title, #new-addr-name, #new-addr-surname, #new-addr-full, #new-addr-district', function (e) {
    if (e.originalEvent && e.originalEvent.isComposing) return;
    const v = this.value;
    const s = v.replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toLocaleUpperCase('tr-TR'));
    if (s === v || s.length !== v.length) return;
    const p = this.selectionStart, q = this.selectionEnd;
    this.value = s;
    this.setSelectionRange(p, q);
});

function loadUserAddresses(uid) {
    onValue(ref(db, `users/${uid}/addresses`), (snapshot) => {
        const $container = $('#saved-addresses-container');
        $container.empty();
                
        const data = snapshot.val() || {};
        savedAddresses = {};
        Object.entries(data).forEach(([id, addr]) => {
            if (addr && typeof addr === 'object') savedAddresses[id] = addr;
        });
        const ids = Object.keys(savedAddresses);

        if (ids.length > 0) {
            let targetId = window.lastSavedAddressId || window.currentSelectedAddressId || ids[0];
            if (!savedAddresses[targetId]) targetId = ids[0];

            window.currentSelectedAddressId = targetId;
            selectedAddress = savedAddresses[targetId];
            window.lastSavedAddressId = null;

            const cards = ids.map((id) => {
                const addr = savedAddresses[id];
                const addressText = addr.address || addr.details || '';
                const titleText = addr.title || 'Adresim';
                // Ana sayfada kaydedilen adreslerde ad/soyad yerine "fullname" alanı var
                const personName = addr.fullname || [addr.name, addr.surname].filter(Boolean).join(' ');
                const location = [addr.district, addr.city].filter(Boolean).join(' / ');
                const isChecked = (id === targetId);

                return `
                    <label class="delivery-option address-option ${isChecked ? 'active' : ''}">
                        <input type="radio" name="shipping-address" data-id="${escapeHtml(id)}" ${isChecked ? 'checked' : ''} style="display:none;">
                        <div class="del-top-row">
                            <div class="del-icon-wrapper"><i class="fa-solid fa-location-dot"></i></div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <button type="button" data-id="${escapeHtml(id)}" class="btn-addr-edit" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                                <i class="fa-solid fa-circle-check check-icon" style="position:static; font-size:1.05rem;"></i>
                            </div>
                        </div>
                        <div class="del-body" style="margin-top:6px;">
                            <span class="del-title">${escapeHtml(titleText)}</span>
                            <span class="del-desc" style="font-weight:600; color:var(--primary); margin-bottom:2px;">${escapeHtml(personName)}</span>
                            <span class="del-desc" style="overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHtml(addressText)}</span>
                        </div>
                        <div class="del-footer" style="margin-top:4px;">
                            <span class="del-desc" style="font-weight:600; color:var(--text-muted); font-size:0.75rem;">${escapeHtml(location)}</span>
                        </div>
                    </label>
                `;
            });
            $container.html(cards.join(''));
            $('#new-address-form').hide();
        } else {
            $('#new-address-form').show();
            selectedAddress = null;
        }
    });
}

/* Hatalı alanı işaretler, ekrana getirir ve ne yapılacağını söyleyen uyarı gösterir */
function fieldError(selector, message) {
    const $f = $(selector).addClass('field-error');
    window.olcumOlay && window.olcumOlay('hata_' + ($f[0] && ($f[0].id || $f[0].name) || 'alan'));
    $f.one('input change', () => $f.removeClass('field-error'));
    showToast(message, "error");
    if ($f[0]) {
        $f[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        try { $f[0].focus({ preventScroll: true }); } catch (e) { /* odak verilemese de uyarı yeter */ }
    }
}

async function processPayment() {
    // Çift tıklamada iki sipariş / iki ödeme formu oluşmasın
    if (isProcessingPayment) return;
    isProcessingPayment = true;
    try {
        await runPayment();
    } finally {
        isProcessingPayment = false;
    }
}

async function runPayment() {
    if (cart.length === 0) {
        showToast("Sepetiniz boş.", "error");
        return;
    }
    if (!$('#preinfo-check').is(':checked')) {
        showToast("Lütfen Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi'ni onaylayın.", "error");
        const $preLabel = $('#preinfo-check').closest('.preinfo-check');
        $preLabel.removeClass('preinfo-error');
        if ($preLabel[0]) void $preLabel[0].offsetWidth;
        $preLabel.addClass('preinfo-error');
        if ($preLabel[0]) $preLabel[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    renderCheckoutButton(true, 'İşleniyor...');
    await fbReady();
    await auth.authStateReady(); // kayıtlı oturum yüklenmeden yeni misafir açılmasın
    let user = auth.currentUser;
    if (!user) {
        try {
            const cred = await signInAnonymously(auth);
            user = cred.user;
        } catch (err) {
            console.error("Oturum başlatılamadı:", err);
            showToast("Oturum hatası. Lütfen sayfayı yenileyin.", "error");
            updateTotals();
            return;
        }
    }

    const shippingMethod = $('input[name="shipping-method"]:checked').val() || "standard";
    const paymentMethod = $('.pay-tab.active').data('method') || "iyzico";

    let shippingInfo = {};

    // Toplam Tutar Matematik Hesabı
    const subtotal = roundMoney(cart.reduce((sum, item) => sum + (item.price * (parseInt(item.quantity || item.configuration?.quantity || 1) || 1)), 0));
    const discountAmount = calculateDiscount(subtotal, shippingCost).amount;
    const totalAmount = roundMoney(Math.max(0, subtotal + shippingCost - discountAmount));

    // 🛡️ ADRES DOĞRULAMA VE VERİ TOPLAMA BLOĞU (HTML ID'lerine göre tam eşitleme sağlandı)
    if (user.isAnonymous) {
        shippingInfo = {
            email: ($('#contact-email').val() || '').trim(),
            phone: ($('#contact-phone').val() || '').trim(),
            name: ($('#ship-name').val() || '').trim(),
            surname: ($('#ship-surname').val() || '').trim(),
            address: ($('#ship-address').val() || '').trim(),
            district: ($('#ship-district').val() || '').trim(),
            city: ($('#ship-city').val() || '').trim(),
            zip: ''
        };
        
        // Hangi alanın eksik olduğunu söyler ve oraya götürür ("tüm alanları doldurun" yerine)
        const missing = [
            [shippingInfo.phone, '#contact-phone', 'Telefon numaranızı yazın.'],
            [shippingInfo.name, '#ship-name', 'Adınızı yazın.'],
            [shippingInfo.surname, '#ship-surname', 'Soyadınızı yazın.'],
            [shippingInfo.address, '#ship-address', 'Açık adresinizi yazın (mahalle, sokak, bina ve daire no).'],
            [shippingInfo.city, '#ship-city', 'Şehrinizi seçin.'],
            [shippingInfo.district, '#ship-district', 'İlçenizi yazın.']
        ].find(([value]) => !value);
        if (missing) {
            fieldError(missing[1], missing[2]);
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        // E-posta isteğe bağlı: boşsa sunucu telefondan yer tutucu üretir (iyzico için); yazıldıysa biçimi denetlenir
        if (shippingInfo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingInfo.email)) {
            fieldError('#contact-email', 'E-posta adresi eksik veya hatalı görünüyor. Örnek: ad@ornek.com');
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        const anonDigits = shippingInfo.phone.replace(/\D/g, '');
        const isAnonPhoneValid = (anonDigits.length === 11 && anonDigits.startsWith('05')) || (anonDigits.length === 10 && anonDigits.startsWith('5'));
        if (!isAnonPhoneValid) {
            fieldError('#contact-phone', anonDigits.length < 10 ? 'Telefon numaranız eksik. 05XX XXX XX XX biçiminde 11 hane girin.' : 'Cep telefonu numarası 05 ile başlamalı: 05XX XXX XX XX');
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
    } else {
        let sel = selectedAddress;
        // Yeni adres formunu doldurup "Adresi Kaydet"e basmadan ödemeye geçen: formdaki adres kullanılır
        if (!sel && $('#new-address-form').is(':visible')) {
            sel = {
                name: $('#new-addr-name').val().trim(),
                surname: $('#new-addr-surname').val().trim(),
                address: $('#new-addr-full').val().trim(),
                district: ($('#new-addr-district').val() || '').trim(),
                city: ($('#new-addr-city').val() || '').trim(),
                phone: $('#new-addr-phone').val().trim()
            };
        }
        if (!sel) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        let firstName = sel.name || '';
        let lastName = sel.surname || '';
        if (!firstName && !lastName && sel.fullname) {
            const parts = sel.fullname.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }
        
        shippingInfo = {
            name: firstName,
            surname: lastName,
            fullname: sel.fullname || (firstName + ' ' + lastName).trim(),
            address: sel.address || sel.details || '',
            district: sel.district || '',
            city: sel.city || '',
            phone: sel.phone || '',
            email: user.email || '',
            zip: sel.zip || ''
        };

        const regDigits = String(shippingInfo.phone || '').replace(/\D/g, '');
        const isRegPhoneValid = (regDigits.length === 11 && regDigits.startsWith('05')) || (regDigits.length === 10 && regDigits.startsWith('5'));

        if (!shippingInfo.fullname || !shippingInfo.address || !shippingInfo.city || !isRegPhoneValid) {
            showToast(!isRegPhoneValid ? "Seçili adreste geçerli bir cep telefonu (05xx xxx xx xx) eksik. Lütfen adresi düzenleyin." : "Seçili adreste ad, açık adres veya şehir eksik. Lütfen adresi düzenleyin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
    }

    // Adres doğrulaması (kargo): hatalı il/ilçe ya da çok kısa adres ödemeden önce yakalanır, il/ilçe adları standartlaşır.
    // Servis yanıt vermezse sipariş engellenmez; doğrulama yanlış reddederse aynı adresle ikinci basışta devam edilir.
    renderCheckoutButton(true, 'Adres kontrol ediliyor...', totalAmount);
    try {
        const addrCheck = (await httpsCallable(functions, 'validateAddress')({
            city: shippingInfo.city, district: shippingInfo.district, address: shippingInfo.address
        })).data;
        if (addrCheck && addrCheck.valid === false) {
            const signature = [shippingInfo.city, shippingInfo.district, shippingInfo.address].join('|');
            if (lastRejectedAddress !== signature) {
                lastRejectedAddress = signature;
                showToast(`Adres doğrulanamadı: ${addrCheck.message}. Lütfen il, ilçe ve açık adresi kontrol edin (doğruysa tekrar basarak devam edebilirsiniz).`, "error");
                renderCheckoutButton(false, '', totalAmount);
                return;
            }
        } else if (addrCheck && addrCheck.valid) {
            if (addrCheck.city) shippingInfo.city = addrCheck.city;
            if (addrCheck.district) shippingInfo.district = addrCheck.district;
        }
    } catch (addrErr) {
        console.warn('Adres doğrulanamadı, devam ediliyor:', addrErr.message);
    }

    // Doğrulama başarılı -> Butonu yükleniyor moduna al
    renderCheckoutButton(true, 'İşleniyor...', totalAmount);

    const orderData = {
        userId: user.uid,
        isGuest: user.isAnonymous,
        items: cart,
        shippingInfo: shippingInfo,
        shippingMethod: shippingMethod,
        shippingCost: shippingCost,
        paymentMethod: paymentMethod,
        subtotal: subtotal,
        discountAmount: discountAmount,
        totalAmount: totalAmount,
        status: paymentMethod === 'iban' ? "pending_payment" : "incomplete_attempt"
    };

    try {
        // --- 1. AŞAMA: HAVALE / IBAN VEYA ÜCRETSİZ SİPARİŞ AKIŞI ---
        if (paymentMethod === 'iban' || totalAmount === 0) {
            const createOrder = httpsCallable(functions, 'createOrder');
            const orderResult = await createOrder({
                orderData: orderData,
                discountCode: appliedDiscount ? appliedDiscount.code : null,
                preInfoAccepted: true
            });

            const orderResponse = orderResult.data;
            if (!orderResponse || !orderResponse.success) {
                throw new Error("Sipariş oluşturulamadı.");
            }

            const orderId = orderResponse.orderId;
            trackPurchase(orderId, Number(orderResponse.totalAmount) || 0, gaItems(cart));
            cart = [];
            localStorage.removeItem('engrare_cart');
            sessionStorage.removeItem('engrare_coupon');
            $('#cart-badge').text(0);

            // Havale durumunda doğrudan sayfa içi başarı kutusunu gösteriyoruz
            $('.checkout-form-section > :not(#payment-success-container)').hide();
            $('.checkout-summary').hide();
            $('.checkout-wrapper').css('grid-template-columns', '1fr');

            $('#success-order-id').text('#' + orderId);
            $('#success-order-ref').text(orderId);
            $('#success-amount').text(formatTL(Number(orderResponse.totalAmount) || 0));

            // Tutar sunucunun hesapladığı değere göre belirlenir
            if (Number(orderResponse.totalAmount) === 0) {
                $('.elegant-iban-card, .elegant-warning-box').hide();
                $('#payment-success-container > p').first().text('Siparişiniz ücretsiz olarak başarıyla oluşturuldu. Bizi tercih ettiğiniz için teşekkür ederiz.');
            }

            $('#payment-success-container').fadeIn();
            window.scrollTo(0, 0);
            // Misafir müşteriye tek alanlı hesap oluşturma önerisi: önce siparişi görsün, sonra pencere gelsin
            if (orderData.isGuest && shippingInfo.email) { // e-posta verilmediyse hesap bağlanamaz
                setTimeout(() => offerGuestAccount(`${shippingInfo.name} ${shippingInfo.surname}`.trim(), shippingInfo.email), 1500);
            }
            return;
        }

        // --- 2. AŞAMA: GERÇEK IYZICO KREDİ KARTI AKIŞI ---
        if (paymentMethod === 'iyzico') {
            renderCheckoutButton(true, 'Ödeme Sayfası Hazırlanıyor...', totalAmount);
            
            const createIyzicoPayment = httpsCallable(functions, 'createIyzicoPayment');
            const payResult = await createIyzicoPayment({
                orderData: orderData,
                discountCode: appliedDiscount ? appliedDiscount.code : null,
                origin: window.location.origin,
                preInfoAccepted: true
            });

            const paymentPageUrl = payResult.data && payResult.data.paymentPageUrl;
            // Yalnızca iyzico'nun kendi alan adına yönlendir
            if (payResult.data.status === 'success' && /^https:\/\/([a-z0-9-]+\.)*iyzipay\.com([/?#]|$)/i.test(paymentPageUrl || '')) {
                // Dönüş sayfasında (result.html) misafire hesap penceresi açılabilsin
                // Dönüş sayfası (result.html) satın alma olayını bu bilgiyle gönderir
                try { sessionStorage.setItem('engrare_ga_siparis', JSON.stringify({ value: totalAmount, items: gaItems(cart) })); } catch (e) { /* önemsiz */ }
                if (orderData.isGuest && shippingInfo.email) rememberGuest(`${shippingInfo.name} ${shippingInfo.surname}`.trim(), shippingInfo.email);
                showToast("Ödeme sayfasına aktarılıyorsunuz...", "success");
                window.olcumOlay && window.olcumOlay('odeme_baslat');
                window.location.href = paymentPageUrl;
            } else {
                throw new Error("Ödeme linki oluşturulamadı.");
            }
        }

    } catch (e) {
        console.error("Payment Process Error:", e);
        showToast("Sipariş işlenirken bir hata oluştu: " + (e.message || ""), "error");
        renderCheckoutButton(false, '', totalAmount);
    }
}

function showToast(msg, type) {
    const color = type === 'error' ? 'red' : 'green';
    // Aynı köşede üst üste binmesin: önceki bildirimi kaldır
    document.querySelectorAll('.pay-toast').forEach(t => t.remove());
    const div = document.createElement('div');
    div.className = 'pay-toast';
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999; color: #1e293b; font-weight: 500;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
window.copyToClipboard = function(selector) {
    const el = document.querySelector(selector);
    const text = el ? el.innerText.trim() : '';
    if (!text) return;

    function fallbackCopy() {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showToast('Kopyalandı!', 'success');
        } catch (e) {
            showToast('Kopyalanamadı, lütfen elle kopyalayın.', 'error');
        }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('Kopyalandı!', 'success');
        }).catch(() => {
            fallbackCopy();
        });
    } else {
        fallbackCopy();
    }
};
