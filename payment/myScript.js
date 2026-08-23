import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { getDatabase, ref, set, push, onValue, get } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const functions = getFunctions(app, 'europe-west1');

let cart = [];
let selectedAddress = null;
let shippingCost = 50.00;
let appliedDiscount = null;

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
        id: 3,
        name: "Takıma Özel Kalemlik",
        desc: "Üzerine isim yazdırılabilen takımlı kalemlik",
        price: 180,
        isCustomObject: [
            { objectName: "Fenerbahçe - 2 Adet Satıldı.", src: "./content/products/5/previewfb.png" },
            { objectName: "Galatasaray - 1 Adet Satıldı.", src: "./content/products/5/previewgs.png" },
            { objectName: "Trabzon - 0 Adet Satıldı.", src: "./content/products/5/previewtrabzon.png" },
            { objectName: "Beşiktaş - 5 Adet Satıldı.", src: "./content/products/5/previewbjk.png" }
        ],
        colors: [
            { color1: "#FBC02D", label1: "Arka" },
            { color1: "#FFFFFF", label1: "Arka" },
            { color1: "#222222", label1: "Arka" },
            { color1: "#E91E63", label1: "Arka" }
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
        
    // Auth State Yönetimi
    onAuthStateChanged(auth, async (user) => {
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
                                
                // Profil Bilgilerini Yükle
                const profileRef = ref(db, `users/${user.uid}/profile`);
                const snapshot = await get(profileRef);
                if (snapshot.exists()) {
                    const profile = snapshot.val();
                    const displayName = profile.fullname || profile.username || user.displayName || "Kullanıcı";
                    $('#checkout-user-name').text(displayName);
                    $('#checkout-user-email').text(profile.email || user.email);
                    if (user.photoURL) {
                        $('#checkout-user-img').attr('src', user.photoURL);
                    }
                    $('#user-profile-header').css('display', 'flex');
                } else {
                    // Veritabanında profil yoksa Auth verisine dön
                    $('#checkout-user-name').text(user.displayName || "Kullanıcı");
                    $('#checkout-user-email').text(user.email);
                    $('#user-profile-header').css('display', 'flex');
                }

                loadUserAddresses(user.uid);
            }
        } else {
            signInAnonymously(auth);
        }
    });

    // Mobil/Desktop Özeti Taşıma Mantığı
    function handleSummaryPosition() {
        if ($(window).width() <= 900) {
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
        const user = auth.currentUser;
        if(!user) return;
                
        const addr = {
            title: $('#new-addr-title').val().trim(),
            name: $('#new-addr-name').val().trim(),
            surname: $('#new-addr-surname').val().trim(),
            address: $('#new-addr-full').val().trim(),
            city: $('#new-addr-city').val().trim(),
            phone: $('#new-addr-phone').val().trim()
        };

        if(!addr.title || !addr.address || !addr.name || !addr.surname) {
            showToast("Lütfen zorunlu alanları doldurun.", "error");
            return;
        }

        const editId = $('#edit-addr-id').val();
        
        if (editId) {
            const editRef = ref(db, `users/${user.uid}/addresses/${editId}`);
            window.lastSavedAddressId = editId;
            await set(editRef, addr);
            
            const $radio = $(`input[name="shipping-address"][data-id="${editId}"]`);
            if ($radio.length) $radio.prop('checked', true).trigger('change');
            
            showToast("Adres başarıyla güncellendi ve seçildi.", "success");
        } else {
            const newRef = push(ref(db, `users/${user.uid}/addresses`));
            window.lastSavedAddressId = newRef.key;
            await set(newRef, addr);
            showToast("Adres kaydedildi ve seçildi.", "success");
        }
        
        $('#new-address-form').slideUp();
        $('#new-address-form input').val(''); // Temizle
        $('#edit-addr-id').val('');
    });

    // Adres Düzenleme Butonu
    window.editAddress = function(id, encData) {
        const addr = JSON.parse(decodeURIComponent(encData));
        $('#edit-addr-id').val(id);
        $('#new-addr-title').val(addr.title || '');
        $('#new-addr-name').val(addr.name || addr.fullname || '');
        $('#new-addr-surname').val(addr.surname || '');
        $('#new-addr-full').val(addr.address || addr.details || '');
        $('#new-addr-city').val(addr.city || '');
        $('#new-addr-phone').val(addr.phone || '');
        $('#new-address-form').slideDown();
    };

    // Adres Seçimi Değişimi
    $(document).on('change', 'input[name="shipping-address"]', function() {
        $('.address-option').removeClass('active');
        $(this).closest('.address-option').addClass('active');
        window.currentSelectedAddressId = $(this).data('id');
        const val = $(this).val();
        if(val) selectedAddress = JSON.parse(decodeURIComponent(val));
    });

    // İndirim Kodu Uygulama Butonu
    $('#btn-apply-discount').click(async function() {
        const code = $('#discount-code-input').val().trim();
        const $msg = $('#discount-message');
        $msg.text('').removeClass('success error');
                
        if(!code) return;

        $(this).prop('disabled', true).text('Kontrol...');

        try {
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
            $('#btn-complete-order').prop('disabled', false);
            updateTotals();
        }
    });
});

function loadCart() {
    const stored = localStorage.getItem('engrare_cart');
    if (stored) {
        cart = JSON.parse(stored);
        renderCartSummary();
    }
}

function hexToRgb(hex) {
    if (!hex) return { r: 251, g: 192, b: 45 };
    hex = hex.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function resolveAssetPath(src) {
    if (!src) return '';
    if (src.startsWith('./')) return '../' + src.slice(2);
    if (src.startsWith('content/')) return '../' + src;
    return src;
}

function renderCartSummary() {
    const $list = $('#order-items-list');
    $list.empty();
    let subtotal = 0;

    cart.forEach((item, index) => {
        const qty = parseInt(item.quantity || item.configuration?.quantity || 1);
        subtotal += item.price * qty;

        const p = products.find(prod => prod.id === item.productId);

        let aspect = 1.71;
        if (p) {
            if (p.id === 1) aspect = 3.594;
            else if (p.id === 2) aspect = 1.710;
            else if (p.isCustomObject) {
                const sel = (item.selectedObject || "").toLowerCase();
                if (sel.includes("fenerbahçe") || sel.includes("fb")) aspect = 0.894;
                else if (sel.includes("galatasaray") || sel.includes("gs")) aspect = 0.653;
                else if (sel.includes("trabzon")) aspect = 0.678;
                else if (sel.includes("beşiktaş") || sel.includes("bjk")) aspect = 0.699;
                else aspect = 0.75;
            }
        }

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

        $list.append(`
            <div class="summary-item">
                <!-- 2D Canlı Önizleme Kutusu (Salt Okunur) -->
                <div class="payment-2d-box">
                    <div class="payment-preview-inner" id="payment-preview-inner-${index}" style="position: relative; overflow: hidden; border-radius: 4px; width: ${innerW}px; height: ${innerH}px; background: #ffffff;">
                        <!-- Zemin Renk Katmanı -->
                        <div class="payment-obj-layer" id="payment-obj-layer-${index}" style="position: absolute; inset: 0; background-color: ${item.objColor || item.textColor || '#222222'}; z-index: 1;"></div>
                        
                        <!-- Kırpılmış PNG Görseli -->
                        <img class="payment-overlay-img" id="payment-overlay-img-${index}" src="" style="position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none; z-index: 2; display: none;">
                        
                        <!-- Canlı Metin Alanı -->
                        ${isCustomObj ? '' : `
                        <div class="payment-printable-area" id="payment-print-area-${index}" style="position: absolute; top: ${textArea.top}; left: ${textArea.left}; width: ${textArea.width}; height: ${textArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <span class="payment-dynamic-text" id="payment-dynamic-text-${index}" style="color: ${item.textColor || '#FBC02D'}; font-family: ${item.font || "'AGENCYB', sans-serif"}; font-size: 13px; font-weight: 700; text-align: center; width: auto; word-break: break-word; display: inline-block; line-height: 1;">${item.customText || ''}</span>
                        </div>
                        `}
                        
                        <!-- Canlı Logo Alanı -->
                        ${(item.logoUrl && !isCustomObj) ? `
                        <div class="payment-logo-area" id="payment-logo-area-${index}" style="position: absolute; top: ${logoArea.top}; left: ${logoArea.left}; width: ${logoArea.width}; height: ${logoArea.height}; z-index: 3; display: flex; align-items: center; justify-content: center; overflow: hidden;">
                            <div class="payment-dynamic-logo" id="payment-dynamic-logo-${index}" style="width: 100%; height: 100%; mask-image: url(${item.logoUrl}); -webkit-mask-image: url(${item.logoUrl}); mask-size: contain; -webkit-mask-size: contain; mask-repeat: no-repeat; -webkit-mask-repeat: no-repeat; mask-position: center; -webkit-mask-position: center; background-color: ${item.textColor || '#FBC02D'};"></div>
                        </div>
                        ` : ''}
                    </div>
                </div>

                <!-- Bilgi Alanı (Düzenleme Yok) -->
                <div class="item-info">
                    <div class="item-name">${item.name}</div>
                    ${item.selectedObject ? `<div class="item-meta">Takım/Obje: <span style="font-weight:600; color:var(--text-main);">${item.selectedObject}</span></div>` : ''}
                    ${item.customText ? `<div class="item-meta">Yazı: <span style="font-weight:600; color:var(--text-main);">"${item.customText}"</span></div>` : ''}
                    <div class="item-meta">Adet: <span style="font-weight:600; color:var(--text-main);">${qty}</span></div>
                </div>
                <div class="item-price">₺${(item.price * qty).toFixed(2)}</div>
            </div>
        `);

        renderPaymentItemPreview(index);
    });

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
        if (obj) {
            src = resolveAssetPath(obj.src);
        }
        isCustom = true;
    }
    
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        try {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imageData.data;
            const width = canvas.width;
            const height = canvas.height;
            const targetRgb = hexToRgb(item.textColor || '#FBC02D');
            
            let minX = width, minY = height, maxX = 0, maxY = 0;
            let found = false;
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = (y * width + x) * 4;
                    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
                    const isWhite = (r > 240 && g > 240 && b > 240 && a > 200);
                    if (!isWhite) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                        found = true;
                    }
                    if (!isCustom && r < 60 && g < 60 && b < 60 && a > 0) {
                        data[idx] = targetRgb.r;
                        data[idx + 1] = targetRgb.g;
                        data[idx + 2] = targetRgb.b;
                    }
                }
            }
            
            ctx.putImageData(imageData, 0, 0);
            
            if (found && maxX > minX && maxY > minY) {
                const cropW = maxX - minX + 1;
                const cropH = maxY - minY + 1;
                const croppedCanvas = document.createElement('canvas');
                croppedCanvas.width = cropW;
                croppedCanvas.height = cropH;
                const croppedCtx = croppedCanvas.getContext('2d');
                croppedCtx.drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
                $(`#payment-overlay-img-${index}`).attr('src', croppedCanvas.toDataURL()).show();
            } else {
                $(`#payment-overlay-img-${index}`).attr('src', canvas.toDataURL()).show();
            }
            
            setTimeout(() => {
                fitPaymentItemText(index);
            }, 40);
        } catch (e) {
            console.error("Payment canvas filtering error:", e);
            $(`#payment-overlay-img-${index}`).attr('src', src).show();
        }
    };
    img.onerror = function() {
        $(`#payment-overlay-img-${index}`).hide();
    };
    img.src = src;
}

function updateTotals() {
    let subtotal = 0;
    cart.forEach(i => {
        const qty = parseInt(i.quantity || i.configuration?.quantity || 1);
        subtotal += i.price * qty;
    });
        
    const standardCost = subtotal >= 500 ? 0 : 50;
    const expressCost = subtotal >= 500 ? 70 : 120;
    $('#standard-shipping-price').text(standardCost === 0 ? 'Ücretsiz' : formatTL(standardCost));
    $('#express-shipping-price').text(formatTL(expressCost));

    const selectedShipping = $('input[name="shipping-method"]:checked').val() || 'standard';
    shippingCost = selectedShipping === 'standard' ? standardCost : expressCost;
        
    let discountAmount = 0;
    if (appliedDiscount) {
        if (appliedDiscount.type === 'percent') {
            discountAmount = subtotal * (appliedDiscount.value / 100);
        } else if (appliedDiscount.type === 'fixed') {
            discountAmount = appliedDiscount.value;
        }
        if (discountAmount > subtotal) discountAmount = subtotal;
    }

    $('#summ-shipping').text(formatTL(shippingCost));
        
    if (discountAmount > 0) {
        $('#summ-discount-row').show();
        $('#summ-discount').text('-' + formatTL(discountAmount));
    } else {
        $('#summ-discount-row').hide();
    }

    const total = Math.max(0, subtotal + shippingCost - discountAmount);
        
    // Buton ve genel ara yüz fiyatlarını eşitle
    $('#summ-total').text(formatTL(total));
    $('#final-price-btn').text(formatTL(total));
}

function formatTL(price) {
    return price.toLocaleString('tr-TR', { style: 'currency', currency: 'TRY' });
}

function loadUserAddresses(uid) {
    onValue(ref(db, `users/${uid}/addresses`), (snapshot) => {
        const $container = $('#saved-addresses-container');
        $container.empty();
                
        if (snapshot.exists()) {
            const data = snapshot.val();
            
            let targetId = window.lastSavedAddressId || window.currentSelectedAddressId || Object.keys(data)[0];
            if (!data[targetId]) targetId = Object.keys(data)[0];
            
            window.currentSelectedAddressId = targetId;
            selectedAddress = data[targetId];
            window.lastSavedAddressId = null;

            Object.entries(data).forEach(([id, addr]) => {
                const val = encodeURIComponent(JSON.stringify(addr));
                const addressText = addr.address || addr.details || '';
                const titleText = addr.title || 'Adresim';
                const isChecked = (id === targetId);
                
                $container.append(`
                    <label class="delivery-option address-option ${isChecked ? 'active' : ''}">
                        <input type="radio" name="shipping-address" data-id="${id}" value="${val}" ${isChecked ? 'checked' : ''} style="display:none;">
                        <div class="del-top-row">
                            <div class="del-icon-wrapper"><i class="fa-solid fa-location-dot"></i></div>
                            <div style="display:flex; align-items:center; gap:6px;">
                                <button type="button" onclick="editAddress('${id}', '${val}'); return false;" class="btn-addr-edit" title="Düzenle"><i class="fa-solid fa-pen"></i></button>
                                <i class="fa-solid fa-circle-check check-icon" style="position:static; font-size:1.05rem;"></i>
                            </div>
                        </div>
                        <div class="del-body" style="margin-top:6px;">
                            <span class="del-title">${titleText}</span>
                            <span class="del-desc" style="font-weight:600; color:var(--primary); margin-bottom:2px;">${addr.name} ${addr.surname}</span>
                            <span class="del-desc" style="overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${addressText}</span>
                        </div>
                        <div class="del-footer" style="margin-top:4px;">
                            <span class="del-desc" style="font-weight:600; color:var(--text-muted); font-size:0.75rem;">${addr.city || ''}</span>
                        </div>
                    </label>
                `);
            });
            $('#new-address-form').hide();
        } else {
            $('#new-address-form').show();
            selectedAddress = null;
        }
    });
}

async function processPayment() {
    const user = auth.currentUser;
    if (!user) {
        showToast("Oturum hatası.", "error");
        return;
    }

    const shippingMethod = $('input[name="shipping-method"]:checked').val() || "standard";
    const paymentMethod = $('.pay-tab.active').data('method') || "iyzico";
    const $btn = $('#btn-complete-order');
    
    let shippingInfo = {};

    // Toplam Tutar Matematik Hesabı
    const subtotal = cart.reduce((sum, item) => sum + (item.price * parseInt(item.quantity || item.configuration?.quantity || 1)), 0);
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

    $btn.prop('disabled', true).text('İşleniyor...');

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
            $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
            return;
        }
    } else {
        if (!selectedAddress) {
            showToast("Lütfen bir teslimat adresi seçin veya yeni ekleyin.", "error");
            $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
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
            city: selectedAddress.city || '',
            phone: selectedAddress.phone || '',
            email: user.email || '',
            zip: selectedAddress.zip || ''
        };
    }

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
            if (orderResponse && orderResponse.success) {
                const orderId = orderResponse.orderId;
                localStorage.removeItem('engrare_cart');

                // Havale durumunda doğrudan sayfa içi başarı kutusunu gösteriyoruz
                $('.checkout-form-section > :not(#payment-success-container)').hide();
                $('.checkout-summary').hide();
                $('.checkout-wrapper').css('grid-template-columns', '1fr');
                
                $('#success-order-id').text('#' + orderId);
                $('#success-order-ref').text(orderId);
                
                if (totalAmount === 0) {
                    $('.iban-box').html('<h3 style="color:#10B981; margin-top:20px;">Ödeme Tamamlandı</h3><p>Siparişiniz ücretsiz olarak başarıyla oluşturuldu.</p>');
                }
                
                $('#payment-success-container').fadeIn();
                window.scrollTo(0, 0);
                return;
            }
        }

        // --- 2. AŞAMA: GERÇEK IYZICO KREDİ KARTI AKIŞI ---
        if (paymentMethod === 'iyzico') {
            $btn.text('Ödeme Sayfası Hazırlanıyor...');
            
            const createIyzicoPayment = httpsCallable(functions, 'createIyzicoPayment');
            const payResult = await createIyzicoPayment({ 
                orderData: orderData, 
                origin: window.location.origin
            });
            
            if (payResult.data && payResult.data.status === 'success' && payResult.data.paymentPageUrl) {
                showToast("Ödeme sayfasına aktarılıyorsunuz...", "success");
                window.location.href = payResult.data.paymentPageUrl;
            } else {
                throw new Error("Ödeme linki oluşturulamadı.");
            }
        }

    } catch (e) {
        console.error("Payment Process Error:", e);
        showToast("Sipariş işlenirken bir hata oluştu: " + (e.message || ""), "error");
        $btn.prop('disabled', false).html('<span id="final-price-btn">' + formatTL(totalAmount) + '</span> Öde');
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
