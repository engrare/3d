import { getPreviewImage } from "../preview-engine.js";

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
let httpsCallable;

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
            httpsCallable = fnM.httpsCallable;

            const app = appM.initializeApp(firebaseConfig);
            auth      = authM.getAuth(app);
            db        = dbM.getDatabase(app);
            functions = fnM.getFunctions(app, 'europe-west1');
        });
    }
    return _fbPromise;
}

let cart = [];
let selectedAddress = null;
let shippingCost = 50.00;
let appliedDiscount = null;
let savedAddresses = {};
let isProcessingPayment = false;

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

const products = [
    {
        id: 1,
        name: "Araba İçi Numaratör",
        desc: "Basarak aç kapa yapılabilen elegant numaratör.",
        customTextLabel: "araç içinde görünecek telefon numaranızı giriniz.",
        customTextPlaceholder: "Örn: 0541 555 55 55",
        customTextPlaceholderPreview: "0541 555 55 55",
        fixedTextSize: 48,
        fixedLogoSize: 48,
        price: 179.90,
        isDashedLine: false,
        images: [
            { src: "./content/products/1/3.jpg" },
            { src: "./content/products/1/2.jpg" },
            { src: "./content/products/1/1.jpg" },
            { src: "./content/products/1/4.jpg" }
        ],
        previewTextArea: { top: '13.6%', left: '10.4%', width: '78.2%', height: '34.6%' },
        previewLogoArea: { top: '0.0%', left: '7.2%', width: '85.7%', height: '100.0%' },
        colors: [
            { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ]
    },
    {
        id: 2,
        name: "Duvara Yapışmalı Özel Ad Plakası",
        desc: "Kapı veya duvarlar için tasarlanmış isimlik.",
        price: 180,
        allowLogo: true,
        isDashedLine: false,
        images: [
            { src: "./content/products/2/1.jpg" },
            { src: "./content/products/2/2.jpg" },
            { src: "./content/products/2/3.jpg" },
            { src: "./content/products/2/4.jpg" }
        ],
        previewTextArea: { top: '49.2%', left: '6.5%', width: '86.6%', height: '44.8%' },
        previewLogoArea: { top: '8.6%', left: '2.8%', width: '93.9%', height: '42.0%' },
        colors: [
            { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ]
    },
    {
        // Ana sayfadaki (../myScript.js) ürün 3 ile aynı olmalı
        id: 3,
        name: "Kişiselleştirilmiş QR & Kartvizit Standı",
        desc: "İhtiyacınıza göre şekillenen profesyonel kartvizitlik.",
        price: 180,
        isCustomObject: [
            { objectName: "1 Kartvizit Bölmeli", src: "./content/products/5/preview-1-bolme.png" },
            { objectName: "2 Kartvizit Bölmeli", src: "./content/products/5/preview-2-bolme.png" },
            { objectName: "3 Kartvizit Bölmeli", src: "./content/products/5/preview-3-bolme.png" }
        ],
        colors: [
            { color1: "#FBC02D", color2: "#222222", label1: "Yazı", label2: "Zemin" },
            { color1: "#FFFFFF", color2: "#1976D2", label1: "Yazı", label2: "Zemin" },
            { color1: "#222222", color2: "#FFFFFF", label1: "Yazı", label2: "Zemin" },
            { color1: "#E91E63", color2: "#388E3C", label1: "Yazı", label2: "Zemin" }
        ],
        images: [
            { src: "./content/products/5/1.jpg" },
            { src: "./content/products/5/2.jpg" },
            { src: "./content/products/5/3.jpg" },
            { src: "./content/products/5/4.jpg" }
        ]
    }
];

$(document).ready(function() {
    loadCart();
        
    // Auth State Yönetimi — SDK indikten sonra bağlanır (ilk çizimi bloklamaz)
    fbReady().then(() => onAuthStateChanged(auth, async (user) => {
        if (user) {
            if (user.isAnonymous) {
                // GUEST (MİSAFİR) MODU
                $('#guest-contact-section').show();
                $('#guest-address-section').show();
                $('#user-address-section').hide();
                $('#user-profile-header').hide();
            } else {
                // REGISTERED USER MODE
                $('#guest-contact-section').hide();
                $('#guest-address-section').hide();
                $('#user-address-section').show();
                                
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
        } else {
            signInAnonymously(auth).catch((error) => {
                console.error("Misafir oturumu açılamadı:", error);
                showToast("Oturum başlatılamadı. Lütfen sayfayı yenileyin.", "error");
            });
        }
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

    // Mobil/Desktop Özeti Taşıma Mantığı (Yalnızca mobil breakpoint max-width: 768px)
    function handleSummaryPosition() {
        if (window.innerWidth <= 768) {
            $('.checkout-summary').appendTo('#mobile-summary-placeholder');
        } else {
            $('.checkout-wrapper').append($('.checkout-summary'));
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

    // Yeni Adres Ekleme Tetikleyici
    $('#btn-add-address').click(() => {
        $('#edit-addr-id').val('');
        $('#new-addr-title').val('');
        $('#new-addr-name').val('');
        $('#new-addr-surname').val('');
        $('#new-addr-full').val('');
        $('#new-addr-city').val('');
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
            phone: $('#new-addr-phone').val().trim()
        };

        if(!addr.title || !addr.address || !addr.name || !addr.surname || !addr.city) {
            showToast("Lütfen zorunlu alanları doldurun.", "error");
            return;
        }

        const editId = $('#edit-addr-id').val();
        const $btn = $('#btn-save-address');
        $btn.prop('disabled', true);

        try {
            if (editId) {
                const editRef = ref(db, `users/${user.uid}/addresses/${editId}`);
                window.lastSavedAddressId = editId;
                // update: ana sayfada girilen ilçe (district) gibi alanlar korunur
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
        const addr = savedAddresses[id];
        if (!addr) return;
        const fallbackName = (addr.fullname || '').split(/\s+/);
        $('#edit-addr-id').val(id);
        $('#new-addr-title').val(addr.title || '');
        $('#new-addr-name').val(addr.name || fallbackName[0] || '');
        $('#new-addr-surname').val(addr.surname || fallbackName.slice(1).join(' '));
        $('#new-addr-full').val(addr.address || addr.details || '');
        $('#new-addr-city').val(addr.city || '');
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
                                
                // Başarılı Arayüz Güncellemeleri
                $('#discount-input-container').hide();
                $('#discount-applied-container').css('display', 'flex'); 
                $('#applied-code-text').text(code);
                $msg.text(`İndirim uygulandı: ${code}`).addClass('success');
                                
                updateTotals();
                showToast("İndirim kodu uygulandı.", "success");
            } else {
                appliedDiscount = null;
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
        $('#discount-code-input').val('');
        $('#discount-applied-container').hide();
        $('#discount-input-container').show();
        $('#discount-message').text('');
        updateTotals();
        showToast("İndirim kaldırıldı.", "success");
    });

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
    cart = Array.isArray(stored) ? stored.filter(item => item && typeof item === 'object') : [];
    // Fiyat ve ad her zaman güncel katalogdan (sunucu da aynı şekilde yeniden hesaplıyor)
    cart.forEach(item => {
        const p = products.find(prod => prod.id === item.productId);
        if (p) { item.price = p.price; item.name = p.name; }
    });
    $('#cart-badge').text(cart.length);
    renderCartSummary();
}

function hexToRgb(hex) {
    if (!hex) return { r: 251, g: 192, b: 45 };
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function resolveAssetPath(src) {
    if (!src || typeof src !== 'string') return '';
    if (src.startsWith('./')) return '../' + src.slice(2);
    if (src.startsWith('content/')) return '../' + src;
    return src;
}

/* Önizleme kutusunun en-boy oranı */
function previewAspectFor(p, item) {
    if (!p) return 1.71;
    if (p.id === 1) return 3.594;
    if (p.id === 2) return 1.710;
    if (p.isCustomObject) {
        const sel = (item.selectedObject || "").toLowerCase();
        if (sel.includes("fenerbahçe") || sel.includes("fb")) return 0.894;
        if (sel.includes("galatasaray") || sel.includes("gs")) return 0.653;
        if (sel.includes("trabzon")) return 0.678;
        if (sel.includes("beşiktaş") || sel.includes("bjk")) return 0.699;
        return 0.75;
    }
    return 1.71;
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
        const maxBox = 82;
        let innerW, innerH;
        if (aspect >= 1) {
            innerW = maxBox;
            innerH = Math.max(22, Math.round(maxBox / aspect));
        } else {
            innerH = maxBox;
            innerW = Math.max(22, Math.round(maxBox * aspect));
        }

        const textArea = (p && p.previewTextArea) ? p.previewTextArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
        const logoArea = (p && p.previewLogoArea) ? p.previewLogoArea : { top: '15%', left: '10%', width: '80%', height: '70%' };
        const isCustomObj = p && p.isCustomObject;

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
                        ${(logoUrl && !isCustomObj) ? `
                        <div class="payment-logo-area" id="payment-logo-area-${index}" style="position: absolute; top: ${logoArea.top}; left: ${logoArea.left}; width: ${logoArea.width}; height: ${logoArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <div class="payment-dynamic-logo" id="payment-dynamic-logo-${index}" style="width: 100%; height: 100%; mask-image: url(${logoUrl}); -webkit-mask-image: url(${logoUrl}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${textColor};"></div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Bilgi Alanı (Düzenleme Yok) -->
                <div class="item-info">
                    <div class="item-name">${escapeHtml(item.name)}</div>
                    ${item.selectedObject ? `<div class="item-meta">Takım/Obje: <span style="font-weight:600; color:var(--text-main);">${escapeHtml(item.selectedObject)}</span></div>` : ''}
                    ${item.customText ? `<div class="item-meta">Yazı: <span style="font-weight:600; color:var(--text-main);">"${escapeHtml(item.customText)}"</span></div>` : ''}
                    <div class="item-meta">Adet: <span style="font-weight:600; color:var(--text-main);">${escapeHtml(qty)}</span></div>
                </div>
                <div class="item-price">₺${(item.price * qty).toFixed(2)}</div>
            </div>
        `);
    });

    // Tek DOM yazımı, ardından önizlemeler
    $list.html(rows.join(''));
    for (let i = 0; i < cart.length; i++) renderPaymentItemPreview(i);

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

function renderPaymentItemPreview(index) {
    const item = cart[index];
    if (!item) return;
    const p = products.find(prod => prod.id === item.productId);

    let src = `../content/products/${item.productId}/preview.png`;
    let isCustom = false;
    if (p && p.isCustomObject) {
        const sel = (item.selectedObject || "").toLowerCase();
        const obj = p.isCustomObject.find(o => {
            const oName = (o.objectName || "").toLowerCase();
            return oName === sel || oName.includes(sel) || sel.includes(oName);
        }) || p.isCustomObject[0];
        if (obj) src = resolveAssetPath(obj.src);
        isCustom = true;
    }

    // Ortak, önbellekli motor: aynı görsel+renk ikinci kez istendiğinde iş yapılmaz
    getPreviewImage(src, isCustom ? null : hexToRgb(item.textColor || '#FBC02D'), function(url, aspect, status) {
        const $img = $(`#payment-overlay-img-${index}`);
        if (status === 'error') { $img.hide(); return; }
        $img.attr('src', status === 'ok' ? url : src).show();
        setTimeout(() => fitPaymentItemText(index), 40);
    });
}

function updateTotals() {
    let subtotal = 0;
    cart.forEach(i => {
        const qty = parseInt(i.quantity || i.configuration?.quantity || 1) || 1;
        subtotal += i.price * qty;
    });
        
    const isFreeShipping = subtotal >= 500;
    const baseShipping = isFreeShipping ? 0 : 50;
    const expressCost = isFreeShipping ? 70 : 120;

    // Hazırlama Seçenekleri Kart Fiyat Etiketleri
    $('#standard-shipping-price').text('Ücretsiz / Dahil');
    $('#express-shipping-price').text('+₺70.00');

    const selectedShipping = $('input[name="shipping-method"]:checked').val() || 'standard';
    const isExpress = selectedShipping === 'express';
    shippingCost = isExpress ? expressCost : baseShipping;
        
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        if (discountAmount > subtotal) discountAmount = subtotal;
    }

    // Sipariş Özeti Satırları: Kargo ve Üretim Hızı Ayrımı
    $('#summ-subtotal').text(formatTL(subtotal));
    $('#summ-shipping').text(baseShipping === 0 ? 'Ücretsiz' : formatTL(baseShipping));
    
    if (isExpress) {
        $('#summ-production-speed').html('<span style="color: var(--accent); font-weight: 700;">Öncelikli (+₺70,00)</span>');
    } else {
        $('#summ-production-speed').text('Standart (Dahil)');
    }
        
    if (discountAmount > 0) {
        $('#summ-discount-row').show();
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
        priceText = existingPrice || '₺0.00';
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

    renderCheckoutButton(true, 'İşleniyor...');
    await fbReady();
    const user = auth.currentUser;
    if (!user) {
        showToast("Oturum hatası. Lütfen sayfayı yenileyin.", "error");
        updateTotals();
        return;
    }

    const shippingMethod = $('input[name="shipping-method"]:checked').val() || "standard";
    const paymentMethod = $('.pay-tab.active').data('method') || "iyzico";

    let shippingInfo = {};

    // Toplam Tutar Matematik Hesabı
    const subtotal = cart.reduce((sum, item) => sum + (item.price * (parseInt(item.quantity || item.configuration?.quantity || 1) || 1)), 0);
    let discountAmount = 0;
    if (appliedDiscount) {
         if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        if (discountAmount > subtotal) discountAmount = subtotal;
    }
    const totalAmount = Math.max(0, subtotal + shippingCost - discountAmount);

    // 🛡️ ADRES DOĞRULAMA VE VERİ TOPLAMA BLOĞU (HTML ID'lerine göre tam eşitleme sağlandı)
    if (user.isAnonymous) {
        shippingInfo = {
            email: ($('#contact-email').val() || '').trim(),
            phone: ($('#contact-phone').val() || '').trim(),
            name: ($('#ship-name').val() || '').trim(),
            surname: ($('#ship-surname').val() || '').trim(),
            address: ($('#ship-address').val() || '').trim(),
            city: ($('#ship-city').val() || '').trim(),
            zip: ($('#ship-zip').val() || '').trim()
        };
        
        if (!shippingInfo.email || !shippingInfo.phone || !shippingInfo.name || !shippingInfo.surname || !shippingInfo.address || !shippingInfo.city) {
            showToast("Lütfen tüm teslimat bilgilerini eksiksiz doldurun.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(shippingInfo.email)) {
            showToast("Lütfen geçerli bir e-posta adresi girin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        if (shippingInfo.phone.replace(/\D/g, '').length !== 11) {
            showToast("Lütfen telefon numaranızı 05XX XXX XX XX biçiminde girin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
    } else {
        if (!selectedAddress) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
        let firstName = selectedAddress.name || '';
        let lastName = selectedAddress.surname || '';
        if (!firstName && !lastName && selectedAddress.fullname) {
            const parts = selectedAddress.fullname.split(' ');
            firstName = parts[0] || '';
            lastName = parts.slice(1).join(' ') || '';
        }
        
        shippingInfo = {
            name: firstName,
            surname: lastName,
            fullname: selectedAddress.fullname || (firstName + ' ' + lastName).trim(),
            address: selectedAddress.address || selectedAddress.details || '',
            district: selectedAddress.district || '',
            city: selectedAddress.city || '',
            phone: selectedAddress.phone || '',
            email: user.email || '',
            zip: selectedAddress.zip || ''
        };

        if (!shippingInfo.fullname || !shippingInfo.address || !shippingInfo.city) {
            showToast("Seçili adreste ad, açık adres veya şehir eksik. Lütfen adresi düzenleyin.", "error");
            renderCheckoutButton(false, '', totalAmount);
            return;
        }
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
                discountCode: appliedDiscount ? appliedDiscount.code : null
            });

            const orderResponse = orderResult.data;
            if (!orderResponse || !orderResponse.success) {
                throw new Error("Sipariş oluşturulamadı.");
            }

            const orderId = orderResponse.orderId;
            cart = [];
            localStorage.removeItem('engrare_cart');
            $('#cart-badge').text(0);

            // Havale durumunda doğrudan sayfa içi başarı kutusunu gösteriyoruz
            $('.checkout-form-section > :not(#payment-success-container)').hide();
            $('.checkout-summary').hide();
            $('.checkout-wrapper').css('grid-template-columns', '1fr');

            $('#success-order-id').text('#' + orderId);
            $('#success-order-ref').text(orderId);

            // Tutar sunucunun hesapladığı değere göre belirlenir
            if (Number(orderResponse.totalAmount) === 0) {
                $('.elegant-iban-card, .elegant-warning-box').hide();
                $('#payment-success-container > p').first().text('Siparişiniz ücretsiz olarak başarıyla oluşturuldu. Bizi tercih ettiğiniz için teşekkür ederiz.');
            }

            $('#payment-success-container').fadeIn();
            window.scrollTo(0, 0);
            return;
        }

        // --- 2. AŞAMA: GERÇEK IYZICO KREDİ KARTI AKIŞI ---
        if (paymentMethod === 'iyzico') {
            renderCheckoutButton(true, 'Ödeme Sayfası Hazırlanıyor...', totalAmount);
            
            const createIyzicoPayment = httpsCallable(functions, 'createIyzicoPayment');
            const payResult = await createIyzicoPayment({
                orderData: orderData,
                discountCode: appliedDiscount ? appliedDiscount.code : null,
                origin: window.location.origin
            });

            const paymentPageUrl = payResult.data && payResult.data.paymentPageUrl;
            // Yalnızca iyzico'nun kendi alan adına yönlendir
            if (payResult.data.status === 'success' && /^https:\/\/([a-z0-9-]+\.)*iyzipay\.com([/?#]|$)/i.test(paymentPageUrl || '')) {
                showToast("Ödeme sayfasına aktarılıyorsunuz...", "success");
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
    const div = document.createElement('div');
    div.style.cssText = `position:fixed; bottom:20px; right:20px; background:white; padding:15px 25px; border-left:4px solid ${color}; box-shadow:0 5px 15px rgba(0,0,0,0.1); border-radius:8px; z-index:99999; color: #1e293b; font-weight: 500;`;
    div.innerText = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
window.copyToClipboard = function(selector) {
    const text = document.querySelector(selector).innerText.trim();
    navigator.clipboard.writeText(text).then(() => {
        showToast('Kopyalandı!', 'success');
    });
};
